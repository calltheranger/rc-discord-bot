import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { database } from '../database/db';
import { scraper } from './scraper';
import { User } from '../types';
import { formatStars } from '../utils/format';

const POLLING_INTERVAL = 15 * 60 * 1000; // 15 minutes

const getAlbumSource = (title: string, artist: string): string | null => {
    const db = database.getDb();

    // Attempt to match both title and artist case-insensitively
    const matches = db.prepare(`
        SELECT source FROM tracked_albums 
        WHERE title = ? COLLATE NOCASE AND artist = ? COLLATE NOCASE
    `).all(title, artist) as { source: string }[];

    if (matches.length > 0) {
        return matches[0].source;
    }

    // Fallback: If no exact title+artist match, try title ONLY (some Record Club entries vary in artist spelling)
    const titleOnlyMatches = db.prepare(`
        SELECT source FROM tracked_albums 
        WHERE title = ? COLLATE NOCASE
    `).all(title) as { source: string }[];

    if (titleOnlyMatches.length > 0) {
        return titleOnlyMatches[0].source;
    }

    return null;
};

export const startPolling = (client: Client) => {
    console.log('Starting polling service...');

    const poll = async () => {
        console.log('Polling for new reviews...');
        const users = database.getDb().prepare('SELECT * FROM users').all() as User[];

        for (const user of users) {
            try {
                const latestReview = await scraper.getLatestReview(user.record_club_username);

                if (!latestReview) continue;

                if (latestReview.reviewUrl !== user.last_review_url) {
                    console.log(`New review found for ${user.record_club_username}: ${latestReview.albumTitle}`);

                    database.getDb().prepare(`
            UPDATE users SET last_review_url = ?, last_checked_at = ? WHERE discord_id = ?
          `).run(latestReview.reviewUrl, Date.now(), user.discord_id);

                    const source = getAlbumSource(latestReview.albumTitle, latestReview.artistName);
                    console.log(`Album Source: ${source}`);

                    const guildSettings = database.getDb().prepare('SELECT * FROM guild_settings').all() as {
                        guild_id: string,
                        notification_channel_id: string,
                        channel_1001_id?: string,
                        channel_latam_id?: string
                    }[];

                    for (const setting of guildSettings) {
                        let targetChannelId = setting.notification_channel_id; // Default
                        let color = 0x0099FF; // Blue
                        let footerText = 'Record Club Review';

                        if (source === '1001') {
                            if (setting.channel_1001_id) targetChannelId = setting.channel_1001_id;
                            color = 0xFFD700; // Gold
                            footerText = '🏆 1001 Albums List';
                        } else if (source === 'latam') {
                            if (setting.channel_latam_id) targetChannelId = setting.channel_latam_id;
                            else if (setting.channel_1001_id) targetChannelId = setting.channel_1001_id; // Fallback to 1001 channel if user implied "Same channel"
                            color = 0xFF5733; // Orange-Red
                            footerText = '🌎 600 Discos Latinoamérica';
                        }

                        if (!targetChannelId) continue;

                        const channel = client.channels.cache.get(targetChannelId) as TextChannel;
                        if (channel) {
                            const stars = formatStars(latestReview.rating);
                            const yearStr = latestReview.releaseYear ? ` (${latestReview.releaseYear})` : '';
                            const separator1 = '┈┈┈┈┈';
                            const separator2 = '┈'.repeat(footerText.length);

                            const embed = new EmbedBuilder()
                                .setColor(color)
                                .setAuthor({
                                    name: `${latestReview.username} reviewed...`,
                                    iconURL: latestReview.userAvatar
                                })
                                .setTitle(`${latestReview.albumTitle} by ${latestReview.artistName}${yearStr}`)
                                .setURL(latestReview.reviewUrl)
                                .setDescription(`${stars}\n${separator1}\n${latestReview.reviewText || 'No review text.'}\n${separator2}`)
                                .setFooter({ text: footerText })
                                .setTimestamp(latestReview.timestamp);

                            if (latestReview.imageUrl) {
                                embed.setThumbnail(latestReview.imageUrl);
                            }

                            await channel.send({ embeds: [embed] });
                        }
                    }
                }
            } catch (error) {
                console.error(`Error polling for ${user.record_club_username}:`, error);
            }
        }
    };

    poll();
    setInterval(poll, POLLING_INTERVAL);
};
