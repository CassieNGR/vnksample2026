import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import {
  LayoutDashboard, Receipt, Landmark, ShoppingCart, FileSpreadsheet,
  TrendingUp, TrendingDown, Search, ArrowUpRight, ArrowDownRight,
  ChevronRight, AlertTriangle, X, UploadCloud, Check, Calendar,
} from "lucide-react";

const API = ""; // same-origin; Vite dev proxy forwards /api to the local server

/* ================= design tokens ================= */
const NAVY = "#0F2744";
const GOLD = "#C9A227";
const CREAM = "#FAFAF8";
const INK = "#1E293B";
const SUB = "#64748B";
const GREEN = "#16A34A";
const RED = "#DC2626";
const AMBER = "#D97706";
const BLUE = "#1D4ED8";
const BORDER = "#E7E4DC";

const fmt$ = (n) => (n == null ? "—" : (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US"));
const fmt$2 = (n) => (n == null ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const shortDate = (iso) => { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const longDate = (iso) => { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }); };
const weekday = (iso) => { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("en-US", { weekday: "short" }); };
const monthKeyOf = (iso) => iso.slice(0, 7);
const monthLabelOf = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });


function round2(n) { return Math.round(n * 100) / 100; }

/* ================= derive daily rows from a month payload fetched from the API ================= */
function getDailyForMonth(monthData) {
  if (!monthData) return [];
  const dateSet = new Set();
  monthData.so.forEach((t) => dateSet.add(t.date));
  monthData.po.forEach((t) => dateSet.add(t.date));
  Object.keys(monthData.arSnapshots).forEach((d) => dateSet.add(d));
  Object.keys(monthData.apSnapshots).forEach((d) => dateSet.add(d));
  const dates = [...dateSet].sort();
  return dates.map((date) => {
    const soTx = monthData.so.filter((t) => t.date === date);
    const poTx = monthData.po.filter((t) => t.date === date);
    const ar = monthData.arSnapshots[date] || null;
    const ap = monthData.apSnapshots[date] || null;
    return {
      date,
      so_count: soTx.length, so_total: round2(soTx.reduce((s, t) => s + t.amount, 0)), so_tx: soTx,
      po_count: poTx.length, po_total: round2(poTx.reduce((s, t) => s + t.amount, 0)), po_tx: poTx,
      ar_count: ar ? ar.count : null, ar_total: ar ? ar.total : null, ar_items: ar ? ar.items : null,
      ap_count: ap ? ap.count : null, ap_total: ap ? ap.total : null, ap_items: ap ? ap.items : null,
    };
  });
}

function filterByRange(daily, from, to) {
  return daily.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
}

function latestWithField(daily, field) {
  for (let i = daily.length - 1; i >= 0; i--) if (daily[i][field] != null) return daily[i];
  return null;
}

const AGING_COLORS = { current: GREEN, d1_30: BLUE, d31_60: AMBER, d61_90: "#EA580C", d90plus: RED };
const AGING_LABELS = { current: "Current", d1_30: "1-30 days", d31_60: "31-60 days", d61_90: "61-90 days", d90plus: "90+ days" };

function agingSlices(dayRow, key) {
  if (!dayRow) return Object.keys(AGING_LABELS).map((k) => ({ name: AGING_LABELS[k], key: k, value: 0 }));
  const items = dayRow[key];
  const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  items.forEach((it) => { Object.keys(totals).forEach((k) => (totals[k] += it[k] || 0)); });
  return Object.keys(AGING_LABELS).map((k) => ({ name: AGING_LABELS[k], key: k, value: Math.round(totals[k]) }));
}

/* ================= period presets ================= */
const PERIOD_OPTIONS = [
  ["all", "All"],
  ["today", "Today"],
  ["this_week", "This Week"],
  ["this_week_td", "This Week-to-date"],
  ["this_month", "This Month"],
  ["this_month_td", "This Month-to-date"],
  ["this_quarter", "This Fiscal Quarter"],
  ["this_quarter_td", "This Fiscal Quarter-to-date"],
  ["this_year", "This Fiscal Year"],
  ["this_year_td", "This Fiscal Year-to-date"],
  ["yesterday", "Yesterday"],
  ["last_week", "Last Week"],
  ["last_week_td", "Last Week-to-date"],
  ["last_month", "Last Month"],
  ["last_month_td", "Last Month-to-date"],
  ["last_quarter", "Last Fiscal Quarter"],
  ["last_quarter_td", "Last Fiscal Quarter-to-date"],
  ["last_year", "Last Fiscal Year"],
  ["last_year_td", "Last Fiscal Year-to-date"],
  ["custom", "Custom"],
];
// Fiscal year is treated as the calendar year (Jan-Dec) unless V&K's actual fiscal calendar differs.
function pad2(n) { return String(n).padStart(2, "0"); }
function toISO2(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfQuarter(d) { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1); }
function endOfQuarter(d) { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3 + 3, 0); }
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d) { return new Date(d.getFullYear(), 11, 31); }
function clampToMonth(year, month, day) { const last = new Date(year, month + 1, 0).getDate(); return new Date(year, month, Math.min(day, last)); }

