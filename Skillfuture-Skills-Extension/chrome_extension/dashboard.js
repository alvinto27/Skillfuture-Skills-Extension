const HISTORY_STORAGE_KEY = "skillsfuture_analysis_history";
const PLANNER_STORAGE_KEY = "skillsfuture_course_planner";
const DEFAULT_BACKEND_URL = "http://localhost:8000/analyze-job";

const state = {
  backendBaseUrl: "http://localhost:8000",
  history: [],
  selectedJobId: "",
  settings: {
    creditBalance: 500,
    monthlyHours: 20
  },
  plan: [],
  skillLevels: {},
  searchResults: [],
  recommendations: [],
  recommendationRequestId: 0,
  pathway: null,
  pathwayRequestId: 0
};

const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
  connectionText: document.getElementById("connectionText"),
  creditMetric: document.getElementById("creditMetric"),
  creditNote: document.getElementById("creditNote"),
  feeMetric: document.getElementById("feeMetric"),
  courseCountMetric: document.getElementById("courseCountMetric"),
  usedMetric: document.getElementById("usedMetric"),
  remainingMetric: document.getElementById("remainingMetric"),
  cashMetric: document.getElementById("cashMetric"),
  hoursMetric: document.getElementById("hoursMetric"),
  creditBalance: document.getElementById("creditBalance"),
  monthlyHours: document.getElementById("monthlyHours"),
  budgetFill: document.getElementById("budgetFill"),
  budgetUsageText: document.getElementById("budgetUsageText"),
  durationEstimate: document.getElementById("durationEstimate"),
  courseSearchForm: document.getElementById("courseSearchForm"),
  courseSearch: document.getElementById("courseSearch"),
  searchButton: document.getElementById("searchButton"),
  courseResults: document.getElementById("courseResults"),
  recommendedCourses: document.getElementById("recommendedCourses"),
  refreshRecommendations: document.getElementById("refreshRecommendations"),
  pathwayContent: document.getElementById("pathwayContent"),
  refreshPathway: document.getElementById("refreshPathway"),
  jobSelect: document.getElementById("jobSelect"),
  jobContextMessage: document.getElementById("jobContextMessage"),
  focusSkills: document.getElementById("focusSkills"),
  planList: document.getElementById("planList"),
  clearPlan: document.getElementById("clearPlan")
};

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 2
  }).format(toNumber(value));
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function getCourseFee(course) {
  const feeInfo = parseJson(course && course.fee_info, {});
  const subsidised = toNumber(
    feeInfo.course_fee_after_subsidies
      ?? feeInfo.subsidised_fee
      ?? feeInfo.nett_fee,
    NaN
  );
  if (Number.isFinite(subsidised) && subsidised >= 0) return subsidised;

  const fullFee = toNumber(
    feeInfo.full_course_fee
      ?? feeInfo.source_fee
      ?? feeInfo.course_fee,
    0
  );
  return Math.max(fullFee, 0);
}

function getCourseHours(course) {
  const value = toNumber(course && course.duration_value, 0);
  const unit = normalizeText(course && course.duration_unit).toLowerCase();
  if (!value) return 0;
  if (unit.includes("day")) return value * 8;
  if (unit.includes("week")) return value * 40;
  return value;
}

function getDeliveryLabel(course) {
  const modes = parseJson(course && course.delivery_modes, []);
  return Array.isArray(modes) && modes.length ? normalizeText(modes[0]) : "";
}

function deriveBackendBase(url) {
  const normalized = String(url || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, "");
  return normalized.replace(/\/analyze-job$/i, "");
}

async function storageGet(keys) {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return chrome.storage.local.get(keys);
  }

  const result = {};
  keys.forEach((key) => {
    const value = window.localStorage.getItem(key);
    if (value !== null) result[key] = parseJson(value, value);
  });
  return result;
}

async function storageSet(values) {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set(values);
    return;
  }

  Object.entries(values).forEach(([key, value]) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  });
}

function clearElement(element) {
  while (element.firstChild) element.firstChild.remove();
}

function createMessage(text, isError = false) {
  const message = document.createElement("div");
  message.className = isError ? "message error" : "message";
  message.textContent = text;
  return message;
}

function getTopMatch(result) {
  const matches = Array.isArray(result && result.top_matches) ? result.top_matches : [];
  return matches[0] || null;
}

