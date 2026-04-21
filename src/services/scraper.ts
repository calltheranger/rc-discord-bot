import axios from 'axios';
import * as cheerio from 'cheerio';
import { Review } from '../types';

const BASE_URL = 'https://record.club';
import { formatStars, normalize } from '../utils/format';

export async function getReleaseDataFromRecordClub(reviewUrl: string): Promise<{ year?: string, imageUrl?: string }> {
    let result: { year?: string, imageUrl?: string } = {};
    try {
        console.log(`Fetching release data from Record Club page: ${reviewUrl}`);
        const response = await axios.get(reviewUrl, {
            headers: {
                'User-Agent': 'Discordbot/2.0; +https://discord.app',
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const rawImageUrl = $('meta[property="og:image"]').attr('content');
        result.imageUrl = rawImageUrl || undefined;

        // Strategy 1: Look for the specific definition list in "Release details"
        const releasedDate = $('.entity-details-title').filter((_, el) => $(el).text().trim() === 'Released').next('.entity-details-description').text().trim();
        if (releasedDate) {
            const yearMatch = releasedDate.match(/\b((?:19|20)\d{2})\b/);
            if (yearMatch) {
                console.log(`Record Club page found year (Strategy 1): ${yearMatch[1]}`);
                result.year = yearMatch[1];
                return result;
            }
        }

        // Strategy 2: Look for the breadcrumb or header text (e.g., "Elastica (1995)")
        const headerText = $('h1, .breadcrumb, title, .entity-header').text();
        const yearMatch2 = headerText.match(/\(((?:19|20)\d{2})\)/);
        if (yearMatch2) {
            console.log(`Record Club header found year (Strategy 2): ${yearMatch2[1]}`);
            result.year = yearMatch2[1];
            return result;
        }

        // Strategy 3: Look for "og:title" meta tag which often has "Artist - Album (Year)"
        const ogTitle = $('meta[property="og:title"]').attr('content');
        if (ogTitle) {
            const match3 = ogTitle.match(/\(((?:19|20)\d{2})\)/);
            if (match3) {
                console.log(`Record Club og:title found year (Strategy 3): ${match3[1]}`);
                result.year = match3[1];
                return result;
            }
        }

        // Strategy 4: Look for "ALBUM • 1995" pattern in text
        const metaText = $('.entity-meta, .release-meta, main').text();
        const albumMetaMatch = metaText.match(/ALBUM\s*•?\s*((?:19|20)\d{2})/i);
        if (albumMetaMatch) {
            console.log(`Record Club meta found year (Strategy 4): ${albumMetaMatch[1]}`);
            result.year = albumMetaMatch[1];
            return result;
        }

        if (result.imageUrl) {
            console.log(`Record Club page found image but no year`);
            return result;
        }

    } catch (error: any) {
        console.warn(`Failed to fetch release data from Record Club: ${error.message}`);
    }
    return result;
}

export async function getReleaseDataFromMusicBrainz(artist: string, album: string): Promise<{ year?: string, imageUrl?: string }> {
    const query = `releasegroup:"${album}" AND artist:"${artist}"`;
    const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json`;

    let attempts = 0;
    const maxAttempts = 3;
    const normArtist = normalize(artist);
    const normAlbum = normalize(album);

    while (attempts < maxAttempts) {
        try {
            console.log(`Querying MusicBrainz (Attempt ${attempts + 1}/${maxAttempts}): ${url}`);
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'RecordClubBot/1.0.0 ( dan@example.com )' },
                timeout: 8000
            });

            if (response.data && response.data['release-groups'] && response.data['release-groups'].length > 0) {
                // Filter for sensible matches
                let filteredGroups = response.data['release-groups'].filter((g: any) => {
                    if (!g['first-release-date']) return false;

                    const gNormTitle = normalize(g.title);
                    const artistCredit = g['artist-credit'] || [];
                    const gNormArtist = normalize(artistCredit[0]?.name || artistCredit[0]?.artist?.name || '');

                    // Check for exact normalized matches
                    return gNormTitle === normAlbum && gNormArtist === normArtist;
                });

                // If no exact match, fall back to includes but still requiring artist match
                if (filteredGroups.length === 0) {
                    filteredGroups = response.data['release-groups'].filter((g: any) => {
                        if (!g['first-release-date']) return false;
                        const gNormTitle = normalize(g.title);
                        const artistCredit = g['artist-credit'] || [];
                        const gNormArtist = normalize(artistCredit[0]?.name || artistCredit[0]?.artist?.name || '');
                        return gNormTitle.includes(normAlbum) && gNormArtist.includes(normArtist);
                    });
                }

                filteredGroups.sort((a: any, b: any) => a['first-release-date'].localeCompare(b['first-release-date']));

                if (filteredGroups.length > 0) {
                    const earliestDate = filteredGroups[0]['first-release-date'];
                    const yearMatch = earliestDate.match(/\b(19|20)\d{2}\b/);
                    const mbid = filteredGroups[0].id;
                    const imageUrl = `https://coverartarchive.org/release-group/${mbid}/front-500`;

                    if (yearMatch) {
                        console.log(`MusicBrainz found year: ${yearMatch[0]} for ${album} by ${artist}`);
                        return { year: yearMatch[0], imageUrl };
                    }
                    return { imageUrl };
                }
            }
            return {};
        } catch (error: any) {
            attempts++;
            const isRateLimit = error.response?.status === 503;
            const isConnReset = error.code === 'ECONNRESET' || error.message?.includes('ECONNRESET') || error.code === 'ETIMEDOUT';

            if (isRateLimit) {
                console.warn('MusicBrainz rate limited (503). Skipping data fetch for this item.');
                return {};
            }

            if (attempts < maxAttempts && isConnReset) {
                const delay = attempts * 2000;
                console.warn(`MusicBrainz lookup failed (${error.code || error.message}), retrying in ${delay}ms... (Attempt ${attempts}/${maxAttempts})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            console.error('MusicBrainz lookup failed:', error.message);
            break;
        }
    }
    return {};
}

const avatarCache = new Map<string, { url: string, timestamp: number }>();
const AVATAR_CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

async function getUserAvatar(username: string): Promise<string | undefined> {
    const cached = avatarCache.get(username);
    if (cached && (Date.now() - cached.timestamp) < AVATAR_CACHE_TTL) {
        return cached.url;
    }

    try {
        console.log(`Fetching avatar for ${username} (Lightweight)...`);
        const url = `${BASE_URL}/${username}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Discordbot/2.0; +https://discord.app',
            },
            timeout: 5000
        });

        // Match og:image or twitter:image
        const match = response.data.match(/property="og:image" content="([^"]+)"/);
        if (match && match[1]) {
            // Append or replace query parameters to request a square 300x300 version
            // This prevents elongation in Discord by ensuring the CDN returns a square crop
            const baseUrl = match[1].split('?')[0];
            const avatarUrl = `${baseUrl}?width=300&height=300`;
            avatarCache.set(username, { url: avatarUrl, timestamp: Date.now() });
            return avatarUrl;
        }
    } catch (error: any) {
        console.warn(`Could not fetch avatar for ${username}: ${error.message}`);
    }
    return undefined;
}

