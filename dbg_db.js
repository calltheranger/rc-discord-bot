const { database } = require('./dist/database/db');
database.init();
const count = database.getDb().prepare("SELECT count(*) as count FROM tracked_albums WHERE source = '1001'").get();
console.log(count.count);
database.getDb().close();
