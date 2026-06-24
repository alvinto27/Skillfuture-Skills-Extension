(function () {
  if (window.__skillsfuture_hook_installed) return;
  window.__skillsfuture_hook_installed = true;

  const BUTTON_ID = "skillsfuture-analyze-btn";
  const MODAL_ID = "skillsfuture-results-modal";
  const DEFAULT_BACKEND_URL = "http://localhost:8000/analyze-job";
  const MIN_DESCRIPTION_LENGTH = 100;
  const MAX_JOB_DESCRIPTION_LENGTH = 12000;
  const HISTORY_STORAGE_KEY = "skillsfuture_analysis_history";
  const HISTORY_LIMIT = 10;
  const DEFAULT_RETRY_COUNT = 1;
  const DEFAULT_TIMEOUT_SECONDS = 45;
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

  const JOB_DETAIL_HINTS = [
    "full time",
    "part time",
    "junior executive",
    "senior executive",
    "professional",
    "manager",
    "no exp required",
    "year exp",
    "monthly",
    "posted",
    "closing on"
  ];

  const SITE_JOB_DESCRIPTION_SELECTORS = {
    myCareersFuture: [
      "main [data-testid*='job-description' i]",
      "main [data-testid*='description' i]",
      "main [data-cy*='job-description' i]",
      "main [data-test*='job-description' i]",
      "main [data-automation*='jobDescription' i]",
      "main [class*='job-description' i]",
      "main [class*='jobDescription' i]",
      "main [class*='description' i]",
      "main article",
      "main section",
      "[role='main'] [data-testid*='job' i]",
      "[role='main'] [class*='job' i]"
    ],
    jobStreet: [
      "div[class*='job-description' i]",
      "div[class*='job-desc' i]",
      "div[class*='job description' i]",
      "div[class*='description' i]",
      "section[class*='job-desc' i]",
      "section[class*='description' i]",
      "div[id*='jobDescription' i]",
      "div[id*='jobDescriptionText' i]",
      "div[id*='description' i]",
      ".job-desc-module",
      ".job-details__description",
      ".job-info__section",
      ".job-detail-description"
    ],
    generic: [
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
      "article",
      "main section",
      "section[aria-label*='description' i]",
      "section[class*='description' i]",
      "div[class*='job-description' i]",
      "div[class*='description' i]"
    ]
  };

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
      background: "#0f766e",
      color: "#ffffff",
      border: "0",
      borderRadius: "6px",
      boxShadow: "0 8px 20px rgba(17, 24, 39, 0.18)",
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

  function resetForPageNavigation(reason) {
    const previousUrl = watchedUrl;
    watchedUrl = window.location.href;
    document.getElementById(MODAL_ID)?.remove();
    createButton();
    setAnalyzeButtonVisible(true);
    debugLog("SPA navigation detected", {
      reason,
      previousUrl,
      newUrl: watchedUrl,
      analyzeButtonReset: true
    });
  }

  function handlePossiblePageNavigation(reason) {
    if (window.location.href === watchedUrl) return;
    resetForPageNavigation(reason);
  }

  function installSpaNavigationWatcher() {
    if (window.__skillsfuture_spa_watcher_installed) return;
    window.__skillsfuture_spa_watcher_installed = true;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      window.setTimeout(() => handlePossiblePageNavigation("history.pushState"), 0);
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      window.setTimeout(() => handlePossiblePageNavigation("history.replaceState"), 0);
      return result;
    };

    window.addEventListener("popstate", () => {
      window.setTimeout(() => handlePossiblePageNavigation("popstate"), 0);
    });

    window.setInterval(() => {
      handlePossiblePageNavigation("interval-backup");
    }, 750);
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements)).filter(Boolean);
  }

  function getText(element) {
    return (element && (element.innerText || element.textContent) || "").replace(/\s+/g, " ").trim();
  }

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

  function buildSelectedTextExtraction(selectedText) {
    logExtractionResult("Selected text used", {
      selectedTextUsed: true,
      extractedCharCount: selectedText.length
    });
    return {
      jobDescription: capJobDescription(selectedText),
      jobData: null,
      validationError: "",
      source: "selection",
      originalLength: selectedText.length
    };
  }

  function formatScrapeFailureError(reason) {
    const prefix = reason ? `${reason}\n\n` : "";
    return `${prefix}You can highlight the job description text on the page, then click Analyze again.`;
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

  function getScoreClass(score) {
    if (typeof score !== "number") return "score";
    if (score >= 0.6) return "score score-high";
    if (score >= 0.4) return "score score-medium";
    return "score score-low";
  }

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

  function getCurrentSiteKey() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes("mycareersfuture.gov.sg")) return "myCareersFuture";
    if (host.includes("jobstreet.com")) return "jobStreet";
    return "generic";
  }

  function getSelectorsForCurrentSite() {
    const siteKey = getCurrentSiteKey();
    return {
      siteKey,
      selectors: [
        ...(SITE_JOB_DESCRIPTION_SELECTORS[siteKey] || []),
        ...SITE_JOB_DESCRIPTION_SELECTORS.generic
      ]
    };
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

  function removeTextAfterBlacklistedSection(text) {
    const lowerText = String(text || "").toLowerCase();
    const cutIndexes = BLACKLIST_SECTION_PHRASES
      .map((phrase) => lowerText.indexOf(phrase))
      .filter((index) => index >= 0);

    if (!cutIndexes.length) return text;
    return text.slice(0, Math.min(...cutIndexes));
  }

  function extractFallbackJobMainText(root) {
    const candidates = uniqueElements([
      document.querySelector("main"),
      document.querySelector("[role='main']"),
      document.querySelector("[data-testid*='job' i]"),
      document.querySelector("[class*='job' i]"),
      root
    ]);

    const scored = candidates
      .map((element) => {
        const rawText = removeTextAfterBlacklistedSection(getStructuredText(element));
        const text = cleanExtractedText(rawText);
        const normalized = normalizeText(text).toLowerCase();
        const score = JOB_DETAIL_HINTS.reduce((total, hint) => (
          normalized.includes(hint) ? total + 1 : total
        ), 0);
        return { element, text, score };
      })
      .filter((candidate) => candidate.text.length >= MIN_DESCRIPTION_LENGTH)
      .sort((a, b) => b.score - a.score || b.text.length - a.text.length);

    return scored[0]?.text || "";
  }

  function logExtractionResult(eventName, details) {
    debugLog(eventName, {
      site: getCurrentSiteKey(),
      ...details
    });
  }

  async function getAnalysisHistory() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const value = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
        return Array.isArray(value[HISTORY_STORAGE_KEY]) ? value[HISTORY_STORAGE_KEY] : [];
      } catch (error) {
        debugLog("Could not read analysis history from chrome.storage", error);
      }
    }

    try {
      const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      debugLog("Could not read analysis history from localStorage", error);
      return [];
    }
  }

  async function setAnalysisHistory(history) {
    const trimmedHistory = history.slice(0, HISTORY_LIMIT);

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: trimmedHistory });
        return;
      } catch (error) {
        debugLog("Could not save analysis history to chrome.storage", error);
      }
    }

    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmedHistory));
    } catch (error) {
      debugLog("Could not save analysis history to localStorage", error);
    }
  }

  function getHistoryJobTitle(extraction) {
    if (extraction.jobData && extraction.jobData.title) return extraction.jobData.title;
    return normalizeText(document.title.split("|")[0] || document.title) || "Untitled job";
  }

  function getHistoryCompanyName(extraction) {
    if (extraction.jobData && extraction.jobData.company) return extraction.jobData.company;
    return "";
  }

  async function saveAnalysisHistory(data, extraction) {
    const results = Array.isArray(data && data.results) ? data.results : [];
    if (!results.length) return;

    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: getHistoryJobTitle(extraction),
      company: getHistoryCompanyName(extraction),
      url: window.location.href,
      analyzedAt: new Date().toISOString(),
      suitabilityScore: typeof data.suitability_score === "number" ? data.suitability_score : null,
      extractedSkills: results
        .map((result) => result.extracted_skill)
        .filter(Boolean)
        .slice(0, 5),
      data
    };

    const history = await getAnalysisHistory();
    await setAnalysisHistory([item, ...history.filter((entry) => entry.url !== item.url)].slice(0, HISTORY_LIMIT));
    debugLog("Analysis history saved", {
      title: item.title,
      url: item.url,
      savedCount: Math.min(history.length + 1, HISTORY_LIMIT)
    });
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
      logExtractionResult("Heading section extracted", {
        selectorUsed: "heading-text",
        heading: headingText,
        extractedCharCount: text.length
      });
    });

    if (!Object.keys(sections).length) {
      const fallbackText = extractFallbackJobMainText(root);
      if (fallbackText) {
        sections["Job Description"] = fallbackText;
        logExtractionResult("Fallback used", {
          fallbackUsed: "cleaned-main-job-content",
          selectorUsed: "main, [role='main'], job-like containers",
          extractedCharCount: fallbackText.length
        });
        ignoredSections.push({
          heading: "Heading extraction fallback",
          reason: "No target headings found; used cleaned main job content before MyCareersFuture skill/profile widget"
        });
      }
    }

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

    logExtractionResult("Headings found", {
      headings: jobData.headingsFound,
      headingCount: jobData.headingsFound.length
    });
    logExtractionResult("Ignored sections", {
      ignoredSections: jobData.ignoredSections
    });
    logExtractionResult("Final extracted job data", {
      extractedCharCount: jobDescription.length,
      sectionCount: Object.keys(jobData.sections).length,
      jobData
    });

    window.__skillsfuture_last_extracted_job_data = jobData;
    document.documentElement.setAttribute("data-skillsfuture-last-extracted-job", JSON.stringify(jobData));

    return { jobDescription, jobData, validationError };
  }

  function findJobDescriptionText() {
    if (isMyCareersFutureJobPage()) {
      const extraction = extractMyCareersFutureJobData();
      if (!extraction.validationError) return extraction;

      const selectedText = getSelectedText();
      if (selectedText) return buildSelectedTextExtraction(selectedText);

      return extraction;
    }

    const selectedText = getSelectedText();
    if (selectedText) {
      return buildSelectedTextExtraction(selectedText);
    }

    const candidates = [];
    const { siteKey, selectors } = getSelectorsForCurrentSite();
    logExtractionResult("Selector group selected", {
      selectorGroup: siteKey,
      selectorCount: selectors.length
    });

    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((element) => {
          candidates.push({ selector, element, siteKey });
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

    if (best) {
      logExtractionResult("Selector used", {
        selectorGroup: siteKey,
        selectorUsed: best.selector,
        extractedCharCount: best.text.length
      });
      return {
        jobDescription: capJobDescription(best.text),
        jobData: null,
        validationError: "",
        source: best.selector,
        originalLength: best.text.length
      };
    }

    const bodyText = getText(document.body);
    if (bodyText.length > MIN_DESCRIPTION_LENGTH) {
      logExtractionResult("Fallback used", {
        fallbackUsed: "body-text",
        selectorGroup: siteKey,
        selectorUsed: "document.body",
        extractedCharCount: bodyText.length
      });
      return {
        jobDescription: capJobDescription(bodyText),
        jobData: null,
        validationError: "",
        source: "body",
        originalLength: bodyText.length
      };
    }

    debugLog("No usable job description found");
    logExtractionResult("Extraction failed", {
      selectorGroup: siteKey,
      fallbackUsed: "none",
      extractedCharCount: 0
    });
    return {
      jobDescription: "",
      jobData: null,
      validationError: "",
      source: "none",
      originalLength: 0
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

  async function getNetworkSettings() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const value = await chrome.storage.local.get(["apiAccessToken", "retryCount", "timeoutSeconds"]);
        return {
          apiAccessToken: String(value.apiAccessToken || ""),
          retries: Math.min(Math.max(Number(value.retryCount ?? DEFAULT_RETRY_COUNT), 0), 3),
          timeoutSeconds: Math.min(Math.max(Number(value.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS), 5), 120)
        };
      } catch (error) {
        debugLog("Could not read network settings", error);
      }
    }
    return {
      apiAccessToken: "",
      retries: DEFAULT_RETRY_COUNT,
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS
    };
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

  async function postWithRetry(
    url,
    payload,
    retries = DEFAULT_RETRY_COUNT,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    apiAccessToken = ""
  ) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      try {
const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiAccessToken
              ? { Authorization: `Bearer ${apiAccessToken}` }
              : {})
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(data.detail || `${response.status} ${response.statusText}`);
          error.status = response.status;
          throw error;
        }
        return { data, status: response.status };
      } catch (error) {
        lastError = error.name === "AbortError"
          ? new Error(`Request timed out after ${timeoutSeconds} seconds`)
          : error;
        const retryable = !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
        if (attempt < retries && retryable) {
          await delay(500 * (attempt + 1));
          continue;
        }
        break;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    throw lastError;
  }

  async function onAnalyzeClicked() {
    const button = document.getElementById(BUTTON_ID);
    const extraction = findJobDescriptionText();
    const jobDescription = extraction.jobDescription;

    if (extraction.validationError) {
      showModal({ error: formatScrapeFailureError(extraction.validationError) });
      return;
    }

    if (!jobDescription) {
      showModal({
        error: formatScrapeFailureError("Could not find the job description automatically.")
      });
      return;
    }

    if (!jobDescription || includesBlacklistedText(jobDescription)) {
      showModal({
        error: formatScrapeFailureError("Could not safely extract employer job requirements from this page. Analysis stopped to avoid using MyCareersFuture profile suggestion text.")
      });
      return;
    }

    const payload = {
      job_description: jobDescription,
      job_data: extraction.jobData || undefined,
      include_rag: true
    };
    const backendUrl = await getStoredBackendUrl();
    const networkSettings = await getNetworkSettings();
    showModal({ loading: true });

    try {
      if (button) button.textContent = "Analyzing...";
      const result = await postWithRetry(
        backendUrl,
        payload,
        networkSettings.retries,
        networkSettings.timeoutSeconds,
        networkSettings.apiAccessToken
      );
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
      const notice = extraction.source === "selection"
        ? {
          title: "Using selected text",
          message: "The analysis is based on the text you highlighted on the page."
        }
        : null;
      await saveAnalysisHistory(data, extraction);
      showModal({ data, notice });
    } catch (error) {
      console.error("Failed to call SkillsFuture backend", error);
      showModal({
        error: `Backend unavailable: ${error.message}. Confirm FastAPI is running, then retry.`
      });
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
        .retry-button {
          min-height: 34px;
          margin-top: 10px;
          border: 1px solid #99f6e4;
          border-radius: 6px;
          background: #f0fdfa;
          color: #115e59;
          cursor: pointer;
          font: 800 12px/1 Arial, sans-serif;
          padding: 0 11px;
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
      const retryButton = document.createElement("button");
      retryButton.className = "retry-button";
      retryButton.type = "button";
      retryButton.textContent = "Retry analysis";
      retryButton.addEventListener("click", onAnalyzeClicked);
      body.appendChild(retryButton);
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
      empty.textContent = "No skill matches were found.";
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

  function formatHistoryTime(value) {
    try {
      return new Date(value).toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (error) {
      return "Unknown time";
    }
  }

  async function renderHistoryView(container, returnToCurrentResult) {
    container.textContent = "";
    setAnalyzeButtonVisible(true);

    const view = document.createElement("section");
    view.className = "history-view";

    const toolbar = document.createElement("div");
    toolbar.className = "history-toolbar";
    const title = document.createElement("h3");
    title.textContent = "Analysis history";
    const toolbarActions = document.createElement("div");
    toolbarActions.className = "history-toolbar-actions";
    const backButton = document.createElement("button");
    backButton.className = "history-back";
    backButton.type = "button";
    backButton.textContent = returnToCurrentResult ? "Back to result" : "Close history";
    const clearButton = document.createElement("button");
    clearButton.className = "history-clear";
    clearButton.type = "button";
    clearButton.textContent = "Clear history";
    toolbarActions.append(backButton, clearButton);
    toolbar.append(title, toolbarActions);
    view.appendChild(toolbar);

    const history = await getAnalysisHistory();

    backButton.addEventListener("click", () => {
      if (returnToCurrentResult) {
        returnToCurrentResult();
        return;
      }
      document.getElementById(MODAL_ID)?.remove();
      setAnalyzeButtonVisible(true);
    });

    clearButton.addEventListener("click", async () => {
      await setAnalysisHistory([]);
      await renderHistoryView(container, returnToCurrentResult);
      setAnalyzeButtonVisible(true);
    });

    if (!history.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "No analyzed jobs saved yet.";
      view.appendChild(empty);
      container.appendChild(view);
      return;
    }

    history.forEach((item) => {
      const card = document.createElement("article");
      card.className = "history-item";

      const itemTitle = document.createElement("p");
      itemTitle.className = "history-title";
      itemTitle.textContent = item.title || "Untitled job";

      const meta = document.createElement("p");
      meta.className = "history-meta";
      const companyText = item.company ? `${item.company} · ` : "";
      const scoreText = typeof item.suitabilityScore === "number"
        ? ` · Suitability ${item.suitabilityScore}%`
        : "";
      meta.textContent = `${companyText}${formatHistoryTime(item.analyzedAt)}${scoreText}`;

      const skills = document.createElement("p");
      skills.className = "history-skills";
      const extractedSkills = Array.isArray(item.extractedSkills) ? item.extractedSkills : [];
      skills.textContent = extractedSkills.length
        ? `Extracted skills: ${extractedSkills.join(", ")}`
        : "Extracted skills unavailable";

      const actions = document.createElement("div");
      actions.className = "history-actions";

      const viewButton = document.createElement("button");
      viewButton.className = "history-action";
      viewButton.type = "button";
      viewButton.textContent = "View result";
      viewButton.addEventListener("click", () => {
        showModal({
          data: item.data,
          notice: {
            title: "History result",
            message: `This result was saved on ${formatHistoryTime(item.analyzedAt)}.`
          }
        });
      });

      const openLink = document.createElement("a");
      openLink.className = "history-link";
      openLink.href = item.url || "#";
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      openLink.textContent = "Open job page";

      actions.append(viewButton, openLink);
      card.append(itemTitle, meta, skills, actions);
      view.appendChild(card);
    });

    container.appendChild(view);
  }

  function showModal({ data, error, notice, loading }) {
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
          width: min(480px, 100vw);
          height: 100vh;
          display: flex;
          flex-direction: column;
          pointer-events: auto;
          background: #f6f7f9;
          color: #111827;
          border-left: 1px solid #d9dee7;
          box-shadow: -8px 0 26px rgba(17, 24, 39, 0.14);
          font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
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
          padding: 15px 20px 16px;
          background: #ffffff;
          border-top: 4px solid #0f766e;
          border-bottom: 1px solid #d9dee7;
        }
        .heading-copy { min-width: 0; }
        .header-actions {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 8px;
        }
        h2 {
          margin: 0;
          color: #111827;
          font-size: 17px;
          font-weight: 750;
          line-height: 1.2;
          letter-spacing: 0;
        }
        .subtitle {
          margin: 4px 0 0;
          color: #4b5563;
          font-size: 12px;
          line-height: 1.35;
        }
        .minimize-button,
        .dashboard-button,
        .history-button,
        .restore-button {
          flex: 0 0 auto;
          border: 1px solid #d9dee7;
          border-radius: 6px;
          background: #ffffff;
          color: #374151;
          cursor: pointer;
        }
        .history-button {
          height: 34px;
          font: 650 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          padding: 0 12px;
        }
        .dashboard-button {
          height: 34px;
          font: 650 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          padding: 0 12px;
        }
        .minimize-button {
          min-width: 54px;
          height: 34px;
          font: 650 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
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
          border-color: #0f766e;
          background: #0f766e;
          color: #ffffff;
          box-shadow: 0 8px 20px rgba(17, 24, 39, 0.18);
          font: 700 13px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          padding: 11px 14px;
        }
        .restore-button::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #ffffff;
        }
        .minimize-button:hover {
          background: #f3f4f6;
          color: #111827;
        }
        .history-button:hover {
          background: #f3f4f6;
          color: #111827;
        }
        .dashboard-button:hover {
          background: #f3f4f6;
          color: #111827;
        }
        .restore-button:hover { background: #115e59; }
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
          border-radius: 6px;
          padding: 12px;
        }
        .retry-button {
          min-height: 34px;
          margin-top: 10px;
          border: 1px solid #99f6e4;
          border-radius: 6px;
          background: #f0fdfa;
          color: #115e59;
          cursor: pointer;
          font: 800 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          padding: 0 11px;
        }
        .notice {
          margin: 0 0 14px;
          color: #1f2937;
          background: #f9fafb;
          border: 1px solid #d9dee7;
          border-radius: 6px;
          padding: 12px;
        }
        .notice strong {
          display: block;
          margin: 0 0 3px;
          color: #111827;
          font-size: 13px;
        }
        .notice span {
          display: block;
          font-size: 12px;
          line-height: 1.4;
        }
        .skeleton-summary,
        .skeleton-skill {
          margin: 0 0 14px;
          background: #ffffff;
          border: 1px solid #d9dee7;
          border-radius: 6px;
          overflow: hidden;
          box-shadow: none;
        }
        .skeleton-line,
        .skeleton-block,
        .skeleton-pill {
          display: block;
          border-radius: 6px;
          background: linear-gradient(90deg, #e5e7eb 0%, #f9fafb 45%, #e5e7eb 90%);
          background-size: 220% 100%;
          animation: skillsfuture-skeleton 1200ms ease-in-out infinite;
        }
        .skeleton-line {
          height: 13px;
          margin-bottom: 10px;
        }
        .skeleton-summary {
          padding: 12px 14px;
        }
        .skeleton-line.short { width: 42%; }
        .skeleton-line.medium { width: 68%; }
        .skeleton-line.long { width: 88%; }
        .skeleton-line.label-width { width: 54%; height: 10px; }
        .skeleton-mapping {
          display: block;
          border-bottom: 1px solid #d9dee7;
        }
        .skeleton-source,
        .skeleton-match {
          min-width: 0;
          padding: 14px 14px 10px;
        }
        .skeleton-source { background: #ffffff; }
        .skeleton-match {
          margin: 0 14px 14px;
          padding: 12px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
        }
        .skeleton-arrow {
          display: none;
          align-items: center;
          justify-content: center;
          background: #f0fdfa;
          border-left: 1px solid #d9dee7;
          border-right: 1px solid #d9dee7;
        }
        .skeleton-arrow .skeleton-line {
          width: 16px;
          height: 8px;
          margin: 0;
        }
        .skeleton-pill {
          width: 88px;
          height: 24px;
          border-radius: 999px;
          margin-top: 11px;
        }
        .skeleton-block {
          height: 44px;
          margin-top: 10px;
        }
        .skeleton-detail {
          padding: 13px 14px 0;
        }
        .skeleton-secondary {
          padding: 10px 14px 14px;
        }
        @keyframes skillsfuture-skeleton {
          from { background-position: 120% 0; }
          to { background-position: -120% 0; }
        }
        .summary-panel {
          margin: 0 0 14px;
          background: #ffffff;
          border: 1px solid #d9dee7;
          border-radius: 6px;
          padding: 12px 14px;
          box-shadow: none;
        }
        .summary-panel p {
          margin: 0;
          color: #4b5563;
          font-size: 13px;
        }
        .summary-panel strong { color: #111827; }
        .history-view {
          margin: 0;
        }
        .history-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin: 0 0 14px;
        }
        .history-toolbar-actions {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 8px;
        }
        .history-toolbar h3 {
          margin: 0;
          color: #111827;
          font-size: 16px;
          line-height: 1.25;
        }
        .history-back,
        .history-clear {
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          font: 700 12px/1 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          padding: 9px 10px;
        }
        .history-back {
          border-color: #99f6e4;
          background: #f0fdfa;
          color: #115e59;
        }
        .history-clear {
          border-color: #d9dee7;
          background: #ffffff;
          color: #374151;
        }
        .history-empty,
        .history-item {
          margin: 0 0 12px;
          background: #ffffff;
          border: 1px solid #d9dee7;
          border-radius: 6px;
          padding: 12px 14px;
          box-shadow: none;
        }
        .history-title {
          margin: 0;
          color: #111827;
          font-size: 14px;
          font-weight: 800;
          line-height: 1.3;
        }
        .history-meta,
        .history-skills {
          margin: 5px 0 0;
          color: #4b5563;
          font-size: 12px;
          line-height: 1.4;
        }
        .history-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .history-action,
        .history-link {
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          border: 1px solid #99f6e4;
          border-radius: 6px;
          background: #f0fdfa;
          color: #115e59;
          cursor: pointer;
          font: 800 12px/1 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          padding: 0 10px;
          text-decoration: none;
        }
        .history-link {
          border-color: #d9dee7;
          background: #ffffff;
          color: #374151;
        }
        .skill {
          margin: 0 0 14px;
          overflow: hidden;
          background: #ffffff;
          border: 1px solid #d9dee7;
          border-radius: 6px;
          box-shadow: none;
        }
        .mapping {
          display: block;
          border-bottom: 1px solid #d9dee7;
        }
        .source,
        .match {
          min-width: 0;
          padding: 14px 14px 10px;
        }
        .source { background: #ffffff; }
        .match {
          margin: 0 14px 14px;
          padding: 12px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
        }
        .label {
          margin: 0 0 4px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 650;
          letter-spacing: 0;
          text-transform: none;
        }
        .skill-title,
        .match-title {
          margin: 0;
          color: #111827;
          font-size: 16px;
          font-weight: 750;
          line-height: 1.3;
          overflow-wrap: anywhere;
        }
        .match-title { font-size: 15px; }
        .arrow {
          display: none;
          align-items: center;
          justify-content: center;
          color: #0f766e;
          background: #f0fdfa;
          border-left: 1px solid #d9dee7;
          border-right: 1px solid #d9dee7;
          font-size: 20px;
          font-weight: 900;
        }
        .definition {
          margin: 0;
          padding: 13px 14px 12px;
          color: #374151;
          font-size: 13px;
          line-height: 1.45;
        }
        .definition strong { color: #111827; }
        .evidence {
          margin: 0;
          padding: 0 14px 13px;
          color: #4b5563;
          font-size: 12px;
          line-height: 1.45;
        }
        .evidence strong { color: #111827; }
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
          background: #f3f4f6;
          color: #374151;
          font-size: 11px;
          font-weight: 800;
          line-height: 1;
          padding: 5px 8px;
        }
        .score-high {
          background: #dcfce7;
          color: #166534;
        }
        .score-medium {
          background: #fef3c7;
          color: #92400e;
        }
        .score-low {
          background: #fee2e2;
          color: #991b1b;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid #fed7aa;
          border-radius: 999px;
          background: #fff7ed;
          color: #854d0e;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
          padding: 5px 8px;
          box-shadow: none;
        }
        .badge::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #f59e0b;
        }
        .secondary-matches {
          margin: 0;
          padding: 0 14px 14px;
          color: #6b7280;
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
          .arrow {
            min-height: 34px;
            border: 0;
            border-top: 1px solid #d9dee7;
            border-bottom: 1px solid #d9dee7;
            transform: rotate(90deg);
          }
        }
      </style>
      <section class="panel" role="dialog" aria-modal="false" aria-label="SkillsFuture analysis results">
        <div class="header">
          <div class="heading-copy">
            <h2>SkillsFuture Skills</h2>
            <p class="subtitle">Skills found from this job post.</p>
          </div>
          <div class="header-actions">
            <button class="dashboard-button" type="button" aria-label="Open career dashboard" title="Dashboard">Dashboard</button>
            <button class="history-button" type="button" aria-label="Show analysis history" title="History">History</button>
            <button class="minimize-button" type="button" aria-label="Minimize SkillsFuture results" title="Minimize">Hide</button>
          </div>
        </div>
        <div class="body"></div>
      </section>
      <button class="restore-button" type="button" aria-label="Show SkillsFuture results">Show analysis</button>
    `;

    const body = shadow.querySelector(".body");
    const dashboardButton = shadow.querySelector(".dashboard-button");
    const historyButton = shadow.querySelector(".history-button");
    const minimizeButton = shadow.querySelector(".minimize-button");
    const restoreButton = shadow.querySelector(".restore-button");
    dashboardButton.addEventListener("click", () => {
      const dashboardUrl = chrome.runtime.getURL("dashboard.html");
      window.open(dashboardUrl, "_blank", "noopener");
    });
    historyButton.addEventListener("click", () => {
      const returnToCurrentResult = hasResults
        ? () => showModal({ data, notice })
        : null;
      renderHistoryView(body, returnToCurrentResult);
    });
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
      const retryButton = document.createElement("button");
      retryButton.className = "retry-button";
      retryButton.type = "button";
      retryButton.textContent = "Retry analysis";
      retryButton.addEventListener("click", onAnalyzeClicked);
      body.appendChild(retryButton);
    } else if (loading && !data) {
      const appendLine = (container, className) => {
        const line = document.createElement("span");
        line.className = className;
        container.appendChild(line);
      };

      const summary = document.createElement("section");
      summary.className = "skeleton-summary";
      appendLine(summary, "skeleton-line short");
      appendLine(summary, "skeleton-line long");
      appendLine(summary, "skeleton-line medium");
      body.appendChild(summary);

      for (let index = 0; index < 2; index += 1) {
        const skill = document.createElement("section");
        skill.className = "skeleton-skill";

        const mapping = document.createElement("div");
        mapping.className = "skeleton-mapping";

        const source = document.createElement("div");
        source.className = "skeleton-source";
        appendLine(source, "skeleton-line label-width");
        appendLine(source, "skeleton-line medium");
        appendLine(source, "skeleton-line short");

        const arrow = document.createElement("div");
        arrow.className = "skeleton-arrow";
        appendLine(arrow, "skeleton-line");

        const match = document.createElement("div");
        match.className = "skeleton-match";
        appendLine(match, "skeleton-line label-width");
        appendLine(match, "skeleton-line long");
        appendLine(match, "skeleton-line medium");
        const pill = document.createElement("span");
        pill.className = "skeleton-pill";
        match.appendChild(pill);

        mapping.append(source, arrow, match);
        skill.appendChild(mapping);

        const definition = document.createElement("div");
        definition.className = "skeleton-detail";
        appendLine(definition, "skeleton-line long");
        appendLine(definition, "skeleton-line medium");
        skill.appendChild(definition);

        const evidence = document.createElement("div");
        evidence.className = "skeleton-detail";
        appendLine(evidence, "skeleton-line long");
        appendLine(evidence, "skeleton-line short");
        skill.appendChild(evidence);

        const secondary = document.createElement("div");
        secondary.className = "skeleton-secondary";
        appendLine(secondary, "skeleton-line medium");
        skill.appendChild(secondary);

        body.appendChild(skill);
      }
    } else {
      if (notice) {
        const noticeBox = document.createElement("p");
        noticeBox.className = "notice";
        const noticeTitle = document.createElement("strong");
        noticeTitle.textContent = notice.title;
        const noticeMessage = document.createElement("span");
        noticeMessage.textContent = notice.message;
        noticeBox.append(noticeTitle, noticeMessage);
        body.appendChild(noticeBox);
      }
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
      const fitLabel = document.createElement("strong");
      fitLabel.textContent = "Overall fit: ";
      text.append(fitLabel, score);
      summary.appendChild(text);
      if (data.explanation) {
        const explanation = document.createElement("p");
        explanation.textContent = data.explanation;
        summary.appendChild(explanation);
      }
      container.appendChild(summary);
    }

    if (data.rag_recommendation) {
      const rag = document.createElement("section");
      rag.className = "summary-panel";

      const heading = document.createElement("p");
      const headingLabel = document.createElement("strong");
      headingLabel.textContent = "RAG recommendation: ";
      heading.append(headingLabel, data.rag_recommendation.summary || "Grounded recommendations from retrieved SkillsFuture matches.");
      rag.appendChild(heading);

      const priorities = Array.isArray(data.rag_recommendation.priority_skills)
        ? data.rag_recommendation.priority_skills.slice(0, 5)
        : [];

      priorities.forEach((priority) => {
        const item = document.createElement("p");
        const title = document.createElement("strong");
        title.textContent = `${priority.learning_priority || "Priority"} - ${priority.job_skill || "Skill"}: `;
        item.append(title, priority.why_it_matched || priority.next_step || "");
        if (priority.next_step) item.append(` Next step: ${priority.next_step}`);
        rag.appendChild(item);
      });

      container.appendChild(rag);
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
      sourceLabel.textContent = "Job skill";
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
      matchLabel.textContent = "SkillsFuture match";
      const matchTitle = document.createElement("p");
      matchTitle.className = "match-title";
      matchTitle.textContent = topMatch.official_skill_title || "Skill match";

      const meta = document.createElement("div");
      meta.className = "meta";
      if (typeof topMatch.similarity_score === "number") {
        const score = document.createElement("span");
        score.className = getScoreClass(topMatch.similarity_score);
        score.textContent = `${topMatch.confidence_label || getConfidenceLabel(topMatch.similarity_score)} - ${Math.round(topMatch.similarity_score * 100)}%`;
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
      strong.textContent = "What it means: ";
      definition.append(strong, topMatch.official_skill_description || "No official definition returned.");
      section.appendChild(definition);

      if (result.source_evidence) {
        const evidence = document.createElement("p");
        evidence.className = "evidence";
        const evidenceLabel = document.createElement("strong");
        evidenceLabel.textContent = "Found in the job post: ";
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
    installSpaNavigationWatcher();
  });
}());
