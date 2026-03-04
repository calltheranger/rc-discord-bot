import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { database } from '../database/db';
import { scraper, getYearFromMusicBrainz, getYearFromRecordClub } from './scraper';
import { User } from '../types';
import { formatStars } from '../utils/format';

const POLLING_INTERVAL = 15 * 60 * 1000; // 15 minutes

export const normalize = (str: string): string => {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9]/g, ''); // Remove non-alphanumeric
};

interface TrackedAlbum {
    title: string;
    artist: string;
    source: string;
    normTitle: string;
    normArtist: string;
}

let cachedAlbums: TrackedAlbum[] = [];

export const getAlbumSource = (title: string, artist: string): string | null => {
    const normTitle = normalize(title);
    const normArtist = normalize(artist);

    // 1. Try exact normalized Title + Artist match
    let match = cachedAlbums.find(a => a.normTitle === normTitle && a.normArtist === normArtist);
    if (match) {
        console.log(`[MATCH] Exact match for "${title}" by "${artist}" -> ${match.source}`);
        return match.source;
    }

    // 2. Try Title match with Partial Artist (handles "Villalobos" vs "Ricardo Villalobos")
    match = cachedAlbums.find(a => a.normTitle === normTitle && (a.normArtist.includes(normArtist) || normArtist.includes(a.normArtist)));
    if (match) {
        console.log(`[MATCH] Partial artist match for "${title}" by "${artist}" -> ${match.source}`);
        return match.source;
    }

    // 3. Try Partial Artist with Partial Title (handles "Sunday at" by "Bill Evans Trio / Scott LaFaro")
    match = cachedAlbums.find(a =>
        (a.normArtist.includes(normArtist) || normArtist.includes(a.normArtist)) &&
        (a.normTitle.includes(normTitle) || normTitle.includes(a.normTitle))
    );
    if (match) {
        console.log(`[MATCH] Partial title/artist match for "${title}" by "${artist}" -> ${match.source}`);
        return match.source;
    }

    console.log(`[NO MATCH] No list source found for "${title}" by "${artist}"`);
    return null;
};

// Load and normalize tracked albums once at startup
export const refreshAlbumCache = () => {
    const albums = database.getDb().prepare('SELECT title, artist, source FROM tracked_albums').all() as any[];

    if (albums.length === 0) {
        console.warn('WARNING: Tracked albums list is empty! Attempting auto-sync...');
        // We can't easily import the script here due to circular dependencies/modules
        // but we can at least warn the user or try a dynamic import
        try {
            const { importLists } = require('../scripts/import_lists');
            importLists().then(() => {
                const reloaded = database.getDb().prepare('SELECT title, artist, source FROM tracked_albums').all() as any[];
                cachedAlbums = reloaded.map(a => ({
                    ...a,
                    normTitle: normalize(a.title),
                    normArtist: normalize(a.artist)
                }));
                console.log(`Auto-sync complete. Loaded ${cachedAlbums.length} albums.`);
            });
        } catch (e) {
            console.error('Auto-sync failed. Please run "npm run sync" manually.', e);
        }
    } else {
        cachedAlbums = albums.map(a => ({
            ...a,
            normTitle: normalize(a.title),
            normArtist: normalize(a.artist)
        }));
        console.log(`Loaded ${cachedAlbums.length} albums into matching cache.`);
    }
};

