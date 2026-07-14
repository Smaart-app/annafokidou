# Anna Fokidou Portfolio

Static portfolio site with a quiet, private analytics MVP.

## What is included

- `index.html` is the portfolio page.
- `analytics-client.js` tracks lightweight portfolio events.
- `netlify/functions/analytics.js` receives analytics events and returns dashboard summaries.
- `dashboard/analytics.html` is the private analytics dashboard.
- `netlify.toml` configures Netlify static publishing and serverless functions.

## Analytics MVP

The analytics setup tracks:

- Page views
- Referrer domain and UTM fields
- Country and region when Netlify provides geo data
- Email, LinkedIn and CV clicks
- Project clicks
- Scroll depth
- Approximate time on page

It does not use cookies. The browser creates an anonymous per-tab session id in `sessionStorage`.

## Deploy Flow

1. Push or upload this folder to the deployed portfolio project.
2. Make sure Netlify uses this folder as the site root.
3. In Netlify, add this environment variable:

   ```text
   ANALYTICS_DASHBOARD_TOKEN=choose-a-long-private-token
   ```

4. If the analytics function reports `MissingBlobsEnvironmentError`, add:

   ```text
   NETLIFY_SITE_ID=your-site-id
   NETLIFY_BLOBS_TOKEN=your-netlify-personal-access-token
   ```

5. Deploy the site.
6. Visit the portfolio once to confirm it loads.
7. Open the dashboard:

   ```text
   https://your-domain.com/dashboard/analytics.html
   ```

8. Enter the same dashboard token.

## Local Development

Install dependencies:

```bash
npm install
```

Run with Netlify Functions:

```bash
npm run dev
```

Then open:

```text
http://localhost:8888/
http://localhost:8888/dashboard/analytics.html
```

For local dashboard testing, set `ANALYTICS_DASHBOARD_TOKEN` before running the dev server.

## Privacy Note

This is a simple portfolio analytics tool, not a full analytics platform. It is designed to collect only basic interaction signals and avoid intentionally collecting personal information. Country and region are stored only when Netlify provides them to the serverless function.

Anyone with both the dashboard URL and the private token can view the dashboard, so keep the token private.

## More Details

See `ANALYTICS_SETUP.md` for the analytics-specific notes.
