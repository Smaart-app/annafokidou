const { randomUUID } = require("node:crypto");

const STORE_NAME = "quiet-portfolio-analytics";
const MAX_BODY_BYTES = 20 * 1024;
const SUMMARY_EVENT_LIMIT = 1200;
const BLOB_READ_CONCURRENCY = 20;
const EVENT_TYPES = new Set([
  "page_view",
  "contact_click",
  "project_click",
  "project_open",
  "scroll_depth",
  "time_on_page",
]);

exports.handler = async function handler(event, context) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return respond(204, "");
    }

    if (event.httpMethod === "POST") {
      return saveEvent(event, context);
    }

    if (event.httpMethod === "GET") {
      return getSummary(event);
    }

    return respond(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Analytics function failed", error);
    return respond(500, {
      error: "Analytics function failed. Check the Netlify function logs for details.",
    });
  }
};

async function saveEvent(event, context) {
  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(413, { error: "Invalid body" });
  }

  let input;
  try {
    input = JSON.parse(event.body);
  } catch (error) {
    return respond(400, { error: "Malformed JSON" });
  }

  if (!EVENT_TYPES.has(input.eventType)) {
    return respond(400, { error: "Unsupported event type" });
  }

  const now = new Date();
  const clean = sanitizeEvent(input, event, now, context);
  const store = createAnalyticsStore();
  if (store.error) return store.error;

  const day = now.toISOString().slice(0, 10);
  const key = `events/${day}/${clean.id}.json`;

  await store.value.setJSON(key, clean);

  return respond(202, { ok: true });
}

async function getSummary(event) {
  const token = process.env.ANALYTICS_DASHBOARD_TOKEN;
  const provided = (event.queryStringParameters && event.queryStringParameters.token) || "";

  if (!token || provided !== token) {
    return respond(401, { error: "Unauthorized" });
  }

  const days = clampNumber(event.queryStringParameters?.days, 1, 90, 30);
  const store = createAnalyticsStore();
  if (store.error) return store.error;

  const listedByDay = await Promise.all(
    datePrefixes(days).map((prefix) => store.value.list({ prefix }).catch(() => ({ blobs: [] })))
  );
  const keys = listedByDay
    .flatMap((listed) => listed.blobs || [])
    .map((blob) => blob.key)
    .filter(Boolean)
    .slice(0, SUMMARY_EVENT_LIMIT);
  const events = await readEventBlobs(store.value, keys);

  return respond(200, summarize(events, days));
}

async function readEventBlobs(store, keys) {
  const events = [];

  for (let index = 0; index < keys.length; index += BLOB_READ_CONCURRENCY) {
    const batch = keys.slice(index, index + BLOB_READ_CONCURRENCY);
    const items = await Promise.all(batch.map((key) => store.get(key, { type: "json" }).catch(() => null)));
    items.forEach((item) => {
      if (item && item.eventType) events.push(item);
    });
  }

  return events;
}

function createAnalyticsStore() {
  try {
    return { value: getAnalyticsStore() };
  } catch (error) {
    const isBlobsSetupError =
      error?.name === "MissingBlobsEnvironmentError" ||
      /Netlify Blobs/i.test(error?.message || "");

    if (!isBlobsSetupError) throw error;

    return {
      error: respond(503, {
        error: "Netlify Blobs is not configured. Set NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN, or run through a linked Netlify dev environment.",
      }),
    };
  }
}

function getAnalyticsStore() {
  const { getStore } = require("@netlify/blobs");
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID || "";
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || "";

  if (siteID && token) {
    return getStore({
      name: STORE_NAME,
      siteID,
      token,
    });
  }

  return getStore(STORE_NAME);
}

function sanitizeEvent(input, requestEvent, now, context) {
  const page = input.page || {};
  const details = input.details || {};
  const geo = getGeo(requestEvent, context);

  return {
    id: randomUUID(),
    eventType: input.eventType,
    occurredAt: validDate(input.occurredAt) || now.toISOString(),
    path: cleanString(page.path, 240),
    title: cleanString(page.title, 180),
    referrer: cleanReferrer(page.referrer),
    utm: {
      source: cleanString(page.utm?.source, 80),
      medium: cleanString(page.utm?.medium, 80),
      campaign: cleanString(page.utm?.campaign, 120),
      content: cleanString(page.utm?.content, 120),
      term: cleanString(page.utm?.term, 120),
    },
    sessionId: cleanString(page.sessionId, 80),
    viewport: {
      width: clampNumber(page.viewport?.width, 0, 10000, 0),
      height: clampNumber(page.viewport?.height, 0, 10000, 0),
    },
    details: {
      label: cleanString(details.label, 100),
      destination: cleanString(details.destination, 80),
      href: cleanString(details.href, 320),
      projectTitle: cleanString(details.projectTitle, 140),
      depth: clampNumber(details.depth, 0, 100, 0),
      secondsSinceLast: clampNumber(details.secondsSinceLast, 0, 3600, 0),
      totalSeconds: clampNumber(details.totalSeconds, 0, 86400, 0),
      scrollDepth: clampNumber(details.scrollDepth, 0, 100, 0),
    },
    geo,
    country: geo.countryCode,
    region: geo.region,
  };
}

