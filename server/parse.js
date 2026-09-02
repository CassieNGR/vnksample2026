const XLSX = require("xlsx");

function sheetToRows(workbook) {
  const preferred =
    workbook.SheetNames.find((n) => n.toLowerCase() === "sheet1") ||
    workbook.SheetNames[workbook.SheetNames.length - 1];
  const ws = workbook.Sheets[preferred];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function excelSerialToISO(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return null;
}

// AR / AP daily aging export: col A empty + col B = customer/vendor name row
function parseAgingRows(rows) {
  let count = 0,
    total = 0;
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const a = r[0],
      b = r[1];
    if ((a === null || a === undefined) && b && b !== "TOTAL") {
      const c1 = Number(r[2]) || 0,
        c2 = Number(r[4]) || 0,
        c3 = Number(r[6]) || 0,
        c4 = Number(r[8]) || 0,
        c5 = Number(r[10]) || 0;
      const m = r[12] != null ? Number(r[12]) : 0;
      count++;
      total += m;
      items.push({
        name: b,
        total: round2(m),
        current: round2(c1),
        d1_30: round2(c2),
        d31_60: round2(c3),
        d61_90: round2(c4),
        d90plus: round2(c5),
      });
    }
  }
  return { count, total: round2(total), items };
}

// SO / PO monthly export: entity name row (col B set, col E empty), then txn rows (col E set)
function parseTxnRows(rows) {
  const out = [];
  let currentEntity = null;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const b = r[1],
      typ = r[4];
    if (b && !typ) {
      currentEntity = b;
      continue;
    }
    const date = excelSerialToISO(r[6]);
    if (!date) continue;
    const num = r[8],
      memo = r[10];
    const debit = r[18],
      credit = r[20];
    let amt = 0;
    if (debit !== null && debit !== undefined && debit !== "") amt = Number(debit) || 0;
    else if (credit !== null && credit !== undefined && credit !== "") amt = Number(credit) || 0;
    out.push({
      date,
      entity: currentEntity,
      type: typ || "",
      num: num != null ? String(num) : "",
      memo: memo || "",
      amount: round2(amt),
    });
  }
  return out;
}

function parseWorkbookBuffer(buffer) {
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

module.exports = { sheetToRows, parseAgingRows, parseTxnRows, parseWorkbookBuffer, round2 };
