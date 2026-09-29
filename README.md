# Resource Allocation Tracker

A live, editable resource-planning app: task register, onsite roster,
headcount/capacity and analytics. All data is saved in your browser
(localStorage) and survives refreshes.

## Run it locally

Requires Node.js 18+ (https://nodejs.org).

```bash
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

## Build a static version to host

```bash
npm run build
```

The output lands in `dist/` — a plain static site. Drop that folder on
any static host (Netlify, Vercel, GitHub Pages, an S3 bucket, or an
internal web server / IIS site).

## Where your data lives

Edits are stored in your browser under the key
`securiton-resource-tracker-v1` (localStorage). It's per-browser and
per-device — it does not sync between machines or users. To reset,
clear that key (or your site data) in the browser.

### Want it shared across the team?

localStorage is single-user. If you need multiple people editing the
same data, it needs a small backend (e.g. a database + API, or a shared
file store). That's a straightforward next step — ask and it can be
wired up.