function getFocusSkills(item) {
  const results = Array.isArray(item && item.data && item.data.results) ? item.data.results : [];
  return results
    .map((result) => {
      const match = getTopMatch(result);
      return normalizeText(match && match.official_skill_title) || normalizeText(result.extracted_skill);
    })
    .filter(Boolean)
    .filter((skill, index, all) => all.indexOf(skill) === index)
    .slice(0, 10);
}

function getSkillKey(skill) {
  return normalizeText(skill).toLocaleLowerCase();
}

function getSkillLevel(skill) {
  return clamp(toNumber(state.skillLevels[getSkillKey(skill)], 0), 0, 3);
}

function getSkillLevelLabel(level) {
  return ["No experience", "Beginner", "Working knowledge", "Proficient"][level] || "No experience";
}

function getGapLabel(level) {
  if (level >= 3) return { text: "No gap", className: "gap-label none" };
  if (level === 2) return { text: "Medium gap", className: "gap-label" };
  return { text: "High gap", className: "gap-label high" };
}

function getSelectedJob() {
  return state.history.find((item) => item.id === state.selectedJobId) || state.history[0] || null;
}

function getSkillGaps(item = getSelectedJob()) {
  return getFocusSkills(item)
    .map((skill) => {
      const currentLevel = getSkillLevel(skill);
      return {
        skill,
        currentLevel,
        currentLevelLabel: getSkillLevelLabel(currentLevel),
        gap: Math.max(3 - currentLevel, 0)
      };
    })
    .filter((item) => item.gap > 0)
    .sort((left, right) => right.gap - left.gap || left.skill.localeCompare(right.skill));
}

function getPlanSummary() {
  const creditBalance = Math.max(toNumber(state.settings.creditBalance), 0);
  let creditRemaining = creditBalance;
  let totalFees = 0;
  let totalCreditUsed = 0;
  let totalCash = 0;
  let totalHours = 0;

  const allocations = state.plan.map((item) => {
    const fee = getCourseFee(item.course);
    const requested = clamp(toNumber(item.creditRequested, fee), 0, fee);
    const creditUsed = Math.min(requested, creditRemaining);
    const cashRequired = Math.max(fee - creditUsed, 0);
    creditRemaining -= creditUsed;
    totalFees += fee;
    totalCreditUsed += creditUsed;
    totalCash += cashRequired;
    totalHours += getCourseHours(item.course);
    return { fee, requested, creditUsed, cashRequired };
  });

  return {
    allocations,
    creditBalance,
    creditRemaining,
    totalFees,
    totalCreditUsed,
    totalCash,
    totalHours
  };
}

async function savePlanner() {
  await storageSet({
    [PLANNER_STORAGE_KEY]: {
      settings: state.settings,
      plan: state.plan,
      skillLevels: state.skillLevels
    }
  });
}

function renderSummary() {
  const summary = getPlanSummary();
  const courseWord = state.plan.length === 1 ? "course" : "courses";
  const months = summary.totalHours > 0
    ? summary.totalHours / Math.max(toNumber(state.settings.monthlyHours, 1), 1)
    : 0;
  const percentage = summary.creditBalance > 0
    ? clamp((summary.totalCreditUsed / summary.creditBalance) * 100, 0, 100)
    : 0;

  elements.creditMetric.textContent = formatMoney(summary.creditBalance);
  elements.creditNote.textContent = summary.creditBalance
    ? "User-entered balance"
    : "No credit entered";
  elements.feeMetric.textContent = formatMoney(summary.totalFees);
  elements.courseCountMetric.textContent = `${state.plan.length} ${courseWord} planned`;
  elements.usedMetric.textContent = formatMoney(summary.totalCreditUsed);
  elements.remainingMetric.textContent = `${formatMoney(summary.creditRemaining)} remaining`;
  elements.cashMetric.textContent = formatMoney(summary.totalCash);
  elements.hoursMetric.textContent = `${Math.round(summary.totalHours * 10) / 10} learning hours`;
  elements.budgetFill.style.width = `${percentage}%`;
  elements.budgetFill.classList.toggle("over", summary.totalFees > summary.creditBalance);
  elements.budgetUsageText.textContent = summary.totalCreditUsed
    ? `${Math.round(percentage)}% of entered credit allocated`
    : "No credit allocated";
  elements.durationEstimate.textContent = months
    ? `About ${months < 1 ? "<1" : Math.ceil(months)} month${Math.ceil(months) === 1 ? "" : "s"} at your pace`
    : "No courses planned";
  elements.clearPlan.disabled = state.plan.length === 0;
}