function getPresetRange(period) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  switch (period) {
    case "all": return { from: "", to: "" };
    case "today": return { from: toISO2(today), to: toISO2(today) };
    case "yesterday": { const y = addDays(today, -1); return { from: toISO2(y), to: toISO2(y) }; }
    case "this_week": { const s = startOfWeek(today); return { from: toISO2(s), to: toISO2(addDays(s, 6)) }; }
    case "this_week_td": { const s = startOfWeek(today); return { from: toISO2(s), to: toISO2(today) }; }
    case "this_month": return { from: toISO2(startOfMonth(today)), to: toISO2(endOfMonth(today)) };
    case "this_month_td": return { from: toISO2(startOfMonth(today)), to: toISO2(today) };
    case "this_quarter": return { from: toISO2(startOfQuarter(today)), to: toISO2(endOfQuarter(today)) };
    case "this_quarter_td": return { from: toISO2(startOfQuarter(today)), to: toISO2(today) };
    case "this_year": return { from: toISO2(startOfYear(today)), to: toISO2(endOfYear(today)) };
    case "this_year_td": return { from: toISO2(startOfYear(today)), to: toISO2(today) };
    case "last_week": { const s = addDays(startOfWeek(today), -7); return { from: toISO2(s), to: toISO2(addDays(s, 6)) }; }
    case "last_week_td": { const ref = addDays(today, -7); const s = startOfWeek(ref); return { from: toISO2(s), to: toISO2(ref) }; }
    case "last_month": { const ref = new Date(today.getFullYear(), today.getMonth() - 1, 1); return { from: toISO2(startOfMonth(ref)), to: toISO2(endOfMonth(ref)) }; }
    case "last_month_td": { const ref = new Date(today.getFullYear(), today.getMonth() - 1, 1); const clamped = clampToMonth(ref.getFullYear(), ref.getMonth(), today.getDate()); return { from: toISO2(startOfMonth(ref)), to: toISO2(clamped) }; }
    case "last_quarter": { const s = startOfQuarter(today); const ref = new Date(s.getFullYear(), s.getMonth() - 3, 1); return { from: toISO2(startOfQuarter(ref)), to: toISO2(endOfQuarter(ref)) }; }
    case "last_quarter_td": { const s = startOfQuarter(today); const ref = new Date(s.getFullYear(), s.getMonth() - 3, 1); const qStart = startOfQuarter(ref); const daysIn = Math.round((today - startOfQuarter(today)) / 86400000); return { from: toISO2(qStart), to: toISO2(addDays(qStart, daysIn)) }; }
    case "last_year": { const ref = new Date(today.getFullYear() - 1, 0, 1); return { from: toISO2(startOfYear(ref)), to: toISO2(endOfYear(ref)) }; }
    case "last_year_td": { const ref = new Date(today.getFullYear() - 1, today.getMonth(), 1); const clamped = clampToMonth(ref.getFullYear(), ref.getMonth(), today.getDate()); return { from: toISO2(startOfYear(ref)), to: toISO2(clamped) }; }
    default: return { from: "", to: "" };
  }
}

/* ================= shared UI ================= */
function KpiCard({ label, value, sub, delta, deltaGood, icon: Icon, accent, onClick }) {
  const positive = delta !== undefined && delta >= 0;
  const good = deltaGood === undefined ? positive : deltaGood;
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 14, padding: "18px 20px",
        display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
        boxShadow: "0 1px 2px rgba(15,39,68,0.04)", cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: SUB, letterSpacing: 0.2 }}>{label}</span>
        {Icon && (
          <div style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: accent ? accent + "1A" : NAVY + "0F" }}>
            <Icon size={16} color={accent || NAVY} strokeWidth={2} />
          </div>
        )}
      </div>
      <span style={{ fontSize: 25, fontWeight: 700, color: NAVY, letterSpacing: -0.3 }}>{value}</span>
      {(delta !== undefined || sub) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {delta !== undefined && (
            <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 12.5, fontWeight: 700, color: good ? GREEN : RED }}>
              {good ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(delta).toFixed(1)}%
            </span>
          )}
          {sub && <span style={{ fontSize: 12.5, color: SUB }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, action, children, style }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 14, padding: "20px 22px", boxShadow: "0 1px 2px rgba(15,39,68,0.04)", ...style }}>
      {title && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 14.5, fontWeight: 700, color: NAVY, margin: 0 }}>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Pill({ children, tone = "neutral" }) {
  const map = {
    neutral: { bg: "#F1F5F9", fg: SUB }, good: { bg: "#EAF3DE", fg: "#27500A" },
    warn: { bg: "#FDF6E3", fg: "#633806" }, bad: { bg: "#FCEBEB", fg: "#791F1F" },
  };
  const s = map[tone] || map.neutral;
  return <span style={{ background: s.bg, color: s.fg, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>{children}</span>;
}

function DataTable({ columns, rows, pageSize = 12, onRowClick, defaultSort }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(defaultSort || null); // { key, dir: 'asc'|'desc' }
  useEffect(() => setPage(0), [rows.length]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const acc = col && col.sortAccessor ? col.sortAccessor : (r) => r[sort.key];
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = acc(a), bv = acc(b);
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" });
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort, columns]);

  const start = page * pageSize;
  const shown = sorted.slice(start, start + pageSize);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));

  function toggleSort(c) {
    if (!c.sortable) return;
    setSort((prev) => {
      if (!prev || prev.key !== c.key) return { key: c.key, dir: c.sortType === "number" ? "desc" : "asc" };
      return { key: c.key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
    setPage(0);
  }

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort && sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c)}
                    style={{
                      textAlign: c.align || "left", padding: "9px 10px", color: active ? NAVY : SUB, fontSize: 11.5, fontWeight: 700,
                      letterSpacing: 0.4, textTransform: "uppercase", borderBottom: `1.5px solid ${active ? NAVY : BORDER}`, whiteSpace: "nowrap",
                      cursor: c.sortable ? "pointer" : "default", userSelect: "none",
                    }}
                  >
                    {c.label}{c.sortable && <span style={{ marginLeft: 4, opacity: active ? 1 : 0.35 }}>{active ? (sort.dir === "asc" ? "\u2191" : "\u2193") : "\u2195"}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} onClick={onRowClick ? () => onRowClick(r) : undefined} style={{ background: i % 2 ? "#FBFBFA" : "#fff", cursor: onRowClick ? "pointer" : "default" }}>
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: "9px 10px", color: INK, borderBottom: `1px solid ${BORDER}`, textAlign: c.align || "left", whiteSpace: c.wrap ? "normal" : "nowrap" }}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={columns.length} style={{ padding: 20, textAlign: "center", color: SUB }}>No records match.</td></tr>}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: SUB }}>{start + 1}&ndash;{Math.min(start + pageSize, sorted.length)} of {sorted.length}</span>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ border: `1px solid ${BORDER}`, background: "#fff", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: page === 0 ? "default" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>Prev</button>
          <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} style={{ border: `1px solid ${BORDER}`, background: "#fff", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: page >= pages - 1 ? "default" : "pointer", opacity: page >= pages - 1 ? 0.4 : 1 }}>Next</button>
        </div>
      )}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 12px", boxShadow: "0 4px 12px rgba(15,39,68,0.12)" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ fontSize: 12, color: p.color, fontWeight: 600 }}>{p.name}: {fmt$(p.value)}</div>)}
    </div>
  );
}


