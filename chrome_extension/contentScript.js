(function () {
  if (window.__skillsfuture_hook_installed) return;
  window.__skillsfuture_hook_installed = true;

  const BUTTON_ID = "skillsfuture-analyze-btn";
  const MODAL_ID = "skillsfuture-results-modal";
  const DEFAULT_BACKEND_URL = "http://localhost:8000/analyze-job";
  const MIN_DESCRIPTION_LENGTH = 100;
<<<<<<< Updated upstream
  const MAX_JOB_DESCRIPTION_LENGTH = 12000;
=======
  let watchedUrl = window.location.href;

  const TARGET_JOB_HEADINGS = [
    "key responsibilities",
    "responsibilities",
    "requirements",
    "requirements & qualifications",
    "requirements and qualifications",
    "qualifications",
    "job description",
    "what you will be working on",
    "what we are looking for",
    "job requirements",
    "about the role",
    "skills required",
    "skills required by the employer"
  ];

  const BLACKLIST_SECTION_PHRASES = [
    "tell employers what skills you have",
    "the more skills you have, the better your job match",
    "your job match",
    "add skills",
    "skills you have"
  ];

  const NAVIGATION_FOOTER_PHRASES = [
    "switch to employer",
    "search jobs",
    "gain insights",
    "browse jobs",
    "government agency website",
    "how to identify",
    "terms of use",
    "privacy statement",
    "contact us",
    "report vulnerability",
    "copyright"
  ];
>>>>>>> Stashed changes

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
    "[data-automation='jobDescription']",
    "[data-testid='jobDescription']",
    "[data-testid='job-description-container']",
    ".jobAdDetails",
    ".job-ad-details",
    ".sx2jih0",
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

  function setAnalyzeButtonVisible(isVisible) {
    const button = document.getElementById(BUTTON_ID);
    if (button) button.style.display = isVisible ? "" : "none";
  }

  function watchPageChanges() {
    window.setInterval(() => {
      if (window.location.href === watchedUrl) return;

      watchedUrl = window.location.href;
      document.getElementById(MODAL_ID)?.remove();
      createButton();
      setAnalyzeButtonVisible(true);
    }, 750);
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements)).filter(Boolean);
  }

  function getText(element) {
    return (element && (element.innerText || element.textContent) || "").replace(/\s+/g, " ").trim();
  }

