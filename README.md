# V&K Sample Request Portal

A web app for submitting vendor sample requests, tracking them on an admin
dashboard, and generating vendor/notification emails. This version runs as a
small Node.js server (`server.js`) that serves the app and a JSON API, so
requests are saved on the server instead of only living in one browser tab.

## What's in this bundle

- `server.js`: the whole backend. Serves the app and two API routes,
  `POST /api/requests` (save a request) and `GET /api/requests` (list every
  saved request).
- `public/index.html`: the whole front end (form, dashboard, email
  templates), served as a static file by `server.js`.
- `package.json`: the two dependencies (`express`, `nodemailer`) and the
  `start` script Render runs.
- `.env.example`: every environment variable the server understands, with
  notes on what each one does. None are required to run the app.
- `.gitignore`: keeps `node_modules`, `.env`, and the saved-requests file out
  of git.
- `sheets-mirror/Code.gs`: optional Google Apps Script that mirrors every
  saved request into a Google Sheet for viewing/filtering. This one doesn't
  go in the GitHub repo, it gets pasted into the Apps Script editor of the
  Google Sheet itself (see section 4). Skip it entirely if you don't want a
  Sheets copy.

## 1. Put it on GitHub

1. Create a new repository on GitHub (Cassie's own account or the New
   Generation Reps org), for example `vk-sample-request-portal`.
2. Upload everything in this bundle to the root of that repository:
   `server.js`, `package.json`, `.gitignore`, `.env.example`, the `public/`
   folder, and this `README.md`. Drag and drop on the GitHub web UI works
   fine, or `git add` / `git commit` / `git push` if you're comfortable with
   git.
3. Do not upload a `.env` file if you make one for local testing, `.gitignore`
   already keeps it out, but double check before you push.

## 2. Deploy it on Render

1. In the Render dashboard, click **New > Web Service**.
2. Connect the GitHub repository you just created.
3. Set:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Under **Environment Variables**, you don't need to add anything to get
   the app running and saving requests. Add SMTP variables later (see
   section 3) once you want the confirmation email to send for real.
5. Click **Create Web Service**. Render builds it and gives you a URL like
   `https://vk-sample-request-portal.onrender.com`. That's the link you
   share with the team, it's the whole app, form, dashboard, and email
   templates, all on one page with tabs.

Once it's live, every submission is saved on the server itself (visible from
any browser, not just the one that submitted it) instead of just one
browser tab.

### A note on where requests are saved

By default, `server.js` saves requests to a file called `requests.json`
sitting next to it on Render's disk. That works, but on Render's free and
most standard paid web services, that disk is wiped on every redeploy or
restart, so the saved requests would disappear along with it.

To make the data genuinely durable, add a **Render Disk**:

1. On the Web Service's page, go to **Disks** and click **Add Disk**.
2. Give it a name, a mount path like `/var/data`, and a size (1 GB is
   plenty for this).
3. Add an environment variable `DATA_DIR` set to that same mount path
   (`/var/data`).
4. Redeploy. From then on, `requests.json` lives on the Disk, and survives
   restarts and redeploys.

This is the one setup step worth doing even on a paid plan, a paid web
service keeps your app running, but only a Disk keeps a specific file from
being wiped when the service restarts or redeploys.

## 3. Turn on the confirmation email (optional)

The "Email me a notification" toggle on the form sends the submitter (the
sales coordinator handling that request) a confirmation email when it's on.
This is separate from the vendor request email, which is never sent
automatically by the app or the server, it's always just drafted on the
Email Templates tab for the coordinator or rep to review and send
themselves.

To make the confirmation email send for real, add these Environment
Variables on the Web Service in Render (see `.env.example` for the full
list):

- `SMTP_HOST`
- `SMTP_PORT` (587 for most providers, 465 if your provider requires it)
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM` (the address the email appears to come from, can be the same
  as `SMTP_USER`)

Any SMTP provider works, Gmail with an app password, Outlook, SendGrid,
Mailgun, and so on. Without these set, the app still saves every request
normally, it just skips sending that one email and says so in the toast
message after you submit.

## 4. Mirror submissions into a Google Sheet (optional)

Render (with the Disk from section 1) is what actually runs the app and
saves every request, that doesn't change. This step just adds a copy of
each saved request into a Google Sheet, so you can browse, filter, and
pivot the data there too, without touching the app itself. If this isn't
set up, or ever goes down, nothing about the app breaks, submissions just
won't show up in the Sheet until it's fixed.

### a. Set up the script on the Sheet

1. Open the Google Sheet you want to mirror into.
2. Go to **Extensions > Apps Script**.
3. Delete whatever's in the default `Code.gs`, and paste in the contents of
   `sheets-mirror/Code.gs` from this bundle.
4. Click the gear icon (**Project Settings**), scroll to **Script
   Properties**, and add one:
   - Property: `SECRET_TOKEN`
   - Value: any random string you make up (mash the keyboard for 20-30
     characters). Save it, you'll need it again below.
5. **Deploy > New deployment** > gear icon > **Web app**.
   - **Execute as:** Me
   - **Who has access:** Anyone
   Click **Deploy**, authorize it when Google asks (it needs permission to
   edit this Sheet), then copy the **Web app URL** it gives you (looks like
   `https://script.google.com/macros/s/AKfycb.../exec`).

### b. Point Render at it

On the Web Service's page in Render, add two more Environment Variables:

- `SHEETS_MIRROR_URL` = the Web app URL from step 5 above
- `SHEETS_MIRROR_TOKEN` = the same random string you set as `SECRET_TOKEN`

Redeploy. From then on, every new sample request also lands as a row in
the Sheet a few seconds after it saves on the server. A "Requests" tab is
created automatically the first time a row comes in.

If `Code.gs` is ever edited later, a **new deployment version** is needed
for the change to go live: **Deploy > Manage deployments > pencil icon >
Version: New version > Deploy**. Editing the script alone doesn't update
the URL that's already saved in Render.

## What's not automatic, on purpose

- **Vendor request emails are never sent by the app.** Every submission
  auto-generates a professional, fully-populated draft on the Email
  Templates tab, addressed to the coordinator with the vendor's real email
  shown as "Forward to vendor at:". After submitting, you're taken straight
  to that tab. Click **Open in Email App** to open the draft in your own
  email client, review it, and send it (or forward it) to the vendor
  yourself.
- **The vendor catalog is baked into `public/index.html`.** To add or edit a
  vendor later, either ask for an updated file, or edit the
  `VENDOR_CATALOG` / `VENDOR_EMAILS` list near the top of the `<script>`
  section directly.
- **There's no login or access control.** Anyone with the Render link can
  submit a request and see the dashboard. If that becomes a concern, Render
  supports adding basic auth or an allowlist in front of a Web Service, ask
  if you'd like that set up.

## Local testing (optional)

If you want to try it on your own machine before pushing to GitHub:

```
npm install
npm start
```

Then open `http://localhost:3000` in a browser. Requests you submit locally
are saved to `requests.json` in this folder.
