const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const db = require("./db");
const { sheetToRows, parseAgingRows, parseTxnRows, parseWorkbookBuffer } = require("./parse");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use(cors());
app.use(express.json());

/* ---------------- one-time seed from July 2026 data ---------------- */
function seedIfEmpty() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sales_orders").get();
  if (row.n > 0) return;
  const seedPath = path.join(__dirname, "seed", "seed.json");
  if (!fs.existsSync(seedPath)) return;
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const insertSO = db.prepare("INSERT INTO sales_orders (date,entity,type,num,memo,amount) VALUES (?,?,?,?,?,?)");
  const insertPO = db.prepare("INSERT INTO purchase_orders (date,entity,type,num,memo,amount) VALUES (?,?,?,?,?,?)");
  const insertAR = db.prepare("INSERT INTO ar_items (date,name,total,current,d1_30,d31_60,d61_90,d90plus) VALUES (?,?,?,?,?,?,?,?)");
  const insertAP = db.prepare("INSERT INTO ap_items (date,name,total,current,d1_30,d31_60,d61_90,d90plus) VALUES (?,?,?,?,?,?,?,?)");
  const tx = db.transaction(() => {
    Object.values(seed).forEach((month) => {
      (month.so || []).forEach((t) => insertSO.run(t.date, t.entity, t.type, t.num, t.memo, t.amount));
      (month.po || []).forEach((t) => insertPO.run(t.date, t.entity, t.type, t.num, t.memo, t.amount));
      Object.entries(month.arSnapshots || {}).forEach(([date, snap]) => {
        snap.items.forEach((it) => insertAR.run(date, it.name, it.total, it.current, it.d1_30, it.d31_60, it.d61_90, it.d90plus));
      });
      Object.entries(month.apSnapshots || {}).forEach(([date, snap]) => {
        snap.items.forEach((it) => insertAP.run(date, it.name, it.total, it.current, it.d1_30, it.d31_60, it.d61_90, it.d90plus));
      });
    });
  });
  tx();
  const seedTime = Date.UTC(2026, 6, 31, 18, 0);
  const insHist = db.prepare("INSERT INTO upload_history (ts, filename, kind, detail) VALUES (?,?,?,?)");
  insHist.run(seedTime + 5 * 60000, "po_jan_to_july_2026.xlsx", "po", "1952 records");
  insHist.run(seedTime + 4 * 60000, "so_jan_to_july_2026.xlsx", "so", "2320 records");
  insHist.run(seedTime + 3 * 60000, "ar_july_31.xlsx", "ar", "39 records for 2026-07-31");
  insHist.run(seedTime + 2 * 60000, "ap_as_of_july_31.xlsx", "ap", "46 records for 2026-07-31");
  console.log("Seeded database with initial January-July 2026 dataset.");
}
seedIfEmpty();

/* ---------------- helpers ---------------- */
function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/* ---------------- routes ---------------- */

// list months that have any data at all
app.get("/api/months", (req, res) => {
  const rows = db.prepare(`
    SELECT substr(date,1,7) AS mk FROM sales_orders
    UNION SELECT substr(date,1,7) FROM purchase_orders
    UNION SELECT substr(date,1,7) FROM ar_items
    UNION SELECT substr(date,1,7) FROM ap_items
  `).all();
  const keys = [...new Set(rows.map((r) => r.mk))].sort();
  res.json(keys.map((k) => ({ key: k, label: monthLabel(k) })));
});

// full month payload: same shape the frontend previously kept in window.storage
app.get("/api/month/:key", (req, res) => {
  const { key } = req.params;
  const so = db.prepare("SELECT date,entity,type,num,memo,amount FROM sales_orders WHERE substr(date,1,7)=? ORDER BY date").all(key);
  const po = db.prepare("SELECT date,entity,type,num,memo,amount FROM purchase_orders WHERE substr(date,1,7)=? ORDER BY date").all(key);
  const arRows = db.prepare("SELECT * FROM ar_items WHERE substr(date,1,7)=? ORDER BY date").all(key);
  const apRows = db.prepare("SELECT * FROM ap_items WHERE substr(date,1,7)=? ORDER BY date").all(key);

  const arSnapshots = {};
  arRows.forEach((r) => {
    (arSnapshots[r.date] = arSnapshots[r.date] || { count: 0, total: 0, items: [] }).items.push(r);
  });
  Object.values(arSnapshots).forEach((s) => { s.count = s.items.length; s.total = Math.round(s.items.reduce((a, b) => a + b.total, 0) * 100) / 100; });

  const apSnapshots = {};
  apRows.forEach((r) => {
    (apSnapshots[r.date] = apSnapshots[r.date] || { count: 0, total: 0, items: [] }).items.push(r);
  });
  Object.values(apSnapshots).forEach((s) => { s.count = s.items.length; s.total = Math.round(s.items.reduce((a, b) => a + b.total, 0) * 100) / 100; });

  res.json({ monthLabel: monthLabel(key), so, po, arSnapshots, apSnapshots });
});