function createCourseCard(course, recommendation = null) {
    const card = document.createElement("article");
    card.className = "course-card";

    const head = document.createElement("div");
    head.className = "course-head";

    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "course-title";
    title.textContent = course.title || "Untitled course";
    const provider = document.createElement("p");
    provider.className = "course-provider";
    provider.textContent = course.provider_name || "Provider not listed";
    copy.append(title, provider);

    const addButton = document.createElement("button");
    const alreadyPlanned = state.plan.some((item) => item.course.id === course.id);
    addButton.className = "button small primary";
    addButton.type = "button";
    addButton.disabled = alreadyPlanned;
    addButton.textContent = alreadyPlanned ? "Added" : "Add to plan";
    addButton.addEventListener("click", () => addCourseToPlan(course));
    head.append(copy, addButton);

    const meta = document.createElement("div");
    meta.className = "course-meta";
    const fee = document.createElement("span");
    fee.className = "tag fee";
    fee.textContent = `${formatMoney(getCourseFee(course))} estimated fee`;
    meta.appendChild(fee);

    if (recommendation) {
      const score = document.createElement("span");
      score.className = "tag status";
      score.textContent = `${Math.round(toNumber(recommendation.semantic_score) * 100)}% semantic match`;
      meta.appendChild(score);

      const gapBySkill = new Map(
        getSkillGaps().map((item) => [getSkillKey(item.skill), item])
      );
      const addressedGaps = (recommendation.matched_skills || [])
        .map((item) => gapBySkill.get(getSkillKey(item.skill)))
        .filter(Boolean)
        .filter((item, index, all) => (
          all.findIndex((candidate) => candidate.skill === item.skill) === index
        ))
        .slice(0, 2);
      addressedGaps.forEach((gap) => {
        const tag = document.createElement("span");
        tag.className = gap.gap >= 2 ? "tag" : "tag status";
        tag.textContent = `Addresses ${gap.skill}: ${getGapLabel(gap.currentLevel).text}`;
        meta.appendChild(tag);
      });
    }

    const hours = getCourseHours(course);
    if (hours) {
      const duration = document.createElement("span");
      duration.className = "tag";
      duration.textContent = `${Math.round(hours * 10) / 10} hours`;
      meta.appendChild(duration);
    }

    const delivery = getDeliveryLabel(course);
    if (delivery) {
      const mode = document.createElement("span");
      mode.className = "tag";
      mode.textContent = delivery;
      meta.appendChild(mode);
    }

    card.append(head, meta);

    if (recommendation && recommendation.explanation) {
      const reason = document.createElement("p");
      reason.className = "recommendation-reason";
      reason.textContent = recommendation.explanation;
      card.appendChild(reason);
    }

    return card;
}

function renderCourseResults() {
  clearElement(elements.courseResults);

  if (!state.searchResults.length) {
    elements.courseResults.appendChild(
      createMessage("Search for a skill or course topic to browse the local catalogue.")
    );
    return;
  }

  state.searchResults.forEach((item) => {
    elements.courseResults.appendChild(createCourseCard(item.course, item.recommendation));
  });
}

function renderRecommendations() {
  clearElement(elements.recommendedCourses);
  if (!state.history.length) {
    elements.recommendedCourses.appendChild(
      createMessage("Analyze a job first to receive skill-grounded course recommendations.")
    );
    return;
  }
  if (!state.recommendations.length) {
    const gaps = getSkillGaps();
    elements.recommendedCourses.appendChild(
      createMessage(
        gaps.length
          ? "No recommendations loaded for the selected skill gaps."
          : "All extracted skills are marked proficient. No gap-based course is needed."
      )
    );
    return;
  }
  state.recommendations.forEach((recommendation) => {
    elements.recommendedCourses.appendChild(
      createCourseCard(recommendation.course, recommendation)
    );
  });
}

function createPathwayTotal(label, value) {
  const item = document.createElement("div");
  item.className = "pathway-total";
  const itemLabel = document.createElement("span");
  itemLabel.textContent = label;
  const itemValue = document.createElement("strong");
  itemValue.textContent = value;
  item.append(itemLabel, itemValue);
  return item;
}

