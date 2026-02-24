const { database } = require('./dist/database/db');
database.init();
const matches = database.getDb().prepare("SELECT title, artist FROM tracked_albums WHERE title LIKE '%Sunday at the Village%'").all();
console.log("DB Matches:", matches);
database.getDb().close();
