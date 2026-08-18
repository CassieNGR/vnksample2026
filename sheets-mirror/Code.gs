/**
 * V&K Sample Request Portal: Google Sheets mirror.
 *
 * Not the app's backend, Render/server.js is still what runs the app,
 * saves every request, and sends the coordinator notification email. This
 * script just receives a copy of each saved request and writes it into
 * this spreadsheet (a "Requests" tab and a "Vendor Items" tab), so it can
 * be viewed/filtered/pivoted in Sheets too.
 *
 * Setup steps and the Render env vars this needs are in README.md, section
 * 4, of the bundle this came with. Short version: paste this in, set a
 * SECRET_TOKEN script property, deploy as a Web app, then put that URL and
 * token into Render as SHEETS_MIRROR_URL / SHEETS_MIRROR_TOKEN.
 */

const REQUESTS_SHEET_NAME = 'Requests';
const REQUESTS_HEADERS = [
  'ID', 'Date', 'Rep', 'RepEmail', 'Customer', 'Project', 'Amount', 'Status',
  'Segment', 'Address', 'Attn', 'NeededBy', 'Notes', 'Lead', 'NotifyMe',
  'Vendors', 'VendorsJSON',
];

const ITEMS_SHEET_NAME = 'Vendor Items';
const ITEMS_HEADERS = [
  'RequestID', 'Date', 'Customer', 'Project', 'Rep', 'VendorName',
  'VendorEmail', 'VendorDescription', 'Items', 'TrackingNumbers', 'ETAs',
  'ShipmentCosts', 'CourierLinks',
];

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('') !== headers.join('')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function checkToken_(body) {
  const expected = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
  return expected && body.token === expected;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function vendorsSummary_(vendors) {
  return (vendors || [])
    .map(v => `${v.name || '(unnamed vendor)'}${v.items && v.items.length ? ' (' + v.items.join(', ') + ')' : ''}`)
    .join('; ');
}

function writeRequestRow_(req) {
  const sheet = getOrCreateSheet_(REQUESTS_SHEET_NAME, REQUESTS_HEADERS);
  const lastRow = sheet.getLastRow();
  // getRange throws if asked for 0 rows, which happens on a brand-new sheet
  // that only has the header row so far, guard against that first case
  const ids = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0])
    : [];
  const existingRow = ids.findIndex(id => id === req.id);

  const rowValues = [
    req.id, req.date, req.rep, req.repEmail, req.customer, req.project,
    req.amount, req.status, req.segment, req.address, req.attn,
    req.neededBy, req.notes, req.lead ? 'Yes' : 'No', req.notifyMe ? 'Yes' : 'No',
    vendorsSummary_(req.vendors), JSON.stringify(req.vendors || []),
  ];

  if (existingRow >= 0) {
    sheet.getRange(existingRow + 2, 1, 1, REQUESTS_HEADERS.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
}

function writeVendorItemRows_(req) {
  const sheet = getOrCreateSheet_(ITEMS_SHEET_NAME, ITEMS_HEADERS);

  // this request's vendors array is always the full current state (not a
  // diff), so clear out any rows already on file for this request and
  // rewrite them fresh, that way edits/removed items never leave stale rows
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existingIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = existingIds.length - 1; i >= 0; i--) {
      if (existingIds[i][0] === req.id) {
        sheet.deleteRow(i + 2);
      }
    }
  }

  (req.vendors || []).forEach(v => {
    const shipments = v.shipments || [];
    sheet.appendRow([
      req.id, req.date, req.customer, req.project, req.rep,
      v.name || '', v.email || '', v.desc || '',
      (v.items || []).join(', '),
      shipments.map(s => s.tracking).filter(Boolean).join(', '),
      shipments.map(s => s.eta).filter(Boolean).join(', '),
      shipments.map(s => s.cost).filter(Boolean).join(', '),
      shipments.map(s => s.courierLink).filter(Boolean).join(', '),
    ]);
  });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Bad request body' });
  }

  if (!checkToken_(body)) {
    return jsonResponse_({ ok: false, error: 'Unauthorized' });
  }

  try {
    const req = body.request || {};
    if (!req.id) {
      return jsonResponse_({ ok: false, error: 'Missing request.id' });
    }
    writeRequestRow_(req);
    writeVendorItemRows_(req);
    return jsonResponse_({ ok: true, id: req.id });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  return jsonResponse_({ ok: true, message: 'V&K Sample Request Sheets mirror is running. POST a request to it to use it.' });
}
