# Quiet Portfolio Analytics MVP

## What is tracked

- Page views
- Referrer domain and UTM fields
- Country and region when available from Netlify geo data
- Email, LinkedIn and CV clicks
- Project link clicks
- Scroll depth at 25%, 50%, 75%, 90% and 100%
- Approximate time on page via heartbeat and page-hide events

The browser script does not use cookies. It creates an anonymous per-tab session id in `sessionStorage` and does not intentionally collect names, emails or IP addresses. Country and region are collected only when Netlify makes geo data available to the function.

## Files

- `analytics-client.js` sends quiet browser events.
- `netlify/functions/analytics.js` receives events and returns private summaries.
- `dashboard/analytics.html` shows the private dashboard.
- `netlify.toml` tells Netlify where the static site and functions live.

## Netlify setup

1. Deploy this folder to Netlify.
2. Add an environment variable:

   ```text
   ANALYTICS_DASHBOARD_TOKEN=choose-a-long-private-token
   ```

3. If Netlify shows a `MissingBlobsEnvironmentError`, add these environment variables too:

   ```text
   NETLIFY_SITE_ID=your-site-id
   NETLIFY_BLOBS_TOKEN=your-netlify-personal-access-token
   ```

   You can find the site id in Netlify under `Project configuration -> Project details -> Site ID`.
   Create the token under `User settings -> Applications -> Personal access tokens`.

4. Open the dashboard after deploy:

   ```text
   https://your-site.netlify.app/dashboard/analytics.html
   ```

5. Enter the same token in the dashboard. The token is saved only in your browser local storage.

## Local development

Install dependencies once:

```bash
npm install
```

Run locally with Netlify Functions:

```bash
npm run dev
```

Then open:

```text
http://localhost:8888/
http://localhost:8888/dashboard/analytics.html
```

For local dashboard testing, set `ANALYTICS_DASHBOARD_TOKEN` before running `npm run dev`.
