import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { Review } from '../types';

// Add stealth plugin
puppeteer.use(StealthPlugin());

const BASE_URL = 'https://record.club';

async function getYearFromMusicBrainz(artist: string, album: string): Promise<string | undefined> {
    try {
        const query = `release:"${album}" AND artist:"${artist}"`;
        const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json`;

        console.log(`Querying MusicBrainz fallback: ${url}`);
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'RecordClubBot/1.0.0 ( contact@example.com )' },
            timeout: 5000
        });

        if (response.data && response.data.releases && response.data.releases.length > 0) {
            // Filter releases that have a date and sort to find the earliest (original release)
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
    } catch (error) {
        console.error('MusicBrainz lookup failed:', error);
    }
    return undefined;
}

export const scraper = {
    getLatestReview: async (username: string): Promise<Review | null> => {
        let browser;
        try {
            console.log(`Launching browser to scrape ${username}...`);
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();

            // Set a realistic viewport
            await page.setViewport({ width: 1280, height: 800 });

            const url = `${BASE_URL}/${username}/reviews`;
            console.log(`Navigating to ${url}...`);

            // Go to URL and wait for network idle to ensure Cloudflare checks trigger/pass
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Wait for the review teaser to be visible
            await page.waitForSelector('article.review-teaser', { timeout: 10000 }).catch(() => { });

            // Scroll a bit to trigger lazy loading
            await page.evaluate(() => window.scrollBy(0, 500));
            await new Promise(r => setTimeout(r, 1000));

            const reviewData = await page.evaluate((baseUrl) => {
                const firstReview = document.querySelector('article.review-teaser');
                if (!firstReview) return null;

                // Extract details
                const albumTitleElement = firstReview.querySelector('a.line-clamp-2, a.title');
                const albumTitle = albumTitleElement?.textContent?.trim() || '';
                const albumUrlRelative = albumTitleElement?.getAttribute('href');
                const albumUrl = albumUrlRelative ? (albumUrlRelative.startsWith('http') ? albumUrlRelative : `${baseUrl}${albumUrlRelative}`) : '';

                const reviewLinkRelative = firstReview.querySelector('a.review-teaser-date')?.getAttribute('href');
                const reviewUrl = reviewLinkRelative ? (reviewLinkRelative.startsWith('http') ? reviewLinkRelative : `${baseUrl}${reviewLinkRelative}`) : '';

                // Artist Name
                const artistLink = firstReview.querySelector('a[href^="/artists/"]');
                let artistName = artistLink?.textContent?.trim();
                if (!artistName) {
                    const headings = firstReview.querySelector('h3.release-headings');
                    artistName = headings?.textContent?.replace(albumTitle, '').trim();
                }
                if (!artistName) artistName = 'Unknown Artist';

                // Rating
                const ratingValue = firstReview.querySelector('[itemprop="ratingValue"]')?.getAttribute('content') ||
                    firstReview.querySelector('[itemprop="ratingValue"]')?.textContent?.trim();

                let rating = ratingValue;
                if (!rating) {
                    const visuallyHidden = firstReview.querySelector('.rating .visuallyhidden');
                    const match = visuallyHidden?.textContent?.match(/([\d.]+)/);
                    if (match) rating = match[1];
                }

                // Timestamp
                const timeElement = firstReview.querySelector('time');
                const timestampStr = timeElement?.getAttribute('datetime');
                const timestamp = timestampStr ? new Date(timestampStr).getTime() : Date.now();

                // Review Text
                const bodyEl = firstReview.querySelector('.review-body, .review-teaser-body, .review-teaser-content, .review-teaser-excerpt');
                let reviewText = bodyEl?.textContent?.trim() || '';
                if (reviewText.length > 500) {
                    reviewText = reviewText.substring(0, 497) + '...';
                }

                // Cover Image
                const imgEl = firstReview.querySelector('.release-artwork img') as HTMLImageElement;
                let imageUrl = imgEl?.src || '';
                if (!imageUrl || imageUrl.includes('placeholder')) {
                    const artworkInner = firstReview.querySelector('.release-artwork-inner');
                    if (artworkInner) {
                        const style = window.getComputedStyle(artworkInner).backgroundImage;
                        const match = style.match(/url\(["']?([^"']+)["']?\)/);
                        if (match) imageUrl = match[1];
                    }
                }

                // User Avatar
                const headerAvatar = document.querySelector('.user-profile-header .avatar');
                const teaserAvatar = firstReview.querySelector('.avatar');
                const avatarEl = headerAvatar || teaserAvatar;

                let userAvatar = '';
                if (avatarEl) {
                    const avatarImg = avatarEl.querySelector('img');
                    if (avatarImg?.src) {
                        userAvatar = avatarImg.src;
                    } else {
                        const style = window.getComputedStyle(avatarEl).backgroundImage;
                        const match = style.match(/url\(["']?([^"']+)["']?\)/);
                        if (match) userAvatar = match[1];
                    }
                }

                // Release Year (sometimes in teaser)
                const releaseYearText = firstReview.querySelector('.release-year, .release-headings')?.textContent;
                const yearMatch = releaseYearText?.match(/\b(19|20)\d{2}\b/);
                const releaseYear = yearMatch ? yearMatch[0] : undefined;

                return {
                    albumTitle,
                    artistName,
                    rating: rating || 'No rating',
                    reviewText,
                    reviewUrl,
                    albumUrl,
                    imageUrl,
                    userAvatar,
                    timestamp,
                    releaseYear
                };
            }, BASE_URL);

            if (!reviewData || !reviewData.reviewUrl) {
                console.log('No review data or URL found.');
                return null;
            }

            // Normalize absolute URLs
            if (reviewData.imageUrl && !reviewData.imageUrl.startsWith('http')) reviewData.imageUrl = `${BASE_URL}${reviewData.imageUrl}`;
            if (reviewData.userAvatar && !reviewData.userAvatar.startsWith('http')) reviewData.userAvatar = `${BASE_URL}${reviewData.userAvatar}`;

            // Priority 1: Use year from teaser if found
            let releaseYear = reviewData.releaseYear;

            // Priority 2: Use MusicBrainz API (Very reliable fallback)
            if (!releaseYear) {
                console.log(`Year missing for ${reviewData.albumTitle}. Trying MusicBrainz...`);
                releaseYear = await getYearFromMusicBrainz(reviewData.artistName, reviewData.albumTitle);
            }

            // Priority 3: Navigate to Record Club album page (Slowest fallback)
            if (!releaseYear && reviewData.albumUrl) {
                try {
                    console.log(`Navigating to album page as last resort: ${reviewData.albumUrl}`);
                    const albumPage = await browser.newPage();
                    await albumPage.goto(reviewData.albumUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

                    releaseYear = await albumPage.evaluate(() => {
                        const cleanYear = (text: string | null | undefined): string | undefined => {
                            if (!text) return undefined;
                            const match = text.match(/\b(19|20)\d{2}\b/);
                            return match ? match[0] : undefined;
                        };

                        const yearEl = document.querySelector('.release-year');
                        if (yearEl && yearEl.textContent?.trim()) return cleanYear(yearEl.textContent);

                        const dateEl = document.querySelector('dl.release-details dd.date');
                        if (dateEl && dateEl.textContent) return cleanYear(dateEl.textContent);

                        const headings = document.querySelector('h1.release-headings, .release-headings');
                        if (headings && headings.textContent) return cleanYear(headings.textContent);

                        return cleanYear(document.title);
                    });

                    // Update Image if missing
                    if (!reviewData.imageUrl || reviewData.imageUrl.includes('placeholder') || reviewData.imageUrl.includes('default')) {
                        const pageImageUrl = await albumPage.evaluate(() => {
                            const img = document.querySelector('.release-artwork img') as HTMLImageElement;
                            if (img?.src) return img.src;
                            return undefined;
                        });
                        if (pageImageUrl) {
                            reviewData.imageUrl = pageImageUrl.startsWith('http') ? pageImageUrl : `${BASE_URL}${pageImageUrl}`;
                        }
                    }

                    await albumPage.close();
                } catch (e) {
                    console.error(`Failed to fetch album details from ${reviewData.albumUrl}:`, e);
                }
            }

            return {
                username,
                ...reviewData,
                releaseYear
            };

        } catch (error) {
            console.error(`Error scraping ${username}:`, error);
            return null;
        } finally {
            if (browser) await browser.close();
        }
    }
};
