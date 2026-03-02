import axios from 'axios';
import * as cheerio from 'cheerio';
import { Review } from '../types';

const BASE_URL = 'https://record.club';

export async function getYearFromMusicBrainz(artist: string, album: string): Promise<string | undefined> {
    const query = `release:"${album}" AND artist:"${artist}"`;
    const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json`;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`Querying MusicBrainz fallback (Attempt ${attempts + 1}/${maxAttempts}): ${url}`);
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'RecordClubBot/1.0.0 ( dan@example.com )' },
                timeout: 8000 // Slightly longer timeout
            });

            if (response.data && response.data.releases && response.data.releases.length > 0) {
                const releases = response.data.releases.filter((r: any) => r.date);
                releases.sort((a: any, b: any) => a.date.localeCompare(b.date));

                if (releases.length > 0) {
                    const earliestDate = releases[0].date;
                    const yearMatch = earliestDate.match(/\b(19|20)\d{2}\b/);
                    if (yearMatch) {
                        console.log(`MusicBrainz found year: ${yearMatch[0]}`);
                        return yearMatch[0];
                    }
                }
            }
            return undefined; // No releases found
        } catch (error: any) {
            attempts++;
            const isRateLimit = error.response?.status === 503;
            const isConnReset = error.code === 'ECONNRESET' || error.message?.includes('ECONNRESET') || error.code === 'ETIMEDOUT';

            if (isRateLimit) {
                console.warn('MusicBrainz rate limited (503). Skipping year for this item.');
                return undefined; // Don't retry on rate limit here, handled by polling loop delay
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
    return undefined;
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

                // Extract artist, album, and rating from title
                // Format: 'Album Title' by Artist Name - ★★★★
                // Or: 'Album Title' by Artist Name
                // We use a more robust regex that handles apostrophes in titles and standalone half-stars
                const titleRegex = /^'(.+)' by (.+?)(?: - ([★]*½?))?$/;
                const match = titleText.match(titleRegex);

                // If the rating part is empty, match[3] will be undefined or empty string, handled later.

                if (match) {
                    const albumTitle = match[1];
                    const artistName = match[2];
                    const rating = match[3] || 'No rating';

                    // Parse content:encoded for review text
                    // Structure: <p><img ... /></p> <p>Review Text</p>
                    const $content = cheerio.load(contentEncoded);
                    $content('img').remove(); // Remove the image

                    // Preserve line breaks by replacing <br> and <p> tags with newlines
                    $content('br').replaceWith('\n');
                    $content('p').each((_, p) => {
                        $content(p).prepend('\n').append('\n');
                    });

                    let reviewText = $content.text().trim();
                    // Clean up triple newlines caused by wrapping <p>
                    reviewText = reviewText.replace(/\n{3,}/g, '\n\n');

                    // Filter out "diary entries" (listens only)
                    // These typically have no rating and "null" as text in RSS
                    if (rating === 'No rating' && (reviewText === 'null' || !reviewText)) {
                        return; // Skip this item
                    }

                    // Clean "null" string if it's the only text (sometimes happens in RSS)
                    if (reviewText === 'null') reviewText = '';

                    if (reviewText.length > 2000) {
                        reviewText = reviewText.substring(0, 1997) + '...';
                    }

                    // Hyperlink "MORE" if truncation is detected (though RSS usually has full text)
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

