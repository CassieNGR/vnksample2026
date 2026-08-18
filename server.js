/**
 * V&K Sample Request Portal: Node/Express backend for Render.
 *
 * WHAT THIS DOES
 * Serves the app (public/index.html) and a small JSON API:
 *   POST  /api/requests      save a new sample request, assign it an id +
 *                            date, and email the coordinators (see
 *                            COORDINATOR_NOTIFY_EMAILS below).
 *   GET   /api/requests      return every saved request, newest last.
 *   PATCH /api/requests/:id  update an existing request (used when tracking
 *                            numbers/shipment info get added or edited later
 *                            on the dashboard, so those edits are actually
 *                            saved, not just held in that browser tab).
 *
 * Requests are stored as plain JSON in a file on disk (DATA_DIR/requests.json).
 * That file is always the source of truth for the app. If SHEETS_MIRROR_URL
 * is set, every saved request is also pushed to a Google Sheet as a
 * best-effort copy, purely for viewing/filtering in Sheets, it's never read
 * back by the app. The vendor request email is never sent by this server,
 * or by the app at all. It's always just drafted on the Email Templates
 * tab, and the coordinator or rep reviews it and sends it themselves.
 *
 * See README.md for how to deploy this on Render.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// On Render, set DATA_DIR to the mount path of a persistent Disk (recommended)
// so saved requests survive redeploys and restarts. Without a Disk attached,
// this still works, but the file only lives on that instance's local disk.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'requests.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readRequests() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Could not read requests.json, starting from an empty list:', err);
    return [];
  }
}

function writeRequests(list) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function nextId(existing) {
  const now = new Date();
  const stamp = 'VK-' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + '-';
  const seqForThisMonth = existing.filter((r) => typeof r.id === 'string' && r.id.startsWith(stamp)).length;
  return stamp + (1000 + seqForThisMonth + 1);
}

/* ---------------- mail ----------------
   Every new submission notifies this fixed list, no matter which rep
   submitted it, so the coordination team never misses a request. This is
   NOT the vendor request email, that one is never sent automatically by
   this server or the app, it's always just drafted for the coordinator or
   rep to open and send themselves. */
const COORDINATOR_NOTIFY_EMAILS = [
  'cassandra@tabletopreps.com',
  'jexy@tabletopreps.com',
  'aleyah@tabletopreps.com',
];

