(function () {
  const endpoint = "/.netlify/functions/analytics";
  const sessionKey = "af_analytics_session";
  const pageStartedAt = Date.now();
  const sentScrollMarks = new Set();
  const openedProjects = new Set();
  let lastHeartbeatAt = pageStartedAt;

  function getSessionId() {
    try {
      const existing = window.sessionStorage.getItem(sessionKey);
      if (existing) return existing;

      const next =
        window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      window.sessionStorage.setItem(sessionKey, next);
      return next;
    } catch (error) {
      return "session-storage-unavailable";
    }
  }

  function getUtm() {
    const params = new URLSearchParams(window.location.search);
    return {
      source: params.get("utm_source") || "",
      medium: params.get("utm_medium") || "",
      campaign: params.get("utm_campaign") || "",
      content: params.get("utm_content") || "",
      term: params.get("utm_term") || "",
    };
  }

  function getPage() {
    return {
      path: window.location.pathname,
      title: document.title,
      referrer: document.referrer || "",
      utm: getUtm(),
      sessionId: getSessionId(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  }

  function send(eventType, details, useBeacon) {
    const payload = JSON.stringify({
      eventType,
      details: details || {},
      page: getPage(),
      occurredAt: new Date().toISOString(),
    });

    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
      return;
    }

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: useBeacon === true,
    }).catch(() => {});
  }

  function getScrollDepth() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const documentHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );

    if (documentHeight <= viewportHeight) return 100;
    return Math.min(100, Math.round(((scrollTop + viewportHeight) / documentHeight) * 100));
  }

  function trackScrollDepth() {
    const depth = getScrollDepth();
    [25, 50, 75, 90, 100].forEach((mark) => {
      if (depth >= mark && !sentScrollMarks.has(mark)) {
        sentScrollMarks.add(mark);
        send("scroll_depth", { depth: mark });
      }
    });
  }

  function trackTime(forceBeacon) {
    const now = Date.now();
    const secondsSinceLast = Math.round((now - lastHeartbeatAt) / 1000);
    const totalSeconds = Math.round((now - pageStartedAt) / 1000);

    if (secondsSinceLast < 30 && !forceBeacon) return;

    lastHeartbeatAt = now;
    send(
      "time_on_page",
      {
        secondsSinceLast,
        totalSeconds,
        scrollDepth: getScrollDepth(),
      },
      forceBeacon
    );
  }

  function trackClick(event) {
    const link = event.target.closest("a");
    if (!link) return;

    const label = link.textContent.trim().replace(/\s+/g, " ");
    const href = link.getAttribute("href") || "";
    const project = link.closest(".project");
    const projectTitle = project ? project.querySelector("h3")?.textContent.trim() : "";
    const isContact = link.classList.contains("contact-link");
    const isProject = link.classList.contains("project-link");

    if (isContact) {
      send("contact_click", {
        label,
        destination: label.toLowerCase(),
        href,
      });
      return;
    }

    if (isProject) {
      send("project_click", {
        label,
        projectTitle,
        href,
      });
    }
  }

  function observeProjectOpens() {
    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.55) return;

          const title = entry.target.querySelector("h3")?.textContent.trim();
          if (!title || openedProjects.has(title)) return;

          openedProjects.add(title);
          send("project_open", { projectTitle: title });
        });
      },
      { threshold: [0.55] }
    );

    document.querySelectorAll(".project").forEach((project) => observer.observe(project));
  }

  function boot() {
    send("page_view", { scrollDepth: getScrollDepth() });
    observeProjectOpens();
    trackScrollDepth();

    document.addEventListener("click", trackClick);
    document.addEventListener("scroll", trackScrollDepth, { passive: true });
    window.addEventListener("beforeunload", () => trackTime(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") trackTime(true);
    });

    window.setInterval(() => trackTime(false), 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
