(function () {
  if (window.__skillsfuture_hook_installed) return;
  window.__skillsfuture_hook_installed = true;

  const BUTTON_ID = "skillsfuture-analyze-btn";
  const MODAL_ID = "skillsfuture-results-modal";
  const DEFAULT_BACKEND_URL = "http://localhost:8000/analyze-job";
  const MIN_DESCRIPTION_LENGTH = 100;

  const JOB_DESCRIPTION_SELECTORS = [
    "section.description__text",
    ".show-more-less-html__markup",
    ".jobs-description__content",
    ".jobs-box__html-content",
    "#job-details",
    "[data-job-description]",
    "[data-testid='job-description']",
    "[data-cy='job-description']",
    "[data-test='job-description']",
    ".job-description",
    ".job-description__content",
    ".jobDescription",
    "#jobDescriptionText",
    "#job_description",
    ".jd-description",
    ".mcfe-job-description",
    ".job-post-description",
    "section[aria-label*='description' i]",
    "section[class*='description' i]",
    "div[class*='job-description' i]",
    "div[class*='description' i]"
  ];

  function createButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Analyze with SkillsFuture";
    button.setAttribute("aria-label", "Analyze this job with SkillsFuture");
    Object.assign(button.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483647",
      background: "#075985",
      color: "#ffffff",
      border: "0",
      borderRadius: "6px",
      boxShadow: "0 8px 22px rgba(15, 23, 42, 0.22)",
      cursor: "pointer",
      font: "600 13px/1.2 Arial, sans-serif",
      padding: "11px 14px"
    });

    button.addEventListener("click", onAnalyzeClicked);
    document.body.appendChild(button);
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements)).filter(Boolean);
  }

  function getText(element) {
    return (element && (element.innerText || element.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function findJobDescriptionText() {
    const candidates = [];

    for (const selector of JOB_DESCRIPTION_SELECTORS) {
      try {
        candidates.push(...document.querySelectorAll(selector));
      } catch (error) {
        console.debug("SkillsFuture ignored selector", selector, error);
      }
    }

    const best = uniqueElements(candidates)
      .map((element) => ({ element, text: getText(element) }))
      .filter((candidate) => candidate.text.length > MIN_DESCRIPTION_LENGTH)
      .sort((a, b) => b.text.length - a.text.length)[0];

    if (best) return best.text;

    const bodyText = getText(document.body);
    return bodyText.length > MIN_DESCRIPTION_LENGTH ? bodyText : "";
  }

  async function getStoredBackendUrl() {
    const pageBackendUrl = await readPageBackendUrl();
    if (pageBackendUrl) {
      return normalizeBackendUrl(pageBackendUrl);
    }

    if (window.__skillsfuture_backend_url) {
      return normalizeBackendUrl(window.__skillsfuture_backend_url);
    }

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const value = await chrome.storage.local.get("backendUrl");
        if (value.backendUrl) return normalizeBackendUrl(value.backendUrl);
      } catch (error) {
        console.debug("SkillsFuture could not read chrome.storage", error);
      }
    }

    try {
      const stored = window.localStorage.getItem("skillsfuture_backend_url");
      if (stored) return normalizeBackendUrl(stored);
    } catch (error) {
      console.debug("SkillsFuture could not read localStorage", error);
    }

    return DEFAULT_BACKEND_URL;
  }

  function readPageBackendUrl() {
    return new Promise((resolve) => {
      const eventName = `skillsfuture-backend-url-${Math.random().toString(36).slice(2)}`;
      const timeout = window.setTimeout(() => resolve(""), 250);

      window.addEventListener(eventName, (event) => {
        window.clearTimeout(timeout);
        resolve(event.detail || "");
      }, { once: true });

      const script = document.createElement("script");
      script.textContent = `
        window.dispatchEvent(new CustomEvent("${eventName}", {
          detail: window.__skillsfuture_backend_url || ""
        }));
      `;
      (document.documentElement || document.head || document.body).appendChild(script);
      script.remove();
    });
  }

  function normalizeBackendUrl(url) {
    const trimmed = String(url || "").trim().replace(/\/+$/, "");
    if (!trimmed) return DEFAULT_BACKEND_URL;
    return trimmed.endsWith("/analyze-job") ? trimmed : `${trimmed}/analyze-job`;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function postWithRetry(url, payload, retries = 1) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.detail || `${response.status} ${response.statusText}`);
        }
        return { data, status: response.status };
      } catch (error) {
        lastError = error;
        if (attempt < retries) await delay(500);
      }
    }

    throw lastError;
  }

  async function onAnalyzeClicked() {
    const button = document.getElementById(BUTTON_ID);
    const jobDescription = findJobDescriptionText();

    if (!jobDescription) {
      showModal({ error: "Could not locate a job description with enough text on this page." });
      return;
    }

    const payload = { job_description: jobDescription };
    const backendUrl = await getStoredBackendUrl();

    try {
      if (button) button.textContent = "Analyzing...";
      const result = await postWithRetry(backendUrl, payload, 1);
      const data = result.data;
      console.log("SkillsFuture analysis result:", data);
      window.__skillsfuture_last_request = payload;
      window.__skillsfuture_last_response = data;
      document.documentElement.setAttribute("data-skillsfuture-last-request", JSON.stringify(payload));
      document.documentElement.setAttribute("data-skillsfuture-last-response", JSON.stringify(data));
      document.documentElement.setAttribute("data-skillsfuture-last-status", String(result.status));
      showModal({ data });
    } catch (error) {
      console.error("Failed to call SkillsFuture backend", error);
      showModal({ error: `Failed to contact backend: ${error.message}` });
    } finally {
      if (button) button.textContent = "Analyze with SkillsFuture";
    }
  }

  function legacyShowModal({ data, error }) {
    document.getElementById(MODAL_ID)?.remove();

    const host = document.createElement("div");
    host.id = MODAL_ID;
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none"
    });

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          position: fixed;
          right: 20px;
          bottom: 72px;
          width: min(380px, calc(100vw - 40px));
          max-height: min(560px, calc(100vh - 112px));
          overflow: auto;
          pointer-events: auto;
          background: #ffffff;
          color: #111827;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.24);
          font: 13px/1.45 Arial, sans-serif;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          border-bottom: 1px solid #e5e7eb;
        }
        h2 {
          margin: 0;
          color: #0f172a;
          font-size: 15px;
          line-height: 1.2;
        }
        button {
          width: 28px;
          height: 28px;
          border: 0;
          border-radius: 4px;
          background: #f3f4f6;
          color: #111827;
          cursor: pointer;
          font-size: 18px;
          line-height: 28px;
        }
        .body { padding: 12px 14px 14px; }
        .error {
          margin: 0;
          color: #991b1b;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 6px;
          padding: 10px;
        }
        .skill {
          border-top: 1px solid #e5e7eb;
          padding: 11px 0;
        }
        .skill:first-child { border-top: 0; padding-top: 0; }
        .skill-title {
          margin: 0 0 7px;
          color: #0f172a;
          font-weight: 700;
        }
        ol {
          margin: 0;
          padding-left: 20px;
        }
        li { margin: 4px 0; }
        .score {
          color: #475569;
          font-size: 12px;
        }
      </style>
      <section class="panel" role="dialog" aria-modal="false" aria-label="SkillsFuture analysis results">
        <div class="header">
          <h2>SkillsFuture Analysis</h2>
          <button type="button" aria-label="Close">×</button>
        </div>
        <div class="body"></div>
      </section>
    `;

    const body = shadow.querySelector(".body");
    const closeButton = shadow.querySelector("button");
    closeButton.addEventListener("click", () => host.remove());

    if (error) {
      const paragraph = document.createElement("p");
      paragraph.className = "error";
      paragraph.textContent = error;
      body.appendChild(paragraph);
    } else {
      legacyRenderResults(body, data);
    }

    document.body.appendChild(host);
  }

  function legacyRenderResults(container, data) {
    const results = Array.isArray(data && data.results) ? data.results : [];
    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "error";
      empty.textContent = "The backend returned no skill matches.";
      container.appendChild(empty);
      return;
    }

    results.slice(0, 5).forEach((result) => {
      const section = document.createElement("section");
      section.className = "skill";

      const title = document.createElement("p");
      title.className = "skill-title";
      title.textContent = result.extracted_skill || "Extracted skill";
      section.appendChild(title);

      const list = document.createElement("ol");
      const matches = Array.isArray(result.top_matches) ? result.top_matches.slice(0, 3) : [];

      matches.forEach((match) => {
        const item = document.createElement("li");
        const score = typeof match.similarity_score === "number"
          ? ` (${Math.round(match.similarity_score * 100)}%)`
          : "";
        item.textContent = `${match.official_skill_title || "Skill match"}${score}`;
        if (match.is_emerging) {
          const badge = document.createElement("span");
          badge.className = "score";
          badge.textContent = " emerging";
          item.appendChild(badge);
        }
        list.appendChild(item);
      });

      section.appendChild(list);
      container.appendChild(section);
    });
  }

  function showModal({ data, error }) {
    document.getElementById(MODAL_ID)?.remove();

    const host = document.createElement("div");
    host.id = MODAL_ID;
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none"
    });

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel {
          position: fixed;
          top: 0;
          right: 0;
          width: min(460px, 100vw);
          height: 100vh;
          display: flex;
          flex-direction: column;
          pointer-events: auto;
          background: #f8fafc;
          color: #0f172a;
          border-left: 1px solid #e2e8f0;
          box-shadow: -18px 0 44px rgba(15, 23, 42, 0.18);
          font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          animation: skillsfuture-slide-in 180ms ease-out;
        }
        @keyframes skillsfuture-slide-in {
          from { transform: translateX(18px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 18px 20px;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
        }
        .heading-copy { min-width: 0; }
        h2 {
          margin: 0;
          color: #0f172a;
          font-size: 18px;
          line-height: 1.2;
          letter-spacing: 0;
        }
        .subtitle {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.35;
        }
        .close-button {
          flex: 0 0 auto;
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: 6px;
          background: #f1f5f9;
          color: #334155;
          cursor: pointer;
          font-size: 22px;
          line-height: 32px;
        }
        .close-button:hover {
          background: #e2e8f0;
          color: #0f172a;
        }
        .body {
          flex: 1 1 auto;
          overflow: auto;
          padding: 18px 20px 22px;
        }
        .error {
          margin: 0;
          color: #991b1b;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          padding: 12px;
        }
        .skill {
          margin: 0 0 14px;
          overflow: hidden;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
        }
        .mapping {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1.25fr);
          align-items: stretch;
          border-bottom: 1px solid #e2e8f0;
        }
        .source,
        .match {
          min-width: 0;
          padding: 14px;
        }
        .source { background: #f8fafc; }
        .match { background: #ffffff; }
        .label {
          margin: 0 0 5px;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .skill-title,
        .match-title {
          margin: 0;
          color: #0f172a;
          font-size: 15px;
          font-weight: 800;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }
        .arrow {
          display: flex;
          align-items: center;
          justify-content: center;
          color: #0284c7;
          background: linear-gradient(180deg, #e0f2fe, #f0f9ff);
          border-left: 1px solid #e2e8f0;
          border-right: 1px solid #e2e8f0;
          font-size: 20px;
          font-weight: 900;
        }
        .definition {
          margin: 0;
          padding: 13px 14px 15px;
          color: #334155;
          font-size: 13px;
          line-height: 1.45;
        }
        .definition strong { color: #0f172a; }
        .meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-top: 9px;
        }
        .score {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          background: #e0f2fe;
          color: #075985;
          font-size: 11px;
          font-weight: 800;
          line-height: 1;
          padding: 5px 8px;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid #facc15;
          border-radius: 999px;
          background: linear-gradient(135deg, #fef3c7, #fef9c3 48%, #fde68a);
          color: #854d0e;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
          padding: 5px 8px;
          box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.16), 0 6px 16px rgba(202, 138, 4, 0.18);
        }
        .badge::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #f59e0b;
          box-shadow: 0 0 10px #f59e0b;
        }
        .secondary-matches {
          margin: 0;
          padding: 0 14px 14px;
          color: #64748b;
          font-size: 12px;
        }
        .secondary-matches summary {
          cursor: pointer;
          font-weight: 700;
        }
        .secondary-matches ul {
          margin: 8px 0 0;
          padding-left: 18px;
        }
        .secondary-matches li { margin: 5px 0; }
        @media (max-width: 520px) {
          .panel { width: 100vw; }
          .mapping { grid-template-columns: 1fr; }
          .arrow {
            min-height: 34px;
            border: 0;
            border-top: 1px solid #e2e8f0;
            border-bottom: 1px solid #e2e8f0;
            transform: rotate(90deg);
          }
        }
      </style>
      <section class="panel" role="dialog" aria-modal="false" aria-label="SkillsFuture analysis results">
        <div class="header">
          <div class="heading-copy">
            <h2>SkillsFuture Analysis</h2>
            <p class="subtitle">Extracted job skills mapped to official SkillsFuture skills.</p>
          </div>
          <button class="close-button" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="body"></div>
      </section>
    `;

    const body = shadow.querySelector(".body");
    const closeButton = shadow.querySelector(".close-button");
    closeButton.addEventListener("click", () => host.remove());

    if (error) {
      const paragraph = document.createElement("p");
      paragraph.className = "error";
      paragraph.textContent = error;
      body.appendChild(paragraph);
    } else {
      renderResults(body, data);
    }

    document.body.appendChild(host);
  }

  function renderResults(container, data) {
    const results = Array.isArray(data && data.results) ? data.results : [];
    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "error";
      empty.textContent = "The backend returned no skill matches.";
      container.appendChild(empty);
      return;
    }

    results.slice(0, 5).forEach((result) => {
      const matches = Array.isArray(result.top_matches) ? result.top_matches : [];
      const topMatch = matches[0];
      if (!topMatch) return;

      const section = document.createElement("section");
      section.className = "skill";

      const mapping = document.createElement("div");
      mapping.className = "mapping";

      const source = document.createElement("div");
      source.className = "source";
      const sourceLabel = document.createElement("p");
      sourceLabel.className = "label";
      sourceLabel.textContent = "Extracted skill";
      const title = document.createElement("p");
      title.className = "skill-title";
      title.textContent = result.extracted_skill || "Extracted skill";
      source.append(sourceLabel, title);

      const arrow = document.createElement("div");
      arrow.className = "arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "->";

      const match = document.createElement("div");
      match.className = "match";
      const matchLabel = document.createElement("p");
      matchLabel.className = "label";
      matchLabel.textContent = "Official SkillsFuture match";
      const matchTitle = document.createElement("p");
      matchTitle.className = "match-title";
      matchTitle.textContent = topMatch.official_skill_title || "Skill match";

      const meta = document.createElement("div");
      meta.className = "meta";
      if (typeof topMatch.similarity_score === "number") {
        const score = document.createElement("span");
        score.className = "score";
        score.textContent = `${Math.round(topMatch.similarity_score * 100)}% match`;
        meta.appendChild(score);
      }
      if (topMatch.is_emerging) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Emerging Skill";
        meta.appendChild(badge);
      }
      match.append(matchLabel, matchTitle, meta);

      mapping.append(source, arrow, match);
      section.appendChild(mapping);

      const definition = document.createElement("p");
      definition.className = "definition";
      const strong = document.createElement("strong");
      strong.textContent = "Definition: ";
      definition.append(strong, topMatch.official_skill_description || "No official definition returned.");
      section.appendChild(definition);

      const secondaryMatches = matches.slice(1, 3);
      if (secondaryMatches.length) {
        const details = document.createElement("details");
        details.className = "secondary-matches";
        const summary = document.createElement("summary");
        summary.textContent = "Other possible matches";
        const list = document.createElement("ul");
        secondaryMatches.forEach((secondaryMatch) => {
          const item = document.createElement("li");
          const score = typeof secondaryMatch.similarity_score === "number"
            ? ` (${Math.round(secondaryMatch.similarity_score * 100)}%)`
            : "";
          item.textContent = `${secondaryMatch.official_skill_title || "Skill match"}${score}`;
          list.appendChild(item);
        });
        details.append(summary, list);
        section.appendChild(details);
      }

      container.appendChild(section);
    });
  }

  function onReady(callback) {
    if (document.body) {
      callback();
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        callback();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  onReady(createButton);
}());
