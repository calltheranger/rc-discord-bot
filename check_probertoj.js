const Database = require('better-sqlite3');
const db = new Database('record_club.db');
const user = db.prepare('SELECT * FROM users WHERE record_club_username = ?').get('probertoj');
console.log('User probertoj:', JSON.stringify(user, null, 2));
db.close();
