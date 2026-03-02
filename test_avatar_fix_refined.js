const { scraper } = require('./dist/services/scraper');

async function testAvatarFixRefined() {
    const users = ['javiramos94', 'emeblanco'];
    console.log(`Testing refined avatar retrieval...`);

    for (const username of users) {
        console.log(`\nChecking ${username}...`);
        try {
            const reviews = await scraper.getRecentReviews(username);
            if (reviews.length > 0) {
                const avatarUrl = reviews[0].userAvatar;
                console.log(`Retrieved Avatar URL: ${avatarUrl}`);

                if (avatarUrl && avatarUrl.includes('width=300') && avatarUrl.includes('height=300')) {
                    console.log(`PASS: Avatar URL has square parameters!`);
                } else {
                    console.log(`FAIL: Avatar URL missing square parameters or incomplete.`);
                }
            } else {
                console.log('No reviews found for user.');
            }
        } catch (error) {
            console.error(`Test failed for ${username}:`, error);
        }
    }
}

testAvatarFixRefined();
