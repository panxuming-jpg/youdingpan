import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('C:/Users/52212/Documents/trae_projects/youdingpan/youdingpan-source/server/data/app.db', { readOnly: true });

console.log('=== PLATFORM STATUS ===');
const ps = db.prepare("SELECT * FROM platform_status").all();
for (const row of ps) console.log(row);

console.log('\n=== PLATFORM GAME CODES (DD373) ===');
const codes = db.prepare("SELECT * FROM platform_game_codes WHERE platform='dd373'").all();
for (const row of codes) console.log(row);

console.log('\n=== GAMES ===');
const games = db.prepare("SELECT * FROM games").all();
for (const row of games) console.log(row);

db.close();