<<<<<<< Updated upstream
  function debugLog(message, details) {
    if (!isDebugMode()) return;
    console.debug(`[SkillsFuture] ${message}`, details || "");
  }

  function isDebugMode() {
    return Boolean(
      window.__skillsfuture_debug ||
      window.location.protocol === "file:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );
  }

  function getSelectedText() {
    const selectedText = String(window.getSelection && window.getSelection() || "").replace(/\s+/g, " ").trim();
    if (selectedText.length >= MIN_DESCRIPTION_LENGTH) {
      return selectedText;
    }
    return "";
  }

  function capJobDescription(text) {
    return text.length > MAX_JOB_DESCRIPTION_LENGTH ? text.slice(0, MAX_JOB_DESCRIPTION_LENGTH) : text;
  }

  function getConfidenceLabel(score) {
    if (typeof score !== "number") return "Unscored match";
    if (score >= 0.6) return "High confidence";
    if (score >= 0.4) return "Medium confidence";
    return "Low confidence";
  }

  async function expandCollapsedDescriptions() {
    const buttonPatterns = [
      /show more/i,
      /see more/i,
      /read more/i,
      /view more/i,
      /more/i
    ];
    const buttons = Array.from(document.querySelectorAll("button, a"))
      .filter((element) => {
        const text = getText(element);
        return text && buttonPatterns.some((pattern) => pattern.test(text));
      })
      .slice(0, 3);

    for (const button of buttons) {
      try {
        button.click();
        debugLog("Clicked expandable description control", getText(button));
        await delay(250);
      } catch (error) {
        debugLog("Could not click expandable description control", error);
      }
    }
  }

  function findJobDescriptionText() {
    const selectedText = getSelectedText();
    if (selectedText) {
      debugLog("Using selected text", { chars: selectedText.length });
      return {
        text: capJobDescription(selectedText),
        source: "selection",
        originalLength: selectedText.length
      };
=======
  function getStructuredText(element) {
    return (element && (element.innerText || element.textContent) || "").replace(/\r/g, "").trim();
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeHeading(text) {
    return normalizeText(text).toLowerCase().replace(/[:-]+$/g, "").trim();
  }

  function includesBlacklistedText(text) {
    const normalized = normalizeText(text).toLowerCase();
    return BLACKLIST_SECTION_PHRASES.some((phrase) => normalized.includes(phrase));
  }

  function isNavigationOrFooterText(text) {
    const normalized = normalizeText(text).toLowerCase();
    return NAVIGATION_FOOTER_PHRASES.some((phrase) => normalized.includes(phrase));
  }

  function isMyCareersFutureJobPage() {
    const host = window.location.hostname.toLowerCase();
    return host.includes("mycareersfuture.gov.sg") && /\/job\//i.test(window.location.pathname);
  }

  function isVisibleElement(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function isTargetHeadingText(text) {
    const heading = normalizeHeading(text);
    if (!heading || heading.length > 90) return false;
    return TARGET_JOB_HEADINGS.some((target) => heading === target || heading.startsWith(`${target} `));
  }

  function isMajorHeadingElement(element) {
    if (!element || !(element instanceof Element)) return false;
    if (/^H[1-6]$/i.test(element.tagName)) return true;
    if (element.getAttribute("role") === "heading") return true;

    const text = getText(element);
    if (isTargetHeadingText(text)) return true;

    const childText = Array.from(element.children || []).map((child) => getText(child)).join(" ");
    return text.length > 0 && text.length <= 90 && text !== childText && /^[A-Z0-9][A-Za-z0-9 &/(),-]+$/.test(text);
  }

  function findHeadingElements(root) {
    const headings = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!isVisibleElement(node)) return NodeFilter.FILTER_SKIP;
        const text = getText(node);
        if (isTargetHeadingText(text)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });

    while (walker.nextNode()) {
      const element = walker.currentNode;
      if (!headings.some((heading) => heading.contains(element))) {
        headings.push(element);
      }
    }

    return headings;
  }

  function cleanExtractedText(text) {
    const seen = new Set();
    return String(text || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((line) => !includesBlacklistedText(line))
      .filter((line) => !isNavigationOrFooterText(line))
      .filter((line) => {
        const key = line.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join("\n");
  }

  function collectSectionAfterHeading(heading) {
    const lines = [];
    let ignoredReason = "";
    let current = heading.nextElementSibling;

    while (current) {
      const text = getStructuredText(current);
      if (current !== heading && isMajorHeadingElement(current) && text.length <= 120) break;
      if (includesBlacklistedText(text)) {
        ignoredReason = `blacklisted section text: ${normalizeText(text).slice(0, 80)}`;
        break;
      }
      if (text && !isNavigationOrFooterText(text)) lines.push(text);
      current = current.nextElementSibling;
    }

    if (!lines.length) {
      const parentText = getStructuredText(heading.parentElement);
      const headingText = getStructuredText(heading);
      const textWithoutHeading = parentText.replace(headingText, "").trim();
      if (textWithoutHeading && !includesBlacklistedText(textWithoutHeading) && !isNavigationOrFooterText(textWithoutHeading)) {
        lines.push(textWithoutHeading);
      }
    }

    if (!lines.length) {
      let parentSibling = heading.parentElement && heading.parentElement.nextElementSibling;
      while (parentSibling) {
        const text = getStructuredText(parentSibling);
        if (isMajorHeadingElement(parentSibling) && text.length <= 120) break;
        if (includesBlacklistedText(text)) {
          ignoredReason = `blacklisted sibling section: ${normalizeText(text).slice(0, 80)}`;
          break;
        }
        if (text && !isNavigationOrFooterText(text)) lines.push(text);
        parentSibling = parentSibling.nextElementSibling;
      }
    }

    const text = cleanExtractedText(lines.join("\n"));
    return { text, ignoredReason };
  }

  function extractPageTitle() {
    const titleCandidates = [
      "h1",
      "[data-testid*='job-title' i]",
      "[class*='job-title' i]",
      "[class*='title' i]"
    ];

    for (const selector of titleCandidates) {
      const text = getText(document.querySelector(selector));
      if (text && text.length <= 120 && !isNavigationOrFooterText(text)) return text;
    }

    return normalizeText(document.title.split("|")[0] || document.title);
  }

  function extractCompanyName() {
    const companyCandidates = [
      "[data-testid*='company' i]",
      "[class*='company' i]",
      "a[href*='/companies/']",
      "a[href*='/company/']"
    ];

    for (const selector of companyCandidates) {
      const text = getText(document.querySelector(selector));
      if (text && text.length <= 140 && !isNavigationOrFooterText(text)) return text;
    }

    return "";
  }

  function extractPatternMatches(text, patterns) {
    const matches = [];
    patterns.forEach((pattern) => {
      const found = text.match(pattern);
      if (found) matches.push(normalizeText(found[0]));
    });
    return Array.from(new Set(matches));
  }

  function validateExtractedJobData(jobData) {
    const requiredText = normalizeText(Object.values(jobData.sections || {}).join(" "));
    const blacklistHits = BLACKLIST_SECTION_PHRASES.filter((phrase) => requiredText.toLowerCase().includes(phrase));
    const hasTargetSection = Object.keys(jobData.sections || {}).some((heading) => (
      /responsibilities|requirements|qualifications|description|working on|looking for|about the role/i.test(heading)
    ));

    if (!requiredText || requiredText.length < MIN_DESCRIPTION_LENGTH) {
      return "Could not find enough employer-provided job requirement text on this MyCareersFuture page.";
    }

    if (blacklistHits.length && requiredText.length < blacklistHits.join(" ").length * 4) {
      return "Extraction mostly matched MyCareersFuture profile/skill suggestion text, so it was rejected.";
    }

    if (!hasTargetSection) {
      return "Could not find responsibilities, requirements, qualifications, or job description sections. Analysis stopped to avoid using the wrong page text.";
    }

    return "";
  }

  function buildJobDescriptionFromData(jobData) {
    const parts = [];
    if (jobData.title) parts.push(`Job title: ${jobData.title}`);
    if (jobData.company) parts.push(`Company: ${jobData.company}`);

    Object.entries(jobData.sections || {}).forEach(([heading, text]) => {
      if (text) parts.push(`${heading}\n${text}`);
    });

    if (jobData.requiredSkills.length) parts.push(`Required skills/tools\n${jobData.requiredSkills.join("\n")}`);
    if (jobData.yearsOfExperience.length) parts.push(`Years of experience\n${jobData.yearsOfExperience.join("\n")}`);
    if (jobData.educationRequirements.length) parts.push(`Education requirements\n${jobData.educationRequirements.join("\n")}`);

    return parts.join("\n\n");
  }

  function extractMyCareersFutureJobData() {
    const root = document.querySelector("main") || document.querySelector("[role='main']") || document.body;
    const headings = findHeadingElements(root);
    const sections = {};
    const ignoredSections = [];

    headings.forEach((heading) => {
      const headingText = normalizeText(getText(heading)).replace(/[:-]+$/g, "");
      const { text, ignoredReason } = collectSectionAfterHeading(heading);

      if (ignoredReason) ignoredSections.push({ heading: headingText, reason: ignoredReason });
      if (!text || includesBlacklistedText(text)) {
        if (text) ignoredSections.push({ heading: headingText, reason: "blacklisted extracted text" });
        return;
      }

      sections[headingText] = text;
    });

    const combinedText = Object.values(sections).join("\n");
    const jobData = {
      source: "mycareersfuture-heading-extraction",
      url: window.location.href,
      title: extractPageTitle(),
      company: extractCompanyName(),
      headingsFound: headings.map((heading) => normalizeText(getText(heading))),
      ignoredSections,
      sections,
      requiredSkills: extractPatternMatches(combinedText, [
        /\b(?:Autodesk Revit|Revit|AutoCAD|CORENET X|Singapore Fire Code|Python|SQL|JavaScript|React|AWS|Azure|Docker|Kubernetes|Excel|Power BI|Tableau)\b/gi
      ]),
      yearsOfExperience: extractPatternMatches(combinedText, [
        /\b\d+\s*(?:to|-)\s*\d+\s+years?(?:\s+of)?(?:\s+[a-z-]+){0,8}\s+experience\b/gi,
        /\b(?:at least|minimum|min\.?)\s+\d+\s+years?(?:\s+of)?(?:\s+[a-z-]+){0,8}\s+experience\b/gi,
        /\b\d+\+?\s+years?(?:\s+of)?(?:\s+[a-z-]+){0,8}\s+experience\b/gi
      ]),
      educationRequirements: extractPatternMatches(combinedText, [
        /\b(?:degree|diploma|ite|nitec|higher nitec|bachelor'?s?|master'?s?|phd)\b(?:\s+[A-Za-z/&-]+){0,12}/gi
      ])
    };

    const validationError = validateExtractedJobData(jobData);
    const jobDescription = validationError ? "" : buildJobDescriptionFromData(jobData);

    console.debug("SkillsFuture extraction headings found", jobData.headingsFound);
    console.debug("SkillsFuture extraction ignored sections", jobData.ignoredSections);
    console.debug("SkillsFuture final extracted job data", jobData);

    window.__skillsfuture_last_extracted_job_data = jobData;
    document.documentElement.setAttribute("data-skillsfuture-last-extracted-job", JSON.stringify(jobData));

    return { jobDescription, jobData, validationError };
  }

  function findJobDescriptionText() {
    if (isMyCareersFutureJobPage()) {
      return extractMyCareersFutureJobData();
>>>>>>> Stashed changes
    }

    const candidates = [];

    for (const selector of JOB_DESCRIPTION_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach((element) => {
          candidates.push({ selector, element });
        });
      } catch (error) {
        debugLog(`Ignored selector ${selector}`, error);
      }
    }

    const seenElements = new Set();
    const best = candidates
      .filter((candidate) => {
        if (!candidate.element || seenElements.has(candidate.element)) return false;
        seenElements.add(candidate.element);
        return true;
      })
      .map((candidate) => ({
        selector: candidate.selector,
        text: getText(candidate.element)
      }))
      .filter((candidate) => candidate.text.length > MIN_DESCRIPTION_LENGTH)
      .sort((a, b) => b.text.length - a.text.length)[0];

<<<<<<< Updated upstream
    if (best) {
      debugLog("Using matched job-description selector", {
        selector: best.selector,
        chars: best.text.length
      });
      return {
        text: capJobDescription(best.text),
        source: best.selector,
        originalLength: best.text.length
      };
    }

    const bodyText = getText(document.body);
    if (bodyText.length > MIN_DESCRIPTION_LENGTH) {
      debugLog("Using body text fallback", { chars: bodyText.length });
      return {
        text: capJobDescription(bodyText),
        source: "body",
        originalLength: bodyText.length
      };
    }

    debugLog("No usable job description found");
    return {
      text: "",
      source: "none",
      originalLength: 0
=======
    if (best) return { jobDescription: best.text, jobData: null, validationError: "" };

    const bodyText = getText(document.body);
    return {
      jobDescription: bodyText.length > MIN_DESCRIPTION_LENGTH ? bodyText : "",
      jobData: null,
      validationError: ""
>>>>>>> Stashed changes
    };
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
<<<<<<< Updated upstream
    await expandCollapsedDescriptions();
    const extraction = findJobDescriptionText();
    const jobDescription = extraction.text;

    if (!jobDescription) {
      showModal({
        error: "Could not locate a job description with enough text. Highlight the job description text on the page, then click Analyze again."
      });
=======
    const extraction = findJobDescriptionText();
    const jobDescription = extraction.jobDescription;

    if (extraction.validationError) {
      showModal({ error: extraction.validationError });
>>>>>>> Stashed changes
      return;
    }

    if (!jobDescription || includesBlacklistedText(jobDescription)) {
      showModal({ error: "Could not safely extract employer job requirements from this page. Analysis stopped to avoid using MyCareersFuture profile suggestion text." });
      return;
    }

    const payload = {
      job_description: jobDescription,
      job_data: extraction.jobData || undefined
    };
    const backendUrl = await getStoredBackendUrl();

    try {
      if (button) button.textContent = "Analyzing...";
      const result = await postWithRetry(backendUrl, payload, 1);
      const data = result.data;
      console.log("SkillsFuture analysis result:", data);
      debugLog("Extraction diagnostics", {
        source: extraction.source,
        originalLength: extraction.originalLength,
        sentLength: jobDescription.length
      });
      window.__skillsfuture_last_request = payload;
      window.__skillsfuture_last_response = data;
      if (isDebugMode()) {
        document.documentElement.setAttribute("data-skillsfuture-last-request", JSON.stringify(payload));
        document.documentElement.setAttribute("data-skillsfuture-last-response", JSON.stringify(data));
        document.documentElement.setAttribute("data-skillsfuture-last-status", String(result.status));
      }
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
        .minimize-button,
        .restore-button {
          flex: 0 0 auto;
          border: 0;
          border-radius: 6px;
          background: #f1f5f9;
          color: #334155;
          cursor: pointer;
        }
        .minimize-button {
          min-width: 54px;
          height: 34px;
          font: 700 12px/1 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          padding: 0 12px;
        }
        .restore-button {
          position: fixed;
          right: 20px;
          bottom: 72px;
          display: none;
          align-items: center;
          gap: 8px;
          pointer-events: auto;
          background: #075985;
          color: #ffffff;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.22);
          font: 700 13px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          padding: 11px 14px;
        }
        .restore-button::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #bae6fd;
          box-shadow: 0 0 0 3px rgba(186, 230, 253, 0.24);
        }
        .minimize-button:hover {
          background: #e2e8f0;
          color: #0f172a;
        }
        .restore-button:hover { background: #0369a1; }
        :host(.is-minimized) .panel { display: none; }
        :host(.is-minimized) .restore-button { display: inline-flex; }
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
        .summary-panel {
          margin: 0 0 14px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px 14px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
        }
        .summary-panel p {
          margin: 0;
          color: #475569;
          font-size: 13px;
        }
        .summary-panel strong { color: #0f172a; }
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
        .evidence {
          margin: 0;
          padding: 0 14px 13px;
          color: #475569;
          font-size: 12px;
          line-height: 1.45;
        }
        .evidence strong { color: #0f172a; }
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
          .restore-button {
            right: 14px;
            bottom: 72px;
            max-width: calc(100vw - 28px);
          }
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
          <button class="minimize-button" type="button" aria-label="Minimize SkillsFuture results" title="Minimize">Hide</button>
        </div>
        <div class="body"></div>
      </section>
      <button class="restore-button" type="button" aria-label="Show SkillsFuture results">Show analysis</button>
    `;

    const body = shadow.querySelector(".body");
    const minimizeButton = shadow.querySelector(".minimize-button");
    const restoreButton = shadow.querySelector(".restore-button");
    minimizeButton.addEventListener("click", () => {
      host.classList.add("is-minimized");
    });
    restoreButton.addEventListener("click", () => {
      host.classList.remove("is-minimized");
    });

    const hasResults = !error && Array.isArray(data && data.results) && data.results.length > 0;

    if (error) {
      const paragraph = document.createElement("p");
      paragraph.className = "error";
      paragraph.textContent = error;
      body.appendChild(paragraph);
    } else {
      renderResults(body, data);
    }

    document.body.appendChild(host);
    setAnalyzeButtonVisible(!hasResults);
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

    if (typeof data.suitability_score === "number" || data.explanation) {
      const summary = document.createElement("section");
      summary.className = "summary-panel";
      const text = document.createElement("p");
      const score = typeof data.suitability_score === "number"
        ? `${data.suitability_score}%`
        : "Not calculated";
      text.innerHTML = `<strong>Suitability score:</strong> ${score}`;
      summary.appendChild(text);
      if (data.explanation) {
        const explanation = document.createElement("p");
        explanation.textContent = data.explanation;
        summary.appendChild(explanation);
      }
      container.appendChild(summary);
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
        score.textContent = `${getConfidenceLabel(topMatch.similarity_score)} - ${Math.round(topMatch.similarity_score * 100)}%`;
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

      if (result.source_evidence) {
        const evidence = document.createElement("p");
        evidence.className = "evidence";
        const evidenceLabel = document.createElement("strong");
        evidenceLabel.textContent = "Matched because: ";
        evidence.append(evidenceLabel, result.source_evidence);
        section.appendChild(evidence);
      }

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

  onReady(() => {
    createButton();
    watchPageChanges();
  });
}());
