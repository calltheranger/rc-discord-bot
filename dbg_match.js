const { database } = require('./dist/database/db');
const { normalize, getAlbumSource } = require('./dist/services/polling');

async function debugMatch() {
    database.init();
    const db = database.getDb();

    // Manual check of what's in the DB
    const albums = db.prepare('SELECT title, artist, source FROM tracked_albums').all();
    console.log(`DB has ${albums.length} albums.`);

    const am = albums.filter(a => a.artist.includes('Arctic Monkeys'));
    console.log('Arctic Monkeys entries in DB:', JSON.stringify(am, null, 2));

    // Test the matching logic
    const title = "Whatever People Say I Am, That's What I'm Not";
    const artist = "Arctic Monkeys";

    // We need to simulate the startup load
    const albumsMapped = albums.map(a => ({
        ...a,
        normTitle: normalize(a.title),
        normArtist: normalize(a.artist)
    }));

    const normTitle = normalize(title);
    const normArtist = normalize(artist);

    console.log(`Matching: "${title}" by "${artist}"`);
    console.log(`Normalized: "${normTitle}" by "${normArtist}"`);

    const match = albumsMapped.find(a =>
        (a.normArtist.includes(normArtist) || normArtist.includes(a.normArtist)) &&
        (a.normTitle.includes(normTitle) || normTitle.includes(a.normTitle))
    );

    if (match) {
        console.log('MATCH FOUND:', JSON.stringify(match, null, 2));
    } else {
        console.log('NO MATCH FOUND.');
    }
}

debugMatch();
