// Usage: node db-snapshot.mjs <src.db> <out.db>
// Produces a consistent single-file snapshot of a live WAL-mode database
// (VACUUM INTO), safe to run while the server process holds the db open.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node db-snapshot.mjs <src.db> <out.db>'); process.exit(2); }
if (existsSync(out)) { console.error(`refuse: target already exists: ${out}`); process.exit(3); }
const d = new DatabaseSync(src, { readOnly: true });
d.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
d.close();
console.log(`[db-snapshot] ${src} -> ${out}`);
