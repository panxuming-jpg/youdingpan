import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('C:/Users/52212/AppData/Local/Temp/dd373q/app.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('Tables:', tables.join(', '));

for (const t of tables) {
  const cnt = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get();
  if (cnt.c > 0 || ['goods','crawl_logs','platform_status'].includes(t)) {
    console.log(`\n=== ${t} (${cnt.c} rows) ===`);
    if (cnt.c <= 20 || t === 'platform_status' || t === 'games' || t === 'platform_game_codes') {
      const rows = db.prepare(`SELECT * FROM "${t}" LIMIT 50`).all();
      for (const r of rows) console.log(r);
    }
  }
}
db.close();
