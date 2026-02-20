const Database = require('better-sqlite3');
const db = new Database('record_club.db');
const users = db.prepare("SELECT * FROM users WHERE record_club_username = 'callthetest'").all();
console.log('Database state for callthetest:');
console.log(JSON.stringify(users, null, 2));
db.close();