function renderPathway() {
  clearElement(elements.pathwayContent);
  const gaps = getSkillGaps();
  const stages = Array.isArray(state.pathway && state.pathway.stages)
    ? state.pathway.stages
    : [];

  if (!gaps.length) {
    elements.pathwayContent.appendChild(
      createMessage("All extracted skills are marked proficient. No learning pathway is required.")
    );
    return;
  }
  if (!stages.length) {
    elements.pathwayContent.appendChild(
      createMessage("No pathway loaded for the current skill gaps.")
    );
    return;
  }

  const totals = state.pathway.totals || {};
  const totalsRow = document.createElement("div");
  totalsRow.className = "pathway-totals";
  totalsRow.append(
    createPathwayTotal("Fees", formatMoney(totals.estimated_fee)),
    createPathwayTotal("Credit", formatMoney(totals.credit_used)),
    createPathwayTotal("Cash", formatMoney(totals.cash_required)),
    createPathwayTotal("Time", `${toNumber(totals.estimated_months)} month${toNumber(totals.estimated_months) === 1 ? "" : "s"}`)
  );
  elements.pathwayContent.appendChild(totalsRow);

  const list = document.createElement("div");
  list.className = "pathway-list";
  stages.forEach((stage) => {
    const row = document.createElement("article");
    row.className = "pathway-stage";
    const number = document.createElement("span");
    number.className = "pathway-number";
    number.textContent = String(stage.stage);

    const content = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = `${stage.stage_label}: ${stage.title}`;
    const reason = document.createElement("p");
    reason.textContent = stage.why_this_stage;

    const course = document.createElement("div");
    course.className = "pathway-course";
    const courseHead = document.createElement("div");
    courseHead.className = "pathway-course-head";
    const courseName = document.createElement("strong");
    courseName.textContent = stage.course.title;
    const addButton = document.createElement("button");
    const alreadyPlanned = state.plan.some((item) => item.course.id === stage.course.id);
    addButton.className = "button small primary";
    addButton.type = "button";
    addButton.disabled = alreadyPlanned;
    addButton.textContent = alreadyPlanned ? "Added" : "Add";
    addButton.addEventListener("click", () => addCourseToPlan(stage.course));
    courseHead.append(courseName, addButton);

    const rationale = document.createElement("p");
    rationale.textContent = stage.why_this_course;
    const action = document.createElement("p");
    const actionLabel = document.createElement("strong");
    actionLabel.textContent = "Action: ";
    action.append(actionLabel, stage.practical_action);
    const outcome = document.createElement("p");
    outcome.className = "pathway-outcome";
    const outcomeLabel = document.createElement("strong");
    outcomeLabel.textContent = "Outcome: ";
    outcome.append(outcomeLabel, stage.measurable_outcome);

    const meta = document.createElement("div");
    meta.className = "course-meta";
    [
      formatMoney(stage.estimated_fee),
      `${toNumber(stage.duration_hours)} hours`,
      `${formatMoney(stage.credit_used)} credit`,
      `${formatMoney(stage.cash_required)} cash`
    ].forEach((text) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = text;
      meta.appendChild(tag);
    });

    course.append(courseHead, rationale, action, outcome, meta);
    if (stage.alternative && stage.alternative.course) {
      const alternative = document.createElement("div");
      alternative.className = "pathway-alternative";
      const alternativeName = document.createElement("span");
      alternativeName.textContent = `Alternative: ${stage.alternative.course.title}`;
      const alternativeButton = document.createElement("button");
      const alternativePlanned = state.plan.some(
        (item) => item.course.id === stage.alternative.course.id
      );
      alternativeButton.className = "button small";
      alternativeButton.type = "button";
      alternativeButton.disabled = alternativePlanned;
      alternativeButton.textContent = alternativePlanned ? "Added" : "Use alternative";
      alternativeButton.addEventListener(
        "click",
        () => addCourseToPlan(stage.alternative.course)
      );
      alternative.append(alternativeName, alternativeButton);
      course.appendChild(alternative);
    }

    content.append(heading, reason, course);
    row.append(number, content);
    list.appendChild(row);
  });
  elements.pathwayContent.appendChild(list);
}

