import axios from 'axios';
import * as cheerio from 'cheerio';
import { database } from '../database/db';

const URL_1001 = 'https://1001albumsgenerator.com/albums';
const URL_LATAM = 'https://www.600discoslatam.com/indice-general-de-los-600-discos-de-latinoamerica/';

interface Album {
    title: string;
    artist: string;
    source: string;
}

export async function importLists() {
    console.log('Starting Album Lists import...');
    database.init();
    const db = database.getDb();

    const insert = db.prepare('INSERT OR REPLACE INTO tracked_albums (title, artist, source) VALUES (?, ?, ?)');

    const runTransaction = db.transaction((albumsToInsert: Album[]) => {
        for (const album of albumsToInsert) insert.run(album.title, album.artist, album.source);
    });

    // Import 1001 Albums
    try {
        console.log(`Fetching 1001 Albums from ${URL_1001}...`);
        const { data } = await axios.get(URL_1001, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
        });

        const $ = cheerio.load(data);
        const rows = $('table tbody tr');
        const albums1001: Album[] = [];

        rows.each((_: any, row: any) => {
            const title = $(row).find('td:nth-child(1) a').text().trim();
            const artist = $(row).find('td:nth-child(2) a').text().trim();

            if (title && artist) {
                albums1001.push({ title, artist, source: '1001' });
            }
        });

        console.log(`Found ${albums1001.length} albums in 1001 list.`);
        runTransaction(albums1001);
        console.log('Imported 1001 list.');

    } catch (error) {
        console.error('Error importing 1001 albums:', error);
    }

    // Import 600 Latam Albums
    try {
        console.log(`Fetching 600 Latam Albums from ${URL_LATAM}...`);
        const { data } = await axios.get(URL_LATAM, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
        });

        const $ = cheerio.load(data);
        const links = $('a');
        const albumsLatam: Album[] = [];

        links.each((_: any, link: any) => {
            const text = $(link).text().trim();
            const match = text.match(/«(.*?)»\s*(.*)/);
            if (match) {
                const title = match[1].trim();
                const artist = match[2].trim();
                if (title && artist) {
                    albumsLatam.push({ title, artist, source: 'latam' });
                }
            }
        });

        console.log(`Found ${albumsLatam.length} albums in Latam list.`);
        runTransaction(albumsLatam);
        console.log('Imported Latam list.');

    } catch (error) {
        console.error('Error importing Latam albums:', error);
    }
}

// Allow running directly
if (require.main === module) {
    importLists();
}