function summarize(events, days) {
  const cleanEvents = events.filter((item) => item && typeof item === "object");
  const pageViews = cleanEvents.filter((item) => item.eventType === "page_view");
  const sessions = new Set(cleanEvents.map((item) => cleanString(item.sessionId, 80)).filter(Boolean));
  const contactClicks = cleanEvents.filter((item) => item.eventType === "contact_click");
  const projectClicks = cleanEvents.filter((item) => item.eventType === "project_click");
  const projectOpens = cleanEvents.filter((item) => item.eventType === "project_open");
  const scrollEvents = cleanEvents.filter((item) => item.eventType === "scroll_depth");
  const timeEvents = cleanEvents.filter((item) => item.eventType === "time_on_page");

  return {
    generatedAt: new Date().toISOString(),
    rangeDays: days,
    totals: {
      events: cleanEvents.length,
      pageViews: pageViews.length,
      sessions: sessions.size,
      contactClicks: contactClicks.length,
      projectClicks: projectClicks.length,
      projectOpens: projectOpens.length,
      averageScrollDepth: average(scrollEvents.map((item) => eventDetails(item).depth)),
      averageTimeOnPageSeconds: averageLatestBySession(timeEvents),
    },
    referrers: topCounts(pageViews.map((item) => item.referrer || "Direct")),
    utmSources: topCounts(pageViews.map((item) => item.utm?.source || "None")),
    countries: topCounts(pageViews.map((item) => getEventCountry(item))),
    regions: topCounts(pageViews.map((item) => getEventRegion(item))),
    contactClicks: topCounts(contactClicks.map((item) => eventDetails(item).destination || eventDetails(item).label)),
    projectClicks: topCounts(projectClicks.map((item) => eventDetails(item).projectTitle || "Unknown project")),
    projectOpens: topCounts(projectOpens.map((item) => eventDetails(item).projectTitle || "Unknown project")),
    daily: dailyCounts(cleanEvents),
    recent: cleanEvents
      .slice()
      .sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0))
      .slice(0, 50),
  };
}

function getEventCountry(item) {
  return cleanString(item?.geo?.country || item?.geo?.countryCode || item?.country, 80) || "Unknown";
}

function getEventRegion(item) {
  const country = cleanString(item?.geo?.country || item?.geo?.countryCode || item?.country, 80);
  const region = cleanString(item?.geo?.region || item?.region, 80);

  if (country && region) return `${country} / ${region}`;
  return region;
}

function eventDetails(item) {
  return item && item.details && typeof item.details === "object" ? item.details : {};
}

function getGeo(event, context) {
  const headers = event.headers || {};
  const netlifyGeo = parseGeoHeader(getHeader(headers, "x-nf-geo"));
  const contextGeo = context?.geo || event.geo || {};
  const contextCountry = contextGeo.country || {};
  const contextRegion = contextGeo.subdivision || contextGeo.region || {};

  const countryCode = cleanString(
    netlifyGeo.countryCode ||
      contextCountry.code ||
      contextGeo.countryCode ||
      getHeader(headers, "x-country") ||
      getHeader(headers, "x-nf-country") ||
      getHeader(headers, "x-vercel-ip-country") ||
      getHeader(headers, "cf-ipcountry") ||
      getHeader(headers, "cloudfront-viewer-country") ||
      getHeader(headers, "x-appengine-country"),
    12
  );

  const country = cleanString(
    netlifyGeo.country ||
      contextCountry.name ||
      contextGeo.countryName ||
      countryCode,
    80
  );

  const region = cleanString(
    netlifyGeo.region ||
      contextRegion.name ||
      contextRegion.code ||
      contextGeo.regionName ||
      contextGeo.regionCode ||
      getHeader(headers, "x-region") ||
      getHeader(headers, "x-nf-region") ||
      getHeader(headers, "x-vercel-ip-country-region") ||
      getHeader(headers, "x-appengine-region"),
    80
  );

  return {
    countryCode,
    country,
    region,
  };
}

function parseGeoHeader(value) {
  if (!value) return {};

  try {
    const geo = JSON.parse(value);
    const country = geo.country || {};
    const subdivision = geo.subdivision || geo.region || {};

    return {
      countryCode: country.code || geo.countryCode || geo.country_code || "",
      country: country.name || geo.countryName || geo.country || "",
      region: subdivision.name || subdivision.code || geo.regionName || geo.region || "",
    };
  } catch (error) {
    return {};
  }
}

function getHeader(headers, name) {
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function averageLatestBySession(events) {
  const latest = new Map();

  events.forEach((item) => {
    const key = item.sessionId || item.id;
    const current = latest.get(key);
    const totalSeconds = eventDetails(item).totalSeconds || 0;
    if (!current || totalSeconds > current) {
      latest.set(key, totalSeconds);
    }
  });

  return average([...latest.values()]);
}

function dailyCounts(events) {
  const counts = {};
  events.forEach((item) => {
    const day = cleanString(item.occurredAt, 40).slice(0, 10);
    if (!day) return;

    counts[day] = counts[day] || { date: day, pageViews: 0, events: 0 };
    counts[day].events += 1;
    if (item.eventType === "page_view") counts[day].pageViews += 1;
  });
  return Object.values(counts).sort((a, b) => a.date.localeCompare(b.date));
}

function topCounts(values) {
  const counts = new Map();
  values
    .map((value) => cleanString(String(value || ""), 160))
    .filter(Boolean)
    .forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!filtered.length) return 0;
  return Math.round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length);
}

function datePrefixes(days) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - index);
    return `events/${date.toISOString().slice(0, 10)}/`;
  });
}

function cleanReferrer(value) {
  const clean = cleanString(value, 320);
  if (!clean) return "";

  try {
    const url = new URL(clean);
    return url.hostname.replace(/^www\./, "");
  } catch (error) {
    return clean;
  }
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maxLength);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function validDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Content-Type": typeof body === "string" ? "text/plain" : "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}
