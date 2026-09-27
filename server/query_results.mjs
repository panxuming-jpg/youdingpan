import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('C:/Users/52212/Documents/trae_projects/youdingpan/youdingpan-source/server/data/app.db', { readOnly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('=== TABLES ===');
for (const t of tables) {
  const cnt = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
  console.log(`\nTable: ${t.name} -> ${cnt.c} rows`);
  const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
  console.log('Columns:', cols.map(c => c.name).join(', '));
}
db.close();
