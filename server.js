/**
 * V&K Sample Request Portal: Node/Express backend for Render.
 *
 * WHAT THIS DOES
 * Serves the app (public/index.html) and a small JSON API:
 *   POST /api/requests   save a new sample request, assign it an id + date,
 *                        optionally email a confirmation to the submitter.
 *   GET  /api/requests   return every saved request, newest last.
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

/* ---------------- mail (optional, only used for the "email me a
   confirmation" toggle, never for vendor request emails) ---------------- */
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

async function sendConfirmation(req) {
  const transport = getTransport();
  if (!transport || !req.repEmail) return false;
  const vendorNames = (req.vendors || []).map((v) => v.name).filter(Boolean).join(', ');
  const subject = `New Sample Request Submitted: ${req.customer} (${req.id})`;
  const text =
    'A new sample request just came in.\n\n' +
    `Request ID: ${req.id}\n` +
    `Customer: ${req.customer}\n` +
    `Project: ${req.project}\n` +
    `Segment: ${req.segment}\n` +
    `Vendors: ${vendorNames}\n` +
    `Amount: $${req.amount}\n` +
    `Needed By: ${req.neededBy}\n`;
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: req.repEmail,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error('Confirmation email failed to send:', err);
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
    })),
  };

  existing.push(saved);
  writeRequests(existing);

  let notified = false;
  if (saved.notifyMe) {
    notified = await sendConfirmation(saved);
  }

  // fire-and-forget: don't make the submitter wait on Sheets, and don't
  // fail the save if Sheets is slow, misconfigured, or down
  mirrorToSheets(saved);

  res.json({ ok: true, request: saved, notified });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`V&K Sample Request Portal listening on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