function renderPlan() {
  clearElement(elements.planList);
  const summary = getPlanSummary();

  if (!state.plan.length) {
    elements.planList.appendChild(
      createMessage("Your plan is empty. Search the catalogue and add a course to begin.")
    );
    renderSummary();
    return;
  }

  state.plan.forEach((item, index) => {
    const allocation = summary.allocations[index];
    const card = document.createElement("article");
    card.className = "plan-card";

    const head = document.createElement("div");
    head.className = "plan-head";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "course-title";
    title.textContent = item.course.title || "Untitled course";
    const provider = document.createElement("p");
    provider.className = "course-provider";
    provider.textContent = item.course.provider_name || "Provider not listed";
    copy.append(title, provider);

    const removeButton = document.createElement("button");
    removeButton.className = "button small danger";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removePlanItem(index));
    head.append(copy, removeButton);

    const controls = document.createElement("div");
    controls.className = "plan-controls";

    const statusField = document.createElement("div");
    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Status";
    const status = document.createElement("select");
    ["Considering", "Planned", "Enrolled", "Completed"].forEach((value) => {
      const option = document.createElement("option");
      option.value = value.toLowerCase();
      option.textContent = value;
      status.appendChild(option);
    });
    status.value = item.status || "planned";
    status.addEventListener("change", async () => {
      item.status = status.value;
      await savePlanner();
      renderPlan();
    });
    statusField.append(statusLabel, status);

    const dateField = document.createElement("div");
    const dateLabel = document.createElement("label");
    dateLabel.textContent = "Target start";
    const startDate = document.createElement("input");
    startDate.type = "date";
    startDate.value = item.plannedStart || "";
    startDate.addEventListener("change", async () => {
      item.plannedStart = startDate.value;
      await savePlanner();
    });
    dateField.append(dateLabel, startDate);

    const creditField = document.createElement("div");
    const creditLabel = document.createElement("label");
    creditLabel.textContent = "Credit requested";
    const credit = document.createElement("input");
    credit.type = "number";
    credit.min = "0";
    credit.max = String(allocation.fee);
    credit.step = "0.01";
    credit.value = String(Math.round(allocation.requested * 100) / 100);
    credit.addEventListener("change", async () => {
      item.creditRequested = clamp(toNumber(credit.value), 0, allocation.fee);
      await savePlanner();
      renderPlan();
    });
    creditField.append(creditLabel, credit);
    controls.append(statusField, dateField, creditField);

    const allocationRow = document.createElement("div");
    allocationRow.className = "allocation";
    [
      ["Estimated fee", formatMoney(allocation.fee)],
      ["Credit used", formatMoney(allocation.creditUsed)],
      ["Cash payable", formatMoney(allocation.cashRequired)]
    ].forEach(([label, value]) => {
      const cell = document.createElement("div");
      const cellLabel = document.createElement("span");
      cellLabel.textContent = label;
      const cellValue = document.createElement("strong");
      cellValue.textContent = value;
      cell.append(cellLabel, cellValue);
      allocationRow.appendChild(cell);
    });

    card.append(head, controls, allocationRow);
    elements.planList.appendChild(card);
  });

  renderSummary();
}

function renderCareerContext() {
  clearElement(elements.jobSelect);
  clearElement(elements.focusSkills);

  if (!state.history.length) {
    const option = document.createElement("option");
    option.textContent = "No analyzed jobs";
    option.value = "";
    elements.jobSelect.appendChild(option);
    elements.jobSelect.disabled = true;
    elements.jobContextMessage.textContent = "Analyze a job with the extension to populate skill-based search shortcuts.";
    return;
  }

  elements.jobSelect.disabled = false;
  state.history.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.title || "Untitled job"}${item.company ? ` - ${item.company}` : ""}`;
    elements.jobSelect.appendChild(option);
  });

  const selected = getSelectedJob();
  state.selectedJobId = selected.id;
  elements.jobSelect.value = selected.id;
  const skills = getFocusSkills(selected);
  elements.jobContextMessage.textContent = skills.length
    ? "Set your current level for each required skill. The target level is Proficient."
    : "This analysis did not contain saved skill matches.";

  skills.forEach((skill) => {
    const row = document.createElement("div");
    row.className = "skill-assessment";

    const name = document.createElement("span");
    name.className = "skill-assessment-name";
    name.textContent = skill;

    const level = document.createElement("select");
    level.setAttribute("aria-label", `Current proficiency in ${skill}`);
    ["No experience", "Beginner", "Working knowledge", "Proficient"].forEach((label, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${index} - ${label}`;
      level.appendChild(option);
    });
    const currentLevel = getSkillLevel(skill);
    level.value = String(currentLevel);

    const gap = document.createElement("span");
    const gapState = getGapLabel(currentLevel);
    gap.className = gapState.className;
    gap.textContent = gapState.text;

    level.addEventListener("change", async () => {
      state.skillLevels[getSkillKey(skill)] = clamp(toNumber(level.value), 0, 3);
      await savePlanner();
      renderCareerContext();
      await Promise.all([loadRecommendations(), loadPathway()]);
    });

    row.append(name, level, gap);
    elements.focusSkills.appendChild(row);
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
  return response.json();
}

