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
  const aug12 = Date.UTC(2026, 7, 12, 9, 0);
  insHist.run(aug12 + 2 * 60000, "ar_as_of_aug_12.xlsx", "ar", "32 records for 2026-08-12");
  insHist.run(aug12 + 1 * 60000, "ap_as_of_aug_12.xlsx", "ap", "49 records for 2026-08-12");
  const aug18 = Date.UTC(2026, 7, 18, 9, 0);
  insHist.run(aug18 + 4 * 60000, "so_aug_1_-_18.xlsx", "so", "103 records");
  insHist.run(aug18 + 3 * 60000, "po_aug_1-18.xlsx", "po", "92 records");
  insHist.run(aug18 + 2 * 60000, "ar_aug_18_2026.xlsx", "ar", "30 records for 2026-08-18");
  insHist.run(aug18 + 1 * 60000, "ap_Aug_18_2026.xlsx", "ap", "50 records for 2026-08-18");
  const aug26 = Date.UTC(2026, 7, 26, 9, 0);
  insHist.run(aug26 + 4 * 60000, "so_19-26.xlsx", "so", "36 records (Aug 19-25)");
  insHist.run(aug26 + 3 * 60000, "po_19-26.xlsx", "po", "43 records (Aug 19-25)");
  insHist.run(aug26 + 2 * 60000, "ar_8-26.xlsx", "ar", "32 records for 2026-08-26");
  insHist.run(aug26 + 1 * 60000, "ap_aug_26.xlsx", "ap", "49 records for 2026-08-26");
  console.log("Seeded database with January-August 2026 dataset through Aug 26.");
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
  const rows = db.prepare("SELECT id, ts AS `when`, filename, kind, detail FROM upload_history ORDER BY ts DESC LIMIT 200").all();
  res.json(rows);
});

// Remove a single upload history entry. For AR/AP uploads this also removes the
// snapshot data itself (safe: snapshots are keyed by date, easy to target exactly).
// For SO/PO uploads this only removes the log entry - see /api/cleanup/invalid-dates
// below for removing bad transaction data from a wrong-file-type mistake.
app.delete("/api/history/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM upload_history WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "History entry not found." });
  if (row.kind === "ar" || row.kind === "ap") {
    const m = row.detail.match(/for (\d{4}-\d{2}-\d{2})/);
    if (m) {
      const table = row.kind === "ar" ? "ar_items" : "ap_items";
      db.prepare(`DELETE FROM ${table} WHERE date=?`).run(m[1]);
    }
  }
  db.prepare("DELETE FROM upload_history WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// One-time cleanup: removes any sales_orders/purchase_orders rows with an
// implausible date (a strong signal that an AR/AP file was accidentally
// uploaded as a Sales/Purchase Orders file, which misreads dollar amounts as
// Excel date serial numbers, landing in the early 1900s).
app.post("/api/cleanup/invalid-dates", (req, res) => {
  const bound = { min: "2020-01-01", max: "2035-12-31" };
  const soRemoved = db.prepare("DELETE FROM sales_orders WHERE date < ? OR date > ?").run(bound.min, bound.max).changes;
  const poRemoved = db.prepare("DELETE FROM purchase_orders WHERE date < ? OR date > ?").run(bound.min, bound.max).changes;
  res.json({ ok: true, soRemoved, poRemoved });
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
      // Guard rail: an AR/AP aging file selected under the wrong file type will
      // still "parse" as transactions, but the dates come out wildly implausible
      // (dollar amounts misread as date serial numbers, landing in the early
      // 1900s). Reject those outright instead of importing garbage.
      const badDates = txns.filter((t) => t.date < "2020-01-01" || t.date > "2035-12-31");
      if (badDates.length > 0) {
        return res.status(400).json({
          error: `This file's dates don't look right for a ${kind === "so" ? "Sales Orders" : "Purchase Orders"} import (found dates like ${badDates[0].date}). Double-check the File Type dropdown - this may actually be an AR/AP snapshot file.`,
        });
      }
      const table = kind === "so" ? "sales_orders" : "purchase_orders";
      // Replace only the exact dates present in this upload (not the whole month).
      // This correctly handles both a full-month master file (which covers every
      // date in the month, so it fully replaces the month) and an incremental
      // file of just new transactions (which only touches its own date range,
      // leaving previously-loaded dates untouched).
      const uploadDates = [...new Set(txns.map((t) => t.date))];
      const del = db.prepare(`DELETE FROM ${table} WHERE date=?`);
      const ins = db.prepare(`INSERT INTO ${table} (date,entity,type,num,memo,amount) VALUES (?,?,?,?,?,?)`);
      const tx = db.transaction(() => {
        uploadDates.forEach((d) => del.run(d));
        txns.forEach((t) => ins.run(t.date, t.entity, t.type, t.num, t.memo, t.amount));
      });
      tx();
      const detail = `${txns.length} records`;
      db.prepare("INSERT INTO upload_history (ts, filename, kind, detail) VALUES (?,?,?,?)").run(Date.now(), req.file.originalname, kind, detail);
      return res.json({ ok: true, count: txns.length, dates: uploadDates });
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