const LOGO_PATH = path.join(__dirname, 'assets', 'ngr-logo.png');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Matches the "Email Templates" preview shown inside the app itself, so the
// real email that lands in an inbox looks the same as what's previewed there.
//
// Built as nested tables (not divs) with the font-family and font-size
// repeated on every single cell, rather than relying on inheritance from an
// outer wrapper. Gmail and other webmail clients often ignore inherited
// font styles inside a <table>, which is why the first version of this email
// showed up in a plain serif font at the wrong size, this rewrite sets it
// explicitly everywhere so it renders consistently.
function buildNotificationHtml(req) {
  const FONT = 'font-family:Arial, Helvetica, sans-serif;';
  const money = (n) => '$' + Number(n || 0).toLocaleString();
  const dateStr = new Date(req.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const row = (label, value, bold) => `
    <tr>
      <td style="${FONT} padding:9px 0; font-size:15px; color:#6b6a66; width:150px; vertical-align:top;">${label}</td>
      <td style="${FONT} padding:9px 0; font-size:15px; color:#1c1c1c; font-weight:${bold ? '700' : '400'}; vertical-align:top;">${value}</td>
    </tr>`;

  const vendorRows = (req.vendors || []).map((v) => {
    const items = (v.items || []).map(escapeHtml).join(', ') || 'N/A';
    const desc = v.desc ? `<br><span style="${FONT} color:#898781; font-size:13px;">${escapeHtml(v.desc)}</span>` : '';
    return row(escapeHtml(v.name), items + desc, false);
  }).join('');

  const leadBadge = `<span style="${FONT} display:inline-block; background:${req.lead ? '#e3f6f1' : '#eef0f2'}; color:${req.lead ? '#0d8a79' : '#7a7873'}; font-size:12px; font-weight:700; padding:4px 11px; border-radius:999px;">${req.lead ? 'YES' : 'NO'}</span>`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${FONT} background:#f2f3f5; padding:26px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="${FONT} width:600px; max-width:600px; background:#ffffff; border:1px solid #e1e0d9; border-radius:10px;">
          <tr>
            <td style="${FONT} background-color:#132c42; background-image:linear-gradient(135deg,#0f2438,#16324a); padding:28px 34px 32px; border-radius:10px 10px 0 0;">
              <img src="cid:ngrlogo" alt="New Generation Reps" width="150" style="height:auto; max-height:36px; display:block; margin-bottom:16px; border:0;" />
              <div style="${FONT} font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#7fd8c9; font-weight:700;">V&amp;K SAMPLE PORTAL</div>
              <div style="${FONT} font-size:23px; font-weight:800; margin-top:8px; color:#ffffff; line-height:1.35;">A new sample request just came in</div>
              <div style="${FONT} font-size:14.5px; color:#c9d5df; margin-top:6px;">Submitted by ${escapeHtml(req.rep)} on ${dateStr}</div>
            </td>
          </tr>
          <tr>
            <td style="${FONT} padding:30px 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${FONT} width:100%;">
                ${row('Request ID', escapeHtml(req.id), true)}
                ${row('Customer', escapeHtml(req.customer), true)}
                ${row('Project', escapeHtml(req.project), false)}
                ${row('Segment', escapeHtml(req.segment), false)}
                ${row('Amount', money(req.amount), true)}
                ${row('Needed By', escapeHtml(req.neededBy), false)}
                ${row('Ship To', escapeHtml(req.address), false)}
                ${row('Attention To', escapeHtml(req.attn), false)}
                ${row('Add to Lead', leadBadge, false)}
              </table>
              <div style="${FONT} margin-top:24px; font-size:13px; letter-spacing:0.5px; text-transform:uppercase; color:#898781; font-weight:700;">Vendors &amp; Items</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${FONT} width:100%; margin-top:6px;">
                ${vendorRows}
              </table>
              ${req.notes ? `<div style="${FONT} margin-top:22px; font-size:14.5px; color:#52514e; line-height:1.5;"><b>Notes:</b> ${escapeHtml(req.notes)}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="${FONT} padding:16px 34px; background:#f7f8fa; font-size:12.5px; color:#898781; border-top:1px solid #e1e0d9; border-radius:0 0 10px 10px;">This is an automated notification from the V&amp;K Sample Request Portal.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendNotification(req) {
  const transport = getTransport();
  if (!transport) return false;

  // always goes to the coordinators, plus the submitter's own address too
  // if they opted into that with the "Also email me a copy?" toggle
  const recipients = COORDINATOR_NOTIFY_EMAILS.slice();
  if (req.notifyMe && req.repEmail && !recipients.includes(req.repEmail)) {
    recipients.push(req.repEmail);
  }

  const vendorLines = (req.vendors || []).map((v, i) => {
    const items = (v.items || []).join(', ') || 'N/A';
    let block = `Vendor ${i + 1}: ${v.name || ''}\nItems: ${items}`;
    if (v.desc) block += `\nDescription: ${v.desc}`;
    return block;
  }).join('\n\n');

  const subject = `New Sample Request Submitted: ${req.customer} (${req.id})`;
  const text =
    'NEW SAMPLE REQUEST - V&K / New Generation Reps\n' +
    '============================================\n\n' +
    `Request ID     : ${req.id}\n` +
    `Date Submitted : ${new Date(req.date).toLocaleString('en-US')}\n` +
    `Submitted By   : ${req.rep}\n` +
    `Customer       : ${req.customer}\n` +
    `Project        : ${req.project}\n` +
    `Segment        : ${req.segment}\n` +
    `Status         : ${req.status}\n` +
    `Project Amount : $${Number(req.amount || 0).toLocaleString()}\n` +
    `Needed By      : ${req.neededBy}\n` +
    `Ship To        : ${req.address}\n` +
    `Attention To   : ${req.attn}\n\n` +
    '--- VENDORS & ITEMS ---\n' + vendorLines +
    (req.notes ? `\n\nNotes: ${req.notes}` : '') +
    '\n\n============================================\n' +
    'This is an automated notification from the V&K Sample Request Portal.';

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipients.join(', '),
      subject,
      text,
      html: buildNotificationHtml(req),
      attachments: [{ filename: 'ngr-logo.png', path: LOGO_PATH, cid: 'ngrlogo' }],
    });
    return true;
  } catch (err) {
    console.error('Notification email failed to send:', err);
    return false;
  }
}

/* ---------------- Google Sheets mirror (optional, best-effort) ----------------
   Purely a copy for viewing in Sheets. If this fails or isn't configured,
   the request is still saved normally, nothing about the app's own
   behavior depends on it. */
async function mirrorToSheets(saved) {
  const { SHEETS_MIRROR_URL, SHEETS_MIRROR_TOKEN } = process.env;
  if (!SHEETS_MIRROR_URL || !SHEETS_MIRROR_TOKEN) return;
  try {
    const res = await fetch(SHEETS_MIRROR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: SHEETS_MIRROR_TOKEN, request: saved }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'unknown error');
  } catch (err) {
    console.error('Sheets mirror failed (request is still saved normally):', err);
  }
}

/* ---------------- app ---------------- */
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/requests', (req, res) => {
  res.json({ ok: true, requests: readRequests() });
});

app.post('/api/requests', async (req, res) => {
  const body = req.body || {};

  const requiredFields = ['rep', 'repEmail', 'customer', 'project', 'status', 'segment', 'address', 'attn', 'neededBy'];
  const missing = requiredFields.filter((f) => !body[f]);
  if (missing.length) {
    return res.status(400).json({ ok: false, error: 'Missing required field(s): ' + missing.join(', ') });
  }
  if (!Array.isArray(body.vendors) || !body.vendors.length || body.vendors.some((v) => !v.name || !Array.isArray(v.items) || !v.items.length)) {
    return res.status(400).json({ ok: false, error: 'Each vendor needs a name and at least one item number.' });
  }

  const existing = readRequests();
  const saved = {
    id: nextId(existing),
    date: new Date().toISOString(),
    rep: body.rep,
    repEmail: body.repEmail,
    customer: body.customer,
    project: body.project,
    amount: Number(body.amount) || 0,
    status: body.status,
    segment: body.segment,
    address: body.address,
    attn: body.attn,
    neededBy: body.neededBy,
    notes: body.notes || '',
    lead: !!body.lead,
    notifyMe: !!body.notifyMe,
    vendors: body.vendors.map((v) => ({
      name: v.name,
      desc: v.desc || '',
      email: v.email || '',
      items: Array.isArray(v.items) ? v.items : [],
      shipments: Array.isArray(v.shipments) && v.shipments.length ? v.shipments : [{ eta: '', tracking: '', cost: '', courierLink: '' }],
      status: v.status || '',
      notes: v.notes || '',
    })),
  };

  existing.push(saved);
  writeRequests(existing);

  // always notifies the coordinators, regardless of the "Also email me a
  // copy?" toggle, that toggle only controls whether the submitter's own
  // address is added to the list
  const notified = await sendNotification(saved);

  // fire-and-forget: don't make the submitter wait on Sheets, and don't
  // fail the save if Sheets is slow, misconfigured, or down
  mirrorToSheets(saved);

  res.json({ ok: true, request: saved, notified });
});

app.patch('/api/requests/:id', (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const existing = readRequests();
  const idx = existing.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ ok: false, error: 'No request found with id ' + id });
  }

  // only vendors (shipment/tracking info) is editable after submission today,
  // everything else about the request is fixed once it's saved
  if (Array.isArray(body.vendors)) {
    existing[idx].vendors = body.vendors.map((v) => ({
      name: v.name,
      desc: v.desc || '',
      email: v.email || '',
      items: Array.isArray(v.items) ? v.items : [],
      shipments: Array.isArray(v.shipments) && v.shipments.length ? v.shipments : [{ eta: '', tracking: '', cost: '', courierLink: '' }],
      status: v.status || '',
      notes: v.notes || '',
    }));
  }

  writeRequests(existing);
  mirrorToSheets(existing[idx]);
  res.json({ ok: true, request: existing[idx] });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`V&K Sample Request Portal listening on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