async function checkBackend() {
  try {
    await fetchJson(`${state.backendBaseUrl}/health`);
    elements.connectionStatus.className = "connection online";
    elements.connectionText.textContent = "Backend connected";
    return true;
  } catch (error) {
    elements.connectionStatus.className = "connection offline";
    elements.connectionText.textContent = "Backend unavailable";
    return false;
  }
}

async function searchCourses(keyword) {
  const query = normalizeText(keyword);
  clearElement(elements.courseResults);
  elements.courseResults.appendChild(createMessage("Loading courses..."));
  elements.searchButton.disabled = true;

  try {
    if (query) {
      const data = await postJson(
        `${state.backendBaseUrl}/api/recommendations/courses`,
        {
          skills: [query],
          available_credit: state.settings.creditBalance,
          limit: 20
        }
      );
      state.searchResults = Array.isArray(data.recommendations)
        ? data.recommendations.map((recommendation) => ({
            course: recommendation.course,
            recommendation
          }))
        : [];
    } else {
      const data = await fetchJson(`${state.backendBaseUrl}/api/courses`);
      state.searchResults = Array.isArray(data.courses)
        ? data.courses.slice(0, 30).map((course) => ({ course }))
        : [];
    }
    renderCourseResults();
    if (!state.searchResults.length) {
      clearElement(elements.courseResults);
      elements.courseResults.appendChild(createMessage(`No courses found for "${query}".`));
    }
    elements.connectionStatus.className = "connection online";
    elements.connectionText.textContent = "Backend connected";
  } catch (error) {
    state.searchResults = [];
    clearElement(elements.courseResults);
    elements.courseResults.appendChild(
      createMessage(`Could not load courses. Start FastAPI and try again. ${error.message}`, true)
    );
    elements.connectionStatus.className = "connection offline";
    elements.connectionText.textContent = "Backend unavailable";
  } finally {
    elements.searchButton.disabled = false;
  }
}

async function loadRecommendations() {
  clearElement(elements.recommendedCourses);
  const selected = getSelectedJob();
  const gaps = getSkillGaps(selected);
  const skills = gaps.map((item) => item.skill);
  if (!selected || !getFocusSkills(selected).length) {
    state.recommendations = [];
    renderRecommendations();
    return;
  }
  if (!skills.length) {
    state.recommendations = [];
    renderRecommendations();
    return;
  }

  elements.recommendedCourses.appendChild(createMessage("Ranking courses for this job..."));
  elements.refreshRecommendations.disabled = true;
  const requestId = ++state.recommendationRequestId;
  try {
    const data = await postJson(
      `${state.backendBaseUrl}/api/recommendations/courses`,
      {
        skills,
        available_credit: state.settings.creditBalance,
        limit: 8
      }
    );
    if (requestId !== state.recommendationRequestId) return;
    state.recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
    renderRecommendations();
  } catch (error) {
    if (requestId !== state.recommendationRequestId) return;
    state.recommendations = [];
    clearElement(elements.recommendedCourses);
    elements.recommendedCourses.appendChild(
      createMessage(`Could not load recommendations. ${error.message}`, true)
    );
  } finally {
    if (requestId === state.recommendationRequestId) {
      elements.refreshRecommendations.disabled = false;
    }
  }
}