// combined data across every month ever imported - powers period presets (This Fiscal Year, etc.)
app.get("/api/data/all", (req, res) => {
  const so = db.prepare("SELECT date,entity,type,num,memo,amount FROM sales_orders ORDER BY date").all();
  const po = db.prepare("SELECT date,entity,type,num,memo,amount FROM purchase_orders ORDER BY date").all();
  const arRows = db.prepare("SELECT * FROM ar_items ORDER BY date").all();
  const apRows = db.prepare("SELECT * FROM ap_items ORDER BY date").all();

  const arSnapshots = {};
  arRows.forEach((r) => { (arSnapshots[r.date] = arSnapshots[r.date] || { count: 0, total: 0, items: [] }).items.push(r); });
  Object.values(arSnapshots).forEach((s) => { s.count = s.items.length; s.total = Math.round(s.items.reduce((a, b) => a + b.total, 0) * 100) / 100; });

  const apSnapshots = {};
  apRows.forEach((r) => { (apSnapshots[r.date] = apSnapshots[r.date] || { count: 0, total: 0, items: [] }).items.push(r); });
  Object.values(apSnapshots).forEach((s) => { s.count = s.items.length; s.total = Math.round(s.items.reduce((a, b) => a + b.total, 0) * 100) / 100; });

  res.json({ so, po, arSnapshots, apSnapshots });
});

app.get("/api/history", (req, res) => {
  const rows = db.prepare("SELECT ts AS `when`, filename, kind, detail FROM upload_history ORDER BY ts DESC LIMIT 200").all();
  res.json(rows);
});

// upload a file: multipart form fields -> file, kind ('so'|'po'|'ar'|'ap'), date (required for ar/ap)
app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    const { kind, date } = req.body;
    if (!req.file) return res.status(400).json({ error: "No file received." });
    if (!["so", "po", "ar", "ap"].includes(kind)) return res.status(400).json({ error: "Invalid kind." });
    if ((kind === "ar" || kind === "ap") && !date) return res.status(400).json({ error: "Snapshot date is required for AR/AP files." });

    const wb = parseWorkbookBuffer(req.file.buffer);
    const rows = sheetToRows(wb);

    if (kind === "so" || kind === "po") {
      const txns = parseTxnRows(rows);
      if (!txns.length) return res.status(400).json({ error: "No transactions found in that file." });
      const table = kind === "so" ? "sales_orders" : "purchase_orders";
      const months = [...new Set(txns.map((t) => t.date.slice(0, 7)))];
      const del = db.prepare(`DELETE FROM ${table} WHERE substr(date,1,7)=?`);
      const ins = db.prepare(`INSERT INTO ${table} (date,entity,type,num,memo,amount) VALUES (?,?,?,?,?,?)`);
      const tx = db.transaction(() => {
        months.forEach((m) => del.run(m));
        txns.forEach((t) => ins.run(t.date, t.entity, t.type, t.num, t.memo, t.amount));
      });
      tx();
      const detail = `${txns.length} records`;
      db.prepare("INSERT INTO upload_history (ts, filename, kind, detail) VALUES (?,?,?,?)").run(Date.now(), req.file.originalname, kind, detail);
      return res.json({ ok: true, count: txns.length, months });
    } else {
      const { count, items } = parseAgingRows(rows);
      if (!count) return res.status(400).json({ error: "No aging rows found in that file." });
      const table = kind === "ar" ? "ar_items" : "ap_items";
      const del = db.prepare(`DELETE FROM ${table} WHERE date=?`);
      const ins = db.prepare(`INSERT INTO ${table} (date,name,total,current,d1_30,d31_60,d61_90,d90plus) VALUES (?,?,?,?,?,?,?,?)`);
      const tx = db.transaction(() => {
        del.run(date);
        items.forEach((it) => ins.run(date, it.name, it.total, it.current, it.d1_30, it.d31_60, it.d61_90, it.d90plus));
      });
      tx();
      const detail = `${count} records for ${date}`;
      db.prepare("INSERT INTO upload_history (ts, filename, kind, detail) VALUES (?,?,?,?)").run(Date.now(), req.file.originalname, kind, detail);
      return res.json({ ok: true, count, date });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Could not process that file." });
  }
});

/* ---------------- serve built frontend in production ---------------- */
const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`V&K dashboard API listening on port ${PORT}`));
