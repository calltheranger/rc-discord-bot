import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { Review } from '../types';

// Add stealth plugin
puppeteer.use(StealthPlugin());

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

export const scraper = {
    getRecentReviews: async (username: string): Promise<Review[]> => {
        let browser;
        try {
            console.log(`Launching browser to scrape ${username}...`);
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });

            const url = `${BASE_URL}/${username}/reviews`;
            console.log(`Navigating to ${url}...`);

            // Use a more resilient navigation strategy with retries
            let attempts = 0;
            while (attempts < 3) {
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    break;
                } catch (e: any) {
                    attempts++;
                    if (attempts >= 3) throw e;
                    console.warn(`Navigation attempt ${attempts} failed for ${username}, retrying...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            // Wait specifically for the content we need
            await page.waitForSelector('article.review-teaser', { timeout: 15000 }).catch(() => { });

            // Give it a moment to stabilize
            await new Promise(r => setTimeout(r, 2000));

            // Scroll to ensure more reviews are loaded (Record Club uses infinite scroll/lazy loading)
            await page.evaluate(() => window.scrollBy(0, 1000));
            await new Promise(r => setTimeout(r, 1000));

            const reviewsRaw = await page.evaluate((baseUrl) => {
                const teasers = Array.from(document.querySelectorAll('article.review-teaser'));

                return teasers.map(teaser => {
                    const albumTitleElement = teaser.querySelector('a.line-clamp-2, a.title');
                    const albumTitle = albumTitleElement?.textContent?.trim() || '';
                    const albumUrlRelative = albumTitleElement?.getAttribute('href');
                    const albumUrl = albumUrlRelative ? (albumUrlRelative.startsWith('http') ? albumUrlRelative : `${baseUrl}${albumUrlRelative}`) : '';

                    const reviewLinkRelative = teaser.querySelector('a.review-teaser-date')?.getAttribute('href');
                    const reviewUrl = reviewLinkRelative ? (reviewLinkRelative.startsWith('http') ? reviewLinkRelative : `${baseUrl}${reviewLinkRelative}`) : '';

                    const artistLink = teaser.querySelector('a[href^="/artists/"]');
                    let artistName = artistLink?.textContent?.trim();
                    if (!artistName) {
                        const headings = teaser.querySelector('h3.release-headings');
                        artistName = headings?.textContent?.replace(albumTitle, '').trim();
                    }
                    if (!artistName) artistName = 'Unknown Artist';

                    const ratingValue = teaser.querySelector('[itemprop="ratingValue"]')?.getAttribute('content') ||
                        teaser.querySelector('[itemprop="ratingValue"]')?.textContent?.trim();
                    let rating = ratingValue || 'No rating';

                    const timeElement = teaser.querySelector('time');
                    const timestampStr = timeElement?.getAttribute('datetime');
                    const timestamp = timestampStr ? new Date(timestampStr).getTime() : Date.now();

                    const bodyEl = teaser.querySelector('.review-body, .review-teaser-body, .review-teaser-content, .review-teaser-excerpt') as HTMLElement;
                    let reviewText = bodyEl?.innerText?.trim() || '';
                    if (reviewText.length > 2000) reviewText = reviewText.substring(0, 1997) + '...';

                    const imgEl = teaser.querySelector('.release-artwork img') as HTMLImageElement;
                    let imageUrl = imgEl?.src || '';
                    if (!imageUrl || imageUrl.includes('placeholder')) {
                        const artworkInner = teaser.querySelector('.release-artwork-inner');
                        if (artworkInner) {
                            const style = window.getComputedStyle(artworkInner).backgroundImage;
                            const match = style.match(/url\(["']?([^"']+)["']?\)/);
                            if (match) imageUrl = match[1];
                        }
                    }

                    const teaserAvatar = teaser.querySelector('.avatar');
                    const headerAvatar = document.querySelector('.user-profile-header .avatar');
                    const avatarEl = teaserAvatar || headerAvatar;
                    let userAvatar = '';
                    if (avatarEl) {
                        const avatarImg = avatarEl.querySelector('img');
                        if (avatarImg?.src) userAvatar = avatarImg.src;
                        else {
                            const style = window.getComputedStyle(avatarEl).backgroundImage;
                            const match = style.match(/url\(["']?([^"']+)["']?\)/);
                            if (match) userAvatar = match[1];
                        }
                    }

                    const releaseYearText = teaser.querySelector('.release-year, .release-headings')?.textContent;
                    const yearMatch = releaseYearText?.match(/\b(19|20)\d{2}\b/);
                    const releaseYear = yearMatch ? yearMatch[0] : undefined;

                    return {
                        albumTitle,
                        artistName,
                        rating,
                        reviewText,
                        reviewUrl,
                        albumUrl,
                        imageUrl,
                        userAvatar,
                        timestamp,
                        releaseYear
                    };
                });
            }, BASE_URL);

            if (!reviewsRaw || reviewsRaw.length === 0) return [];

            const reviews: Review[] = [];

            // Process fallbacks
            for (const data of reviewsRaw) {
                if (!data.reviewUrl) continue;

                // Normalize URLs
                if (data.imageUrl && !data.imageUrl.startsWith('http')) data.imageUrl = `${BASE_URL}${data.imageUrl}`;
                if (data.userAvatar && !data.userAvatar.startsWith('http')) data.userAvatar = `${BASE_URL}${data.userAvatar}`;

                // Hyperlink "MORE" to the full review if truncated
                if (data.reviewText.includes('… MORE')) {
                    data.reviewText = data.reviewText.replace('… MORE', `[… MORE](${data.reviewUrl})`);
                }

                reviews.push({
                    username,
                    ...data
                });
            }

            return reviews;

        } catch (error) {
            console.error(`Error scraping ${username}:`, error);
            return [];
        } finally {
            if (browser) await browser.close();
        }
    }
};