async function loadPathway() {
  clearElement(elements.pathwayContent);
  const gaps = getSkillGaps();
  if (!getSelectedJob() || !getFocusSkills(getSelectedJob()).length) {
    state.pathway = null;
    renderPathway();
    return;
  }
  if (!gaps.length) {
    state.pathway = null;
    renderPathway();
    return;
  }

  elements.pathwayContent.appendChild(createMessage("Building your three-stage pathway..."));
  elements.refreshPathway.disabled = true;
  const requestId = ++state.pathwayRequestId;
  try {
    const data = await postJson(
      `${state.backendBaseUrl}/api/recommendations/learning-pathway`,
      {
        skill_gaps: gaps.map((item) => ({
          skill: item.skill,
          current_level: item.currentLevel
        })),
        available_credit: state.settings.creditBalance,
        monthly_hours: state.settings.monthlyHours
      }
    );
    if (requestId !== state.pathwayRequestId) return;
    state.pathway = data;
    renderPathway();
  } catch (error) {
    if (requestId !== state.pathwayRequestId) return;
    state.pathway = null;
    clearElement(elements.pathwayContent);
    elements.pathwayContent.appendChild(
      createMessage(`Could not build the pathway. ${error.message}`, true)
    );
  } finally {
    if (requestId === state.pathwayRequestId) {
      elements.refreshPathway.disabled = false;
    }
  }
}

async function addCourseToPlan(course) {
  if (state.plan.some((item) => item.course.id === course.id)) return;

  let detailedCourse = course;
  try {
    const data = await fetchJson(`${state.backendBaseUrl}/api/courses/${course.id}`);
    if (data && data.course) detailedCourse = data.course;
  } catch (error) {
    detailedCourse = course;
  }

  state.plan.push({
    course: detailedCourse,
    status: "planned",
    plannedStart: "",
    creditRequested: getCourseFee(detailedCourse)
  });
  await savePlanner();
  renderCourseResults();
  renderRecommendations();
  renderPlan();
  renderPathway();
}

async function removePlanItem(index) {
  state.plan.splice(index, 1);
  await savePlanner();
  renderCourseResults();
  renderRecommendations();
  renderPlan();
  renderPathway();
}

async function loadDashboard() {
  const stored = await storageGet([
    "backendUrl",
    HISTORY_STORAGE_KEY,
    PLANNER_STORAGE_KEY
  ]);
  state.backendBaseUrl = deriveBackendBase(stored.backendUrl || DEFAULT_BACKEND_URL);
  state.history = Array.isArray(stored[HISTORY_STORAGE_KEY])
    ? stored[HISTORY_STORAGE_KEY]
    : [];

  const planner = stored[PLANNER_STORAGE_KEY] || {};
  if (planner.settings) {
    state.settings.creditBalance = Math.max(toNumber(planner.settings.creditBalance, 500), 0);
    state.settings.monthlyHours = Math.max(toNumber(planner.settings.monthlyHours, 20), 1);
  }
  state.plan = Array.isArray(planner.plan) ? planner.plan : [];
  state.skillLevels = planner.skillLevels && typeof planner.skillLevels === "object"
    ? planner.skillLevels
    : {};

  elements.creditBalance.value = String(state.settings.creditBalance);
  elements.monthlyHours.value = String(state.settings.monthlyHours);
  renderSummary();
  renderPlan();
  renderCourseResults();
  renderCareerContext();
  renderRecommendations();
  renderPathway();
  const backendOnline = await checkBackend();
  if (backendOnline) {
    await Promise.all([loadRecommendations(), loadPathway()]);
  }
}

elements.creditBalance.addEventListener("input", async () => {
  state.settings.creditBalance = Math.max(toNumber(elements.creditBalance.value), 0);
  await savePlanner();
  renderPlan();
});
elements.creditBalance.addEventListener("change", loadPathway);

elements.monthlyHours.addEventListener("input", async () => {
  state.settings.monthlyHours = Math.max(toNumber(elements.monthlyHours.value, 1), 1);
  await savePlanner();
  renderSummary();
});
elements.monthlyHours.addEventListener("change", loadPathway);

elements.courseSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchCourses(elements.courseSearch.value);
});

elements.jobSelect.addEventListener("change", () => {
  state.selectedJobId = elements.jobSelect.value;
  renderCareerContext();
  loadRecommendations();
  loadPathway();
});

elements.refreshRecommendations.addEventListener("click", loadRecommendations);
elements.refreshPathway.addEventListener("click", loadPathway);

elements.clearPlan.addEventListener("click", async () => {
  if (!state.plan.length) return;
  const confirmed = window.confirm("Remove every course from your learning plan?");
  if (!confirmed) return;
  state.plan = [];
  await savePlanner();
  renderCourseResults();
  renderPlan();
  renderPathway();
});

document.addEventListener("DOMContentLoaded", loadDashboard);
