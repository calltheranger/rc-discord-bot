import { getAlbumSource, refreshAlbumCache } from './src/services/polling';
import { database } from './src/database/db';

async function test() {
    database.init();
    refreshAlbumCache();
    
    // Exact Record Club inputs
    const rcTitle = 'The Kinks Are The Village Green Preservation Society';
    const rcArtist = 'The Kinks';
    
    console.log(`Testing getAlbumSource('${rcTitle}', '${rcArtist}')`);
    const source = getAlbumSource(rcTitle, rcArtist);
    console.log('Returned Source:', source);
}

test().catch(console.error);