/* ================= modal shell ================= */
function Modal({ onClose, children, width = 560 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,39,68,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width, maxWidth: "92vw", maxHeight: "84vh", overflow: "auto", boxShadow: "0 12px 40px rgba(15,39,68,0.25)" }}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "18px 22px", borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, background: "#fff" }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "#F1F5F9", borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
        <X size={15} color={SUB} />
      </button>
    </div>
  );
}

/* ================= day detail modal ================= */
function DayDetailModal({ day, onClose, onTxnClick }) {
  const [tab, setTab] = useState(day.ar_items ? "ar" : day.so_count ? "so" : "po");
  const [q, setQ] = useState("");

  const tabs = [
    { id: "ar", label: "Receivable", count: day.ar_items ? day.ar_items.length : null },
    { id: "ap", label: "Payable", count: day.ap_items ? day.ap_items.length : null },
    { id: "so", label: "Sales orders", count: day.so_count },
    { id: "po", label: "Purchase orders", count: day.po_count },
  ];

  const arRows = (day.ar_items || []).filter((it) => it.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.total - a.total);
  const apRows = (day.ap_items || []).filter((it) => it.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.total - a.total);
  const soRows = (day.so_tx || []).filter((t) => (t.entity || "").toLowerCase().includes(q.toLowerCase()));
  const poRows = (day.po_tx || []).filter((t) => (t.entity || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <Modal width={680} onClose={onClose}>
      <ModalHeader title={longDate(day.date)} subtitle={`${weekday(day.date)} snapshot`} onClose={onClose} />
      <div style={{ padding: "14px 22px 22px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setQ(""); }} style={{
              border: `1px solid ${tab === t.id ? NAVY : BORDER}`, background: tab === t.id ? NAVY : "#fff",
              color: tab === t.id ? "#fff" : INK, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>
              {t.label}{t.count != null ? ` (${t.count})` : ""}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={14} color={SUB} style={{ position: "absolute", left: 9, top: 9 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name..." style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px 7px 28px", fontSize: 12.5, width: "100%", outline: "none" }} />
        </div>

        {tab === "ar" && (
          day.ar_items ? (
            <DataTable pageSize={8} rows={arRows} defaultSort={{ key: "total", dir: "desc" }} columns={[
              { key: "name", label: "Customer", wrap: true, sortable: true, sortType: "text" },
              { key: "current", label: "Current", align: "right", sortable: true, sortType: "number", render: (r) => fmt$(r.current) },
              { key: "overdue", label: "Overdue", align: "right", sortable: true, sortType: "number", sortAccessor: (r) => r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus, render: (r) => <span style={{ color: (r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus) > 0 ? RED : INK }}>{fmt$(r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus)}</span> },
              { key: "total", label: "Balance", align: "right", sortable: true, sortType: "number", render: (r) => <b>{fmt$2(r.total)}</b> },
            ]} />
          ) : <EmptyNote text="No AR snapshot uploaded for this date yet." />
        )}
        {tab === "ap" && (
          day.ap_items ? (
            <DataTable pageSize={8} rows={apRows} defaultSort={{ key: "total", dir: "desc" }} columns={[
              { key: "name", label: "Vendor", wrap: true, sortable: true, sortType: "text" },
              { key: "current", label: "Current", align: "right", sortable: true, sortType: "number", render: (r) => fmt$(r.current) },
              { key: "overdue", label: "Overdue", align: "right", sortable: true, sortType: "number", sortAccessor: (r) => r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus, render: (r) => <span style={{ color: (r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus) > 0 ? RED : INK }}>{fmt$(r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus)}</span> },
              { key: "total", label: "Balance", align: "right", sortable: true, sortType: "number", render: (r) => <b>{fmt$2(r.total)}</b> },
            ]} />
          ) : <EmptyNote text="No AP snapshot uploaded for this date yet." />
        )}
        {tab === "so" && (
          soRows.length ? (
            <DataTable pageSize={8} rows={soRows} onRowClick={onTxnClick} columns={[
              { key: "entity", label: "Customer", wrap: true },
              { key: "type", label: "Type", render: (r) => <Pill>{r.type}</Pill> },
              { key: "memo", label: "Reference", wrap: true },
              { key: "amount", label: "Amount", align: "right", render: (r) => <b>{fmt$2(r.amount)}</b> },
            ]} />
          ) : <EmptyNote text="No sales order transactions on this date." />
        )}
        {tab === "po" && (
          poRows.length ? (
            <DataTable pageSize={8} rows={poRows} onRowClick={onTxnClick} columns={[
              { key: "entity", label: "Vendor", wrap: true },
              { key: "type", label: "Type", render: (r) => <Pill>{r.type}</Pill> },
              { key: "memo", label: "Reference", wrap: true },
              { key: "amount", label: "Amount", align: "right", render: (r) => <b>{fmt$2(r.amount)}</b> },
            ]} />
          ) : <EmptyNote text="No purchase order transactions on this date." />
        )}
      </div>
    </Modal>
  );
}

function EmptyNote({ text }) {
  return <div style={{ padding: "30px 10px", textAlign: "center", color: SUB, fontSize: 13 }}>{text}</div>;
}

/* ================= transaction detail modal ================= */
function TransactionModal({ txn, related, onClose }) {
  return (
    <Modal width={520} onClose={onClose}>
      <ModalHeader title={txn.entity || "Transaction"} subtitle={shortDate(txn.date)} onClose={onClose} />
      <div style={{ padding: "18px 22px 22px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
          <Field label="Type" value={txn.type} />
          <Field label="Amount" value={fmt$2(txn.amount)} bold />
          <Field label="Reference / num" value={txn.num || "—"} />
          <Field label="Date" value={shortDate(txn.date)} />
        </div>
        <Field label="Memo" value={txn.memo || "—"} block />
        {related && related.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, marginBottom: 8 }}>
              Other transactions for {txn.entity} that day
            </div>
            <DataTable pageSize={5} rows={related} columns={[
              { key: "type", label: "Type", render: (r) => <Pill>{r.type}</Pill> },
              { key: "memo", label: "Reference", wrap: true },
              { key: "amount", label: "Amount", align: "right", render: (r) => fmt$2(r.amount) },
            ]} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, value, bold, block }) {
  return (
    <div style={{ gridColumn: block ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: SUB, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: INK, fontWeight: bold ? 700 : 400 }}>{value}</div>
    </div>
  );
}

/* ================= aging bucket drill-down ================= */
function AgingBucketModal({ label, bucketKey, bucketKeys, items, nameLabel, onClose }) {
  const [q, setQ] = useState("");
  const keys = bucketKeys || [bucketKey];
  const valueOf = (it) => keys.reduce((s, k) => s + (it[k] || 0), 0);
  const rows = items
    .filter((it) => valueOf(it) > 0)
    .filter((it) => it.name.toLowerCase().includes(q.toLowerCase()))
    .map((it) => ({ ...it, _bucketValue: valueOf(it) }))
    .sort((a, b) => b._bucketValue - a._bucketValue);
  const bucketSum = rows.reduce((s, it) => s + it._bucketValue, 0);

  return (
    <Modal width={560} onClose={onClose}>
      <ModalHeader title={label} subtitle={`${rows.length} ${nameLabel.toLowerCase()} · ${fmt$(bucketSum)} in this bucket`} onClose={onClose} />
      <div style={{ padding: "14px 22px 22px" }}>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={14} color={SUB} style={{ position: "absolute", left: 9, top: 9 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${nameLabel.toLowerCase()}...`} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px 7px 28px", fontSize: 12.5, width: "100%", outline: "none" }} />
        </div>
        {rows.length ? (
          <DataTable pageSize={8} rows={rows} defaultSort={{ key: "_bucketValue", dir: "desc" }} columns={[
            { key: "name", label: nameLabel, wrap: true, sortable: true, sortType: "text" },
            { key: "_bucketValue", label: label, align: "right", sortable: true, sortType: "number", render: (r) => <b>{fmt$2(r._bucketValue)}</b> },
            { key: "total", label: "Total balance", align: "right", sortable: true, sortType: "number", render: (r) => fmt$2(r.total) },
          ]} />
        ) : <EmptyNote text={`Nobody falls into ${label.toLowerCase()} right now.`} />}
      </div>
    </Modal>
  );
}



/* ================= sidebar ================= */
function Sidebar({ page, setPage }) {
  const items = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "ar", label: "Accounts receivable", icon: Receipt },
    { id: "ap", label: "Accounts payable", icon: Landmark },
    { id: "so", label: "Sales orders", icon: FileSpreadsheet },
    { id: "po", label: "Purchase orders", icon: ShoppingCart },
    { id: "import", label: "Import data", icon: UploadCloud },
  ];
  return (
    <div style={{ width: 224, flexShrink: 0, background: NAVY, minHeight: "100%", padding: "24px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ padding: "0 10px 20px 10px" }}>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>V&K Group</div>
        <div style={{ color: GOLD, fontSize: 11, fontWeight: 600, marginTop: 2 }}>FINANCIAL DASHBOARD</div>
      </div>
      {items.map((it) => {
        const active = page === it.id;
        const Icon = it.icon;
        return (
          <button key={it.id} onClick={() => setPage(it.id)} style={{
            display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9, border: "none",
            cursor: "pointer", textAlign: "left", background: active ? "rgba(201,162,39,0.16)" : "transparent",
            color: active ? GOLD : "rgba(255,255,255,0.72)", fontSize: 13.5, fontWeight: active ? 700 : 500,
          }}>
            <Icon size={17} strokeWidth={2} />{it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ================= top filter bar ================= */
function FilterBar({ period, setPeriod, range, setRange, dataSpan }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
      <select
        value={period}
        onChange={(e) => {
          const p = e.target.value;
          setPeriod(p);
          if (p !== "custom") setRange(getPresetRange(p));
        }}
        style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, fontWeight: 600, color: NAVY, background: "#fff" }}
      >
        {PERIOD_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
      </select>
      {period === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "5px 10px", background: "#fff" }}>
          <Calendar size={14} color={SUB} />
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} style={{ border: "none", fontSize: 12.5, outline: "none", color: INK }} />
          <span style={{ color: SUB, fontSize: 12.5 }}>to</span>
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} style={{ border: "none", fontSize: 12.5, outline: "none", color: INK }} />
        </div>
      )}
      {dataSpan && <span style={{ fontSize: 12, color: SUB, marginLeft: "auto" }}>Data available: {dataSpan}</span>}
    </div>
  );
}


/* ================= overview ================= */
function Overview({ daily, setPage, openDay }) {
  const [bucket, setBucket] = useState(null);
  if (!daily.length) return <EmptyNote text="No data for this range yet. Upload files from Import data." />;
  const first = daily[0], last = daily[daily.length - 1];
  const lastAR = latestWithField(daily, "ar_total");
  const lastAP = latestWithField(daily, "ap_total");
  const totalSO = round2(daily.reduce((s, d) => s + d.so_total, 0));
  const totalPO = round2(daily.reduce((s, d) => s + d.po_total, 0));
  const netPosition = lastAR && lastAP ? round2(lastAR.ar_total - lastAP.ap_total) : null;
  const arDelta = lastAR && first.ar_total != null ? ((lastAR.ar_total - first.ar_total) / first.ar_total) * 100 : undefined;
  const apDelta = lastAP && first.ap_total != null ? ((lastAP.ap_total - first.ap_total) / first.ap_total) * 100 : undefined;

  const trendData = daily.map((d) => ({ date: shortDate(d.date), so: Math.round(d.so_total), po: Math.round(d.po_total), raw: d }));
  const arAging = agingSlices(lastAR, "ar_items");
  const apAging = agingSlices(lastAP, "ap_items");

  const arCustomers = lastAR ? [...lastAR.ar_items].sort((a, b) => b.total - a.total).slice(0, 8) : [];
  const apVendors = lastAP ? [...lastAP.ap_items].sort((a, b) => b.total - a.total).slice(0, 8) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: 0 }}>Financial overview</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <KpiCard label="Accounts receivable" value={lastAR ? fmt$(lastAR.ar_total) : "—"} sub={lastAR ? shortDate(lastAR.date) : ""} delta={arDelta} deltaGood={arDelta !== undefined && arDelta <= 0} icon={Receipt} accent={BLUE} onClick={lastAR ? () => openDay(lastAR) : undefined} />
        <KpiCard label="Accounts payable" value={lastAP ? fmt$(lastAP.ap_total) : "—"} sub={lastAP ? shortDate(lastAP.date) : ""} delta={apDelta} deltaGood={apDelta !== undefined && apDelta <= 0} icon={Landmark} accent={RED} onClick={lastAP ? () => openDay(lastAP) : undefined} />
        <KpiCard label="Net position" value={netPosition != null ? fmt$(netPosition) : "—"} sub={netPosition != null ? (netPosition >= 0 ? "AR exceeds AP" : "AP exceeds AR") : ""} icon={TrendingUp} accent={netPosition >= 0 ? GREEN : RED} />
        <KpiCard label="Sales orders" value={fmt$(totalSO)} sub={`${daily.reduce((s, d) => s + d.so_count, 0)} transactions`} icon={FileSpreadsheet} accent={GOLD} />
      </div>

      <SectionCard title="Daily sales orders vs purchase orders">
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} onClick={(e) => e && e.activePayload && openDay(e.activePayload[0].payload.raw)}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: SUB }} axisLine={{ stroke: BORDER }} tickLine={false} interval={Math.ceil(trendData.length / 15)} />
            <YAxis tick={{ fontSize: 11, fill: SUB }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="so" name="Sales orders" stroke={BLUE} strokeWidth={2.2} dot={{ r: 3, cursor: "pointer" }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="po" name="Purchase orders" stroke={GOLD} strokeWidth={2.2} dot={{ r: 3, cursor: "pointer" }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 18, marginTop: 6, fontSize: 12, color: SUB }}>
          <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: BLUE, marginRight: 6 }} />Sales orders</span>
          <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: GOLD, marginRight: 6 }} />Purchase orders</span>
          <span style={{ marginLeft: "auto" }}>Click a point to see that day's detail</span>
        </div>
      </SectionCard>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <SectionCard title="AR aging" action={<button onClick={() => setPage("ar")} style={{ border: "none", background: "none", color: BLUE, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>View <ChevronRight size={13} /></button>}>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={arAging} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2} cursor="pointer" onClick={(d) => lastAR && setBucket({ ...d, kind: "ar" })}>
                {arAging.map((e, i) => <Cell key={i} fill={AGING_COLORS[e.key]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {arAging.map((e) => <span key={e.key} style={{ fontSize: 11.5, color: SUB, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: AGING_COLORS[e.key] }} />{e.name}: {fmt$(e.value)}</span>)}
          </div>
        </SectionCard>
        <SectionCard title="AP aging" action={<button onClick={() => setPage("ap")} style={{ border: "none", background: "none", color: BLUE, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>View <ChevronRight size={13} /></button>}>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={apAging} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2} cursor="pointer" onClick={(d) => lastAP && setBucket({ ...d, kind: "ap" })}>
                {apAging.map((e, i) => <Cell key={i} fill={AGING_COLORS[e.key]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {apAging.map((e) => <span key={e.key} style={{ fontSize: 11.5, color: SUB, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: AGING_COLORS[e.key] }} />{e.name}: {fmt$(e.value)}</span>)}
          </div>
        </SectionCard>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <SectionCard title="Customers with a balance">
          <DataTable pageSize={6} defaultSort={{ key: "total", dir: "desc" }} rows={arCustomers} onRowClick={lastAR ? () => openDay(lastAR) : undefined} columns={[
            { key: "name", label: "Customer", wrap: true, sortable: true, sortType: "text" },
            { key: "total", label: "Balance", align: "right", sortable: true, sortType: "number", render: (r) => <b>{fmt$2(r.total)}</b> },
          ]} />
        </SectionCard>
        <SectionCard title="Vendors with a balance">
          <DataTable pageSize={6} defaultSort={{ key: "total", dir: "desc" }} rows={apVendors} onRowClick={lastAP ? () => openDay(lastAP) : undefined} columns={[
            { key: "name", label: "Vendor", sortable: true, sortType: "text" },
            { key: "total", label: "Balance", align: "right", sortable: true, sortType: "number", render: (r) => <b>{fmt$2(r.total)}</b> },
          ]} />
        </SectionCard>
      </div>

      {bucket && (
        <AgingBucketModal
          label={bucket.name}
          bucketKey={bucket.key}
          items={bucket.kind === "ar" ? lastAR.ar_items : lastAP.ap_items}
          nameLabel={bucket.kind === "ar" ? "Customers" : "Vendors"}
          onClose={() => setBucket(null)}
        />
      )}
    </div>
  );
}

/* ================= AR page ================= */
function ARPage({ daily, openDay }) {
  const [bucket, setBucket] = useState(null);
  if (!daily.length) return <EmptyNote text="No AR data for this range." />;
  const first = daily[0];
  const last = latestWithField(daily, "ar_total");
  if (!last) return <EmptyNote text="No AR snapshots uploaded for this range yet." />;
  const aging = agingSlices(last, "ar_items");
  const trend = daily.filter((d) => d.ar_total != null).map((d) => ({ date: shortDate(d.date), value: Math.round(d.ar_total), raw: d }));
  const pctCurrent = (last.ar_items.reduce((s, i) => s + i.current, 0) / last.ar_total) * 100;
  const overdue = last.ar_total - last.ar_items.reduce((s, i) => s + i.current, 0);
  const customers = [...last.ar_items].sort((a, b) => b.total - a.total);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: 0 }}>Accounts receivable</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <KpiCard label="Total outstanding" value={fmt$(last.ar_total)} sub={`${last.ar_count} customers · ${shortDate(last.date)}`} icon={Receipt} accent={BLUE} onClick={() => openDay(last)} />
        <KpiCard label="Current" value={pctCurrent.toFixed(1) + "%"} sub={fmt$(last.ar_items.reduce((s, i) => s + i.current, 0))} icon={TrendingUp} accent={GREEN} onClick={() => setBucket({ name: "Current", key: "current" })} />
        <KpiCard label="Overdue (1-90+)" value={fmt$(overdue)} sub={((overdue / last.ar_total) * 100).toFixed(1) + "% of total"} icon={AlertTriangle} accent={RED} onClick={() => setBucket({ name: "Overdue (1-90+)", keys: ["d1_30", "d31_60", "d61_90", "d90plus"] })} />
        {first.ar_total != null && (
          <KpiCard label="Change over range" value={fmt$(last.ar_total - first.ar_total)} delta={((last.ar_total - first.ar_total) / first.ar_total) * 100} deltaGood={last.ar_total <= first.ar_total} icon={TrendingDown} accent={GOLD} />
        )}
      </div>

      <SectionCard title="AR balance trend">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} onClick={(e) => e && e.activePayload && openDay(e.activePayload[0].payload.raw)}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: SUB }} axisLine={{ stroke: BORDER }} tickLine={false} interval={Math.ceil(trend.length / 15)} />
            <YAxis tick={{ fontSize: 11, fill: SUB }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="value" name="AR balance" stroke={BLUE} fill={BLUE} fillOpacity={0.1} strokeWidth={2.2} dot={{ r: 3, cursor: "pointer" }} />
          </AreaChart>
        </ResponsiveContainer>
      </SectionCard>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <SectionCard title={`Aging breakdown (${shortDate(last.date)})`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={aging} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: SUB }} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} width={80} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => setBucket(d)}>
                {aging.map((e, i) => <Cell key={i} fill={AGING_COLORS[e.key]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11.5, color: SUB, marginTop: 4 }}>Click a bar to see who's in that bucket</div>
        </SectionCard>
        <SectionCard title="Customers with a balance">
          <DataTable pageSize={7} defaultSort={{ key: "total", dir: "desc" }} rows={customers} columns={[
            { key: "name", label: "Customer", wrap: true, sortable: true, sortType: "text" },
            { key: "total", label: "Balance", align: "right", sortable: true, sortType: "number", render: (r) => <b style={{ color: r.total < 0 ? GREEN : INK }}>{fmt$2(r.total)}</b> },
          ]} />
        </SectionCard>
      </div>

      <SectionCard title="Daily AR snapshot log">
        <DataTable pageSize={10} rows={daily.filter((d) => d.ar_total != null)} onRowClick={openDay} columns={[
          { key: "date", label: "Date", render: (r) => `${shortDate(r.date)} (${weekday(r.date)})` },
          { key: "ar_count", label: "Customers", align: "right" },
          { key: "ar_total", label: "Total balance", align: "right", render: (r) => <b>{fmt$2(r.ar_total)}</b> },
        ]} />
      </SectionCard>

      {bucket && <AgingBucketModal label={bucket.name} bucketKey={bucket.key} bucketKeys={bucket.keys} items={last.ar_items} nameLabel="Customers" onClose={() => setBucket(null)} />}
    </div>
  );
}

/* ================= AP page ================= */
function APPage({ daily, openDay }) {
  const [bucket, setBucket] = useState(null);
  if (!daily.length) return <EmptyNote text="No AP data for this range." />;
  const first = daily[0];
  const last = latestWithField(daily, "ap_total");
  if (!last) return <EmptyNote text="No AP snapshots uploaded for this range yet." />;
  const aging = agingSlices(last, "ap_items");
  const trend = daily.filter((d) => d.ap_total != null).map((d) => ({ date: shortDate(d.date), value: Math.round(d.ap_total), raw: d }));
  const pctCurrent = (last.ap_items.reduce((s, i) => s + i.current, 0) / last.ap_total) * 100;
  const overdue = last.ap_total - last.ap_items.reduce((s, i) => s + i.current, 0);
  const vendors = [...last.ap_items].sort((a, b) => b.total - a.total);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: 0 }}>Accounts payable</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <KpiCard label="Total outstanding" value={fmt$(last.ap_total)} sub={`${last.ap_count} vendors · ${shortDate(last.date)}`} icon={Landmark} accent={RED} onClick={() => openDay(last)} />
        <KpiCard label="Current" value={pctCurrent.toFixed(1) + "%"} sub={fmt$(last.ap_items.reduce((s, i) => s + i.current, 0))} icon={TrendingUp} accent={GREEN} onClick={() => setBucket({ name: "Current", key: "current" })} />
        <KpiCard label="Overdue (1-90+)" value={fmt$(overdue)} sub={((overdue / last.ap_total) * 100).toFixed(1) + "% of total"} icon={AlertTriangle} accent={RED} onClick={() => setBucket({ name: "Overdue (1-90+)", keys: ["d1_30", "d31_60", "d61_90", "d90plus"] })} />
        {first.ap_total != null && (
          <KpiCard label="Change over range" value={fmt$(last.ap_total - first.ap_total)} delta={((last.ap_total - first.ap_total) / first.ap_total) * 100} deltaGood={last.ap_total <= first.ap_total} icon={TrendingDown} accent={GOLD} />
        )}
      </div>

      <SectionCard title="AP balance trend">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} onClick={(e) => e && e.activePayload && openDay(e.activePayload[0].payload.raw)}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: SUB }} axisLine={{ stroke: BORDER }} tickLine={false} interval={Math.ceil(trend.length / 15)} />
            <YAxis tick={{ fontSize: 11, fill: SUB }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="value" name="AP balance" stroke={GOLD} fill={GOLD} fillOpacity={0.12} strokeWidth={2.2} dot={{ r: 3, cursor: "pointer" }} />
          </AreaChart>
        </ResponsiveContainer>
      </SectionCard>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <SectionCard title={`Aging breakdown (${shortDate(last.date)})`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={aging} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: SUB }} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} width={80} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => setBucket(d)}>
                {aging.map((e, i) => <Cell key={i} fill={AGING_COLORS[e.key]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11.5, color: SUB, marginTop: 4 }}>Click a bar to see who's in that bucket</div>
        </SectionCard>
        <SectionCard title="Vendors with a balance">
          <DataTable pageSize={7} defaultSort={{ key: "total", dir: "desc" }} rows={vendors} columns={[
            { key: "name", label: "Vendor", wrap: true, sortable: true, sortType: "text" },
            { key: "total", label: "Balance", align: "right", sortable: true, sortType: "number", render: (r) => <b>{fmt$2(r.total)}</b> },
          ]} />
        </SectionCard>
      </div>

      <SectionCard title="Daily AP snapshot log">
        <DataTable pageSize={10} rows={daily.filter((d) => d.ap_total != null)} onRowClick={openDay} columns={[
          { key: "date", label: "Date", render: (r) => `${shortDate(r.date)} (${weekday(r.date)})` },
          { key: "ap_count", label: "Vendors", align: "right" },
          { key: "ap_total", label: "Total balance", align: "right", render: (r) => <b>{fmt$2(r.ap_total)}</b> },
        ]} />
      </SectionCard>

      {bucket && <AgingBucketModal label={bucket.name} bucketKey={bucket.key} bucketKeys={bucket.keys} items={last.ap_items} nameLabel="Vendors" onClose={() => setBucket(null)} />}
    </div>
  );
}

/* ================= SO / PO transaction page ================= */
function TxnPage({ title, daily, kindKey, transactions, accent, icon: Icon, onTxnClick }) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dayModal, setDayModal] = useState(null); // { date, txns }
  const total = round2(transactions.reduce((s, t) => s + t.amount, 0));
  const trend = daily.map((d) => ({ date: shortDate(d.date), value: Math.round(d[kindKey + "_total"]), rawDate: d.date }));
  const types = useMemo(() => [...new Set(transactions.map((t) => t.type).filter(Boolean))].sort(), [transactions]);

  const filtered = useMemo(() => {
    let rows = transactions;
    if (typeFilter !== "all") rows = rows.filter((t) => t.type === typeFilter);
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter((t) => (t.entity || "").toLowerCase().includes(s) || (t.memo || "").toLowerCase().includes(s) || (t.type || "").toLowerCase().includes(s) || (t.num || "").toLowerCase().includes(s));
    }
    return rows;
  }, [q, typeFilter, transactions]);

  if (!daily.length) return <EmptyNote text="No data for this range." />;
  const busiest = daily.reduce((a, b) => (b[kindKey + "_count"] > a[kindKey + "_count"] ? b : a), daily[0]);

  function openDayBar(payload) {
    const date = payload.rawDate;
    const txns = transactions.filter((t) => t.date === date);
    setDayModal({ date, txns });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: 0 }}>{title}</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <KpiCard label="Total value" value={fmt$(total)} sub={`${transactions.length} transactions`} icon={Icon} accent={accent} />
        <KpiCard label="Average per day" value={fmt$(total / Math.max(1, daily.length))} sub={`across ${daily.length} days`} icon={TrendingUp} accent={GOLD} />
        <KpiCard label="Busiest day" value={shortDate(busiest.date)} sub={`${busiest[kindKey + "_count"]} transactions`} icon={FileSpreadsheet} accent={BLUE} onClick={() => openDayBar({ rawDate: busiest.date })} />
      </div>

      <SectionCard title="Daily transaction value">
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: SUB }} axisLine={{ stroke: BORDER }} tickLine={false} interval={Math.ceil(trend.length / 15)} />
            <YAxis tick={{ fontSize: 11, fill: SUB }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" name="Daily total" fill={accent} radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => openDayBar(d)} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11.5, color: SUB, marginTop: 4 }}>Click a bar to see that day's transactions</div>
      </SectionCard>

      <SectionCard title="All transactions" action={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 12.5 }}>
            <option value="all">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ position: "relative" }}>
            <Search size={14} color={SUB} style={{ position: "absolute", left: 9, top: 8 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search entity, memo, type..." style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px 6px 28px", fontSize: 12.5, width: 200, outline: "none" }} />
          </div>
        </div>
      }>
        <DataTable pageSize={12} rows={filtered} onRowClick={onTxnClick} defaultSort={{ key: "date", dir: "desc" }} columns={[
          { key: "date", label: "Date", sortable: true, sortType: "text", render: (r) => shortDate(r.date) },
          { key: "entity", label: "Entity", wrap: true, sortable: true, sortType: "text" },
          { key: "type", label: "Type", sortable: true, sortType: "text", render: (r) => <Pill>{r.type}</Pill> },
          { key: "memo", label: "Memo / reference", wrap: true },
          { key: "amount", label: "Amount", align: "right", sortable: true, sortType: "number", render: (r) => <b>{fmt$2(r.amount)}</b> },
        ]} />
      </SectionCard>

      {dayModal && (
        <Modal width={620} onClose={() => setDayModal(null)}>
          <ModalHeader title={longDate(dayModal.date)} subtitle={`${dayModal.txns.length} transactions`} onClose={() => setDayModal(null)} />
          <div style={{ padding: "14px 22px 22px" }}>
            <DataTable pageSize={8} rows={dayModal.txns} onRowClick={(t) => { setDayModal(null); onTxnClick(t); }} defaultSort={{ key: "amount", dir: "desc" }} columns={[
              { key: "entity", label: "Entity", wrap: true, sortable: true, sortType: "text" },
              { key: "type", label: "Type", sortable: true, sortType: "text", render: (r) => <Pill>{r.type}</Pill> },
              { key: "memo", label: "Memo / reference", wrap: true },
              { key: "amount", label: "Amount", align: "right", sortable: true, sortType: "number", render: (r) => <b>{fmt$2(r.amount)}</b> },
            ]} />
          </div>
        </Modal>
      )}
    </div>
  );
}


/* ================= import page (uploads go to the backend) ================= */
function ImportPage({ history, onImported }) {
  const [kind, setKind] = useState("so");
  const [snapDate, setSnapDate] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState(null);
  const fileRef = useRef(null);
  const needsDate = kind === "ar" || kind === "ap";

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (needsDate && !snapDate) { setStatus({ ok: false, msg: "Pick the snapshot date for this file first." }); return; }
    setBusy(true);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      if (needsDate) form.append("date", snapDate);
      const res = await fetch(`${API}/api/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setStatus({ ok: true, msg: kind === "ar" || kind === "ap" ? `Imported ${data.count} records for ${data.date}.` : `Imported ${data.count} transactions.` });
      onImported();
    } catch (err) {
      setStatus({ ok: false, msg: err.message || "Could not process that file." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteHistoryRow(row) {
    const isSnapshot = row.kind === "ar" || row.kind === "ap";
    const confirmMsg = isSnapshot
      ? `Delete "${row.filename}"? This also removes its ${row.kind.toUpperCase()} snapshot data.`
      : `Delete "${row.filename}" from the log? Note: this removes the log entry only, not the transaction data it added - use "Clean up bad dates" below if this upload contained wrong data.`;
    if (!window.confirm(confirmMsg)) return;
    const res = await fetch(`${API}/api/history/${row.id}`, { method: "DELETE" });
    if (res.ok) onImported();
  }

  async function runCleanup() {
    if (!window.confirm("This removes any Sales/Purchase Order records with an implausible date (a sign an AR/AP file was accidentally uploaded as the wrong type). Continue?")) return;
    const res = await fetch(`${API}/api/cleanup/invalid-dates`, { method: "POST" });
    const data = await res.json();
    setCleanupStatus(data.ok ? { ok: true, msg: `Removed ${data.soRemoved} sales order and ${data.poRemoved} purchase order record(s) with invalid dates.` } : { ok: false, msg: "Cleanup failed." });
    onImported();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: 0 }}>Import data</h1>

      <SectionCard title="Upload a file">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, marginBottom: 5 }}>FILE TYPE</div>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px", fontSize: 13 }}>
              <option value="so">Sales orders (month master file)</option>
              <option value="po">Purchase orders (month master file)</option>
              <option value="ar">Accounts receivable (daily snapshot)</option>
              <option value="ap">Accounts payable (daily snapshot)</option>
            </select>
          </div>
          {needsDate && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, marginBottom: 5 }}>SNAPSHOT DATE</div>
              <input type="date" value={snapDate} onChange={(e) => setSnapDate(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 13 }} />
            </div>
          )}
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, marginBottom: 5 }}>FILE (.XLSX OR .CSV)</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={handleFile} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 13 }} />
          </div>
        </div>
        {busy && <div style={{ fontSize: 12.5, color: SUB }}>Uploading and parsing…</div>}
        {status && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, fontSize: 12.5, background: status.ok ? "#EAF3DE" : "#FCEBEB", color: status.ok ? "#27500A" : "#791F1F" }}>
            {status.ok ? <Check size={14} /> : <AlertTriangle size={14} />}{status.msg}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Upload history" action={
        <button onClick={runCleanup} style={{ border: `1px solid ${BORDER}`, background: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", color: SUB }}>
          Clean up bad dates
        </button>
      }>
        {cleanupStatus && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 12, background: cleanupStatus.ok ? "#EAF3DE" : "#FCEBEB", color: cleanupStatus.ok ? "#27500A" : "#791F1F" }}>
            {cleanupStatus.ok ? <Check size={14} /> : <AlertTriangle size={14} />}{cleanupStatus.msg}
          </div>
        )}        {history.length === 0 ? (
          <EmptyNote text="No files imported yet — anything you upload above will be logged here." />
        ) : (
          <DataTable pageSize={10} rows={history} columns={[
            { key: "when", label: "Uploaded", render: (r) => new Date(r.when).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) },
            { key: "filename", label: "File", wrap: true },
            { key: "kind", label: "Type", render: (r) => <Pill>{({ so: "Sales orders", po: "Purchase orders", ar: "AR snapshot", ap: "AP snapshot" })[r.kind] || r.kind}</Pill> },
            { key: "detail", label: "Detail" },
            { key: "actions", label: "", align: "right", render: (r) => (
              <button onClick={() => deleteHistoryRow(r)} style={{ border: "none", background: "none", color: RED, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}>
                Delete
              </button>
            ) },
          ]} />
        )}
      </SectionCard>
    </div>
  );
}

