import Database from "better-sqlite3";
import { config } from "../src/config.ts";

const db = new Database(config.dbPath, { readonly: true });

const tables = (
  db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{
    name: string;
  }>
).map((r) => r.name);

console.log("tables         :", tables.join(", "));
console.log("users present  :", tables.includes("users"));

const cols = (
  db.prepare(`SELECT name FROM pragma_table_info('sessions')`).all() as Array<{ name: string }>
).map((r) => r.name);
console.log("session columns:", cols.join(", "));

if (tables.includes("users")) {
  const u = (
    db.prepare(`SELECT name FROM pragma_table_info('users')`).all() as Array<{ name: string }>
  ).map((r) => r.name);
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  console.log("users columns  :", u.join(", "));
  console.log("users rows     :", n);
}

db.close();