export const scraper = {
    getRecentReviews: async (username: string): Promise<Review[]> => {
        try {
            const userAvatar = await getUserAvatar(username);
            console.log(`Fetching RSS feed for ${username}...`);
            const rssUrl = `${BASE_URL}/${username}/reviews/rss`;
            const response = await axios.get(rssUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                },
                timeout: 15000
            });

            const $ = cheerio.load(response.data, { xmlMode: true });
            const items = $('item');
            const reviews: Review[] = [];

            items.each((_, el) => {
                const item = $(el);
                const titleText = item.find('title').text().trim();
                const reviewUrl = item.find('link').text().trim();
                const pubDate = item.find('pubDate').text().trim();
                const timestamp = pubDate ? new Date(pubDate).getTime() : Date.now();
                const contentEncoded = item.find('content\\:encoded, encoded').text();
                const imageUrl = item.find('enclosure').attr('url') || '';

                const titleRegex = /^(?:[↻]+\s*)?'(.+)' by (.+?)(?: - ([★]*½?))?$/;
                const match = titleText.match(titleRegex);

                if (match) {
                    const albumTitle = match[1];
                    const artistName = match[2];
                    const rating = match[3] || 'No rating';

                    const $content = cheerio.load(contentEncoded);
                    $content('img').remove();

                    // Convert formatting tags to Markdown
                    $content('strong, b').each((_, el) => {
                        const $el = $content(el);
                        $el.replaceWith(`**${$el.html()}**`);
                    });
                    $content('em, i').each((_, el) => {
                        const $el = $content(el);
                        $el.replaceWith(`*${$el.html()}*`);
                    });
                    $content('u').each((_, el) => {
                        const $el = $content(el);
                        $el.replaceWith(`__${$el.html()}__`);
                    });
                    $content('s, strike, del').each((_, el) => {
                        const $el = $content(el);
                        $el.replaceWith(`~~${$el.html()}~~`);
                    });
                    $content('a').each((_, el) => {
                        const $el = $content(el);
                        const href = $el.attr('href');
                        const text = $el.html();
                        if (href) {
                            $el.replaceWith(`[${text}](${href})`);
                        }
                    });

                    $content('br').replaceWith('\n');
                    $content('p').each((_, p) => {
                        const pText = $content(p).text().trim();
                        if (pText.startsWith('Listened:') || pText.startsWith('Listened on ') || pText === 'Repeat listen') {
                            $content(p).remove();
                        } else {
                            $content(p).prepend('\n').append('\n');
                        }
                    });

                    let reviewText = $content.text().trim();
                    reviewText = reviewText.replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n');

                    // Filter out "diary entries" (listens or ratings without notes)
                    // These typically have "null" or empty string as text in RSS
                    const checkText = reviewText.replace(/\s+/g, ' ').trim();
                    if (!checkText || checkText === 'null') {
                        return; // Skip this item
                    }

                    if (reviewText.length > 2000) {
                        reviewText = reviewText.substring(0, 1997) + '...';
                    }

                    if (reviewText.includes('… MORE')) {
                        reviewText = reviewText.replace('… MORE', `[… MORE](${reviewUrl})`);
                    }

                    reviews.push({
                        username,
                        albumTitle,
                        artistName,
                        rating,
                        reviewText,
                        reviewUrl,
                        imageUrl,
                        userAvatar,
                        timestamp,
                        releaseYear: undefined
                    });
                }
            });

            return reviews;

        } catch (error: any) {
            console.error(`Error scraping RSS for ${username}:`, error.message);
            return [];
        }
    }
};