/* ================= main app ================= */
export default function App() {
  const [page, setPage] = useState("overview");
  const [months, setMonths] = useState([]);
  const [allData, setAllData] = useState(null);
  const [period, setPeriod] = useState("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [history, setHistory] = useState([]);
  const [dayModal, setDayModal] = useState(null);
  const [txnModal, setTxnModal] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  async function loadMonths() {
    const res = await fetch(`${API}/api/months`);
    setMonths(await res.json());
  }
  async function loadAllData() {
    const res = await fetch(`${API}/api/data/all`);
    setAllData(await res.json());
  }
  async function loadHistory() {
    const res = await fetch(`${API}/api/history`);
    setHistory(await res.json());
  }

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadMonths(), loadAllData(), loadHistory()]);
      } catch (e) {
        setError("Could not reach the dashboard API. Is the server running?");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  async function handleImported() {
    await Promise.all([loadMonths(), loadAllData(), loadHistory()]);
  }

  const dailyAll = useMemo(() => getDailyForMonth(allData), [allData]);
  const daily = useMemo(() => filterByRange(dailyAll, range.from, range.to), [dailyAll, range]);

  const soAll = allData ? allData.so : [];
  const poAll = allData ? allData.po : [];
  const soFiltered = soAll.filter((t) => (!range.from || t.date >= range.from) && (!range.to || t.date <= range.to));
  const poFiltered = poAll.filter((t) => (!range.from || t.date >= range.from) && (!range.to || t.date <= range.to));

  const dataSpan = useMemo(() => {
    if (!months.length) return "";
    return months.length === 1 ? months[0].label : `${months[0].label} – ${months[months.length - 1].label}`;
  }, [months]);

  function openTxn(t) {
    const pool = soAll.includes(t) ? soAll : (poAll.includes(t) ? poAll : [...soAll, ...poAll]);
    const related = pool.filter((x) => x !== t && x.entity === t.entity && x.date === t.date);
    setTxnModal({ txn: t, related });
  }

  if (!ready) return <div style={{ padding: 60, textAlign: "center", color: SUB, fontFamily: "sans-serif" }}>Loading dashboard…</div>;
  if (error) return <div style={{ padding: 60, textAlign: "center", color: RED, fontFamily: "sans-serif" }}>{error}</div>;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans','Inter',-apple-system,'Segoe UI',sans-serif", display: "flex", minHeight: "100vh", background: CREAM }}>
      <Sidebar page={page} setPage={setPage} />
      <div style={{ flex: 1, padding: "26px 30px", overflowX: "hidden" }}>
        {page !== "import" && (
          <FilterBar period={period} setPeriod={setPeriod} range={range} setRange={setRange} dataSpan={dataSpan} />
        )}
        {page === "overview" && <Overview daily={daily} setPage={setPage} openDay={setDayModal} />}
        {page === "ar" && <ARPage daily={daily} openDay={setDayModal} />}
        {page === "ap" && <APPage daily={daily} openDay={setDayModal} />}
        {page === "so" && <TxnPage title="Sales orders" daily={daily} kindKey="so" transactions={soFiltered} accent={BLUE} icon={FileSpreadsheet} onTxnClick={openTxn} />}
        {page === "po" && <TxnPage title="Purchase orders" daily={daily} kindKey="po" transactions={poFiltered} accent={GOLD} icon={ShoppingCart} onTxnClick={openTxn} />}
        {page === "import" && <ImportPage history={history} onImported={handleImported} />}
      </div>

      {dayModal && <DayDetailModal day={dayModal} onClose={() => setDayModal(null)} onTxnClick={(t) => { setDayModal(null); openTxn(t); }} />}
      {txnModal && <TransactionModal txn={txnModal.txn} related={txnModal.related} onClose={() => setTxnModal(null)} />}
    </div>
  );
}