export const startPolling = (client: Client) => {
    console.log('Starting polling service...');

    refreshAlbumCache();
    let isPolling = false;

    const poll = async () => {
        if (isPolling) {
            console.log('Polling already in progress, skipping this cycle.');
            return;
        }
        isPolling = true;

        try {
            console.log('Polling for new reviews...');
            const users = database.getDb().prepare('SELECT * FROM users').all() as User[];

            for (const user of users) {
                // Add a small delay between users to avoid slamming the CPU/Record Club
                if (users.indexOf(user) > 0) {
                    await new Promise(r => setTimeout(r, 5000));
                }
                try {
                    const reviews = await scraper.getRecentReviews(user.record_club_username);
                    if (reviews.length === 0) continue;

                    // Find index of the last review we processed
                    let lastIndex = reviews.findIndex(r => r.reviewUrl === user.last_review_url);

                    // CRITICAL: If last_review_url is null (newly linked user), we ONLY seed the DB
                    // and do NOT post old reviews to Discord.
                    if (!user.last_review_url) {
                        console.log(`First poll for ${user.record_club_username}. Seeding latest review: ${reviews[0].albumTitle}`);
                        database.getDb().prepare(`
                        UPDATE users SET last_review_url = ?, last_checked_at = ? WHERE record_club_username = ?
                    `).run(reviews[0].reviewUrl, Date.now(), user.record_club_username);
                        continue;
                    }

                    // Safety catch: If we can't find the last seen review in the top 30, 
                    // something is wrong (URL changed or more than 30 reviews posted).
                    // In this case, we DO NOT post everything, we just seed the latest one and warn.
                    if (lastIndex === -1 && user.last_review_url) {
                        console.warn(`WARNING: Could not find last review URL for ${user.record_club_username}. Resetting to latest to avoid spam.`);
                        database.getDb().prepare(`
                        UPDATE users SET last_review_url = ?, last_checked_at = ? WHERE record_club_username = ?
                    `).run(reviews[0].reviewUrl, Date.now(), user.record_club_username);
                        continue;
                    }

                    const newReviews = lastIndex === -1 ? [] : reviews.slice(0, lastIndex);

                    if (newReviews.length > 0) {
                        console.log(`Found ${newReviews.length} new reviews for ${user.record_club_username}`);

                        // Process from oldest to newest
                        for (let i = newReviews.length - 1; i >= 0; i--) {
                            const review = newReviews[i];

                            // Fetch Year only if missing and only for reviews we are about to post
                            if (!review.releaseYear) {
                                // Try Record Club first (direct scrape)
                                review.releaseYear = await getYearFromRecordClub(review.reviewUrl);

                                // Fallback to MusicBrainz if Record Club failed
                                if (!review.releaseYear) {
                                    // Respect MusicBrainz rate limit (1 request per second)
                                    if (i < newReviews.length - 1) await new Promise(r => setTimeout(r, 1100));
                                    review.releaseYear = await getYearFromMusicBrainz(review.artistName, review.albumTitle);
                                }
                            }

                            const source = getAlbumSource(review.albumTitle, review.artistName);

                            const guildSettings = database.getDb().prepare('SELECT * FROM guild_settings').all() as {
                                guild_id: string,
                                notification_channel_id: string,
                                channel_1001_id?: string,
                                channel_latam_id?: string
                            }[];

                            if (guildSettings.length === 0) {
                                console.warn(`WARNING: No guild settings found. Use /setchannel to configure notifications.`);
                            }

                            for (const setting of guildSettings) {
                                let targetChannelId = setting.notification_channel_id; // Default
                                let color = 0x0099FF; // Blue
                                let footerText = '💿 Record Club Review';

                                if (source === '1001') {
                                    if (setting.channel_1001_id) targetChannelId = setting.channel_1001_id;
                                    color = 0xFFD700; // Gold
                                    footerText = '📀 1001 Albums List';
                                } else if (source === 'latam') {
                                    if (setting.channel_latam_id) targetChannelId = setting.channel_latam_id;
                                    else if (setting.channel_1001_id) targetChannelId = setting.channel_1001_id;
                                    color = 0xFF5733; // Orange-Red
                                    footerText = '🌎 600 Discos Latinoamérica';
                                }

                                if (!targetChannelId) continue;

                                const channel = client.channels.cache.get(targetChannelId) as TextChannel;
                                if (channel) {
                                    const stars = formatStars(review.rating);
                                    const yearStr = review.releaseYear ? ` (${review.releaseYear})` : '';
                                    const separator1 = '┈┈┈┈┈';

                                    const embed = new EmbedBuilder()
                                        .setColor(color)
                                        .setAuthor({
                                            name: `${review.username} reviewed...`,
                                            iconURL: review.userAvatar || undefined
                                        })
                                        .setTitle(`${review.artistName}\n**${review.albumTitle}**${yearStr}`)
                                        .setURL(review.reviewUrl)
                                        .setDescription(`${stars}\n${separator1}\n${review.reviewText || 'No review text.'}`)
                                        .setFooter({ text: footerText })
                                        .setTimestamp(review.timestamp);

                                    if (review.imageUrl) embed.setThumbnail(review.imageUrl);

                                    await channel.send({ embeds: [embed] });
                                    console.log(`Notification sent for ${review.albumTitle} to channel ${channel.name}`);
                                }
                            }
                        }

                        // Update database with the latest review URL
                        database.getDb().prepare(`
                        UPDATE users SET last_review_url = ?, last_checked_at = ? WHERE record_club_username = ?
                    `).run(newReviews[0].reviewUrl, Date.now(), user.record_club_username);
                    }
                } catch (error) {
                    console.error(`Error polling for ${user.record_club_username}:`, error);
                }
            }
        } catch (error) {
            console.error('Error during global poll cycle:', error);
        } finally {
            isPolling = false;
        }
    };

    poll();
    setInterval(poll, POLLING_INTERVAL);
};
