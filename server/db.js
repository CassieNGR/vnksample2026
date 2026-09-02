const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// On Render, attach a Persistent Disk and mount it here (e.g. /data) via the
// DB_PATH env var, otherwise the SQLite file is wiped on every redeploy.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "dashboard.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  entity TEXT, type TEXT, num TEXT, memo TEXT, amount REAL
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  entity TEXT, type TEXT, num TEXT, memo TEXT, amount REAL
);
CREATE TABLE IF NOT EXISTS ar_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT, total REAL, current REAL, d1_30 REAL, d31_60 REAL, d61_90 REAL, d90plus REAL
);
CREATE TABLE IF NOT EXISTS ap_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT, total REAL, current REAL, d1_30 REAL, d31_60 REAL, d61_90 REAL, d90plus REAL
);
CREATE TABLE IF NOT EXISTS upload_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  filename TEXT, kind TEXT, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_so_date ON sales_orders(date);
CREATE INDEX IF NOT EXISTS idx_po_date ON purchase_orders(date);
CREATE INDEX IF NOT EXISTS idx_ar_date ON ar_items(date);
CREATE INDEX IF NOT EXISTS idx_ap_date ON ap_items(date);
`);

module.exports = db;
