const HISTORY_STORAGE_KEY = "skillsfuture_analysis_history";
const PLANNER_STORAGE_KEY = "skillsfuture_course_planner";
const DEFAULT_BACKEND_URL = "http://localhost:8000/analyze-job";
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_TIMEOUT_SECONDS = 45;

const state = {
  backendBaseUrl: "http://localhost:8000",
  history: [],
  selectedJobId: "",
  settings: {
    creditBalance: 500,
    monthlyHours: 20
  },
  network: {
    apiAccessToken: "",
    retries: DEFAULT_RETRY_COUNT,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS
  },
  plan: [],
  comparison: [],
  feedback: {},
  pathwayOrder: {},
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
  retryConnection: document.getElementById("retryConnection"),
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
  generateNarrative: document.getElementById("generateNarrative"),
  jobSelect: document.getElementById("jobSelect"),
  jobContextMessage: document.getElementById("jobContextMessage"),
  focusSkills: document.getElementById("focusSkills"),
  planList: document.getElementById("planList"),
  clearPlan: document.getElementById("clearPlan"),
  comparisonPanel: document.getElementById("comparisonPanel"),
  comparisonContent: document.getElementById("comparisonContent"),
  clearComparison: document.getElementById("clearComparison"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  exportCalendar: document.getElementById("exportCalendar"),
  printPlan: document.getElementById("printPlan")
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

function getUpcomingRuns(course) {
  const runs = Array.isArray(course && course.runs)
    ? course.runs
    : (Array.isArray(course && course.upcoming_runs) ? course.upcoming_runs : []);
  const today = new Date().toISOString().slice(0, 10);
  return runs
    .filter((run) => !run.start_date || run.start_date >= today)
    .sort((left, right) => String(left.start_date || "").localeCompare(String(right.start_date || "")))
    .slice(0, 10);
}

function formatDate(value) {
  if (!value) return "Date not listed";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function getSelectedRun(item) {
  const runs = getUpcomingRuns(item.course);
  return runs.find((run) => String(run.id) === String(item.selectedRunId)) || runs[0] || null;
}

function getPlanDateRange(item) {
  const run = getSelectedRun(item);
  const start = run && run.start_date ? run.start_date : item.plannedStart;
  const end = run && run.end_date ? run.end_date : start;
  return start ? { start: String(start).slice(0, 10), end: String(end || start).slice(0, 10) } : null;
}

function getScheduleConflicts() {
  const conflicts = new Map();
  state.plan.forEach((left, leftIndex) => {
    const leftRange = getPlanDateRange(left);
    if (!leftRange) return;
    state.plan.slice(leftIndex + 1).forEach((right, offset) => {
      const rightIndex = leftIndex + offset + 1;
      const rightRange = getPlanDateRange(right);
      if (!rightRange) return;
      if (leftRange.start <= rightRange.end && rightRange.start <= leftRange.end) {
        conflicts.set(leftIndex, right.course.title);
        conflicts.set(rightIndex, left.course.title);
      }
    });
  });
  return conflicts;
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

function getFocusSkillItems(item) {
  const results = Array.isArray(item && item.data && item.data.results) ? item.data.results : [];
  const items = results
    .map((result) => {
      const match = getTopMatch(result);
      const skill = normalizeText(match && match.official_skill_title) || normalizeText(result.extracted_skill);
      return {
        skill,
        jobSkill: normalizeText(result.extracted_skill),
        sourceEvidence: normalizeText(result.source_evidence)
      };
    })
    .filter((item) => item.skill);
  return items
    .filter((item, index, all) => (
      all.findIndex((candidate) => getSkillKey(candidate.skill) === getSkillKey(item.skill)) === index
    ))
    .slice(0, 10);
}

function getFocusSkills(item) {
  return getFocusSkillItems(item).map((item) => item.skill);
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
  return getFocusSkillItems(item)
    .map((skillItem) => {
      const currentLevel = getSkillLevel(skillItem.skill);
      return {
        skill: skillItem.skill,
        jobSkill: skillItem.jobSkill,
        sourceEvidence: skillItem.sourceEvidence,
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
      comparison: state.comparison,
      feedback: state.feedback,
      pathwayOrder: state.pathwayOrder,
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
  elements.exportCalendar.disabled = state.plan.length === 0;
  elements.printPlan.disabled = state.plan.length === 0;
  const completed = state.plan.filter((item) => item.status === "completed").length;
  const progress = state.plan.length ? Math.round((completed / state.plan.length) * 100) : 0;
  elements.progressFill.style.width = `${progress}%`;
  elements.progressText.textContent = state.plan.length
    ? `${completed} of ${state.plan.length} courses completed (${progress}%)`
    : "No courses planned";
}

async function loadCourseDetails(course) {
  if (Array.isArray(course.runs)) return course;
  try {
    const data = await fetchJson(`${state.backendBaseUrl}/api/courses/${course.id}`);
    return data && data.course ? data.course : course;
  } catch (error) {
    return course;
  }
}

async function toggleComparison(course) {
  const existingIndex = state.comparison.findIndex((item) => item.id === course.id);
  if (existingIndex >= 0) {
    state.comparison.splice(existingIndex, 1);
  } else {
    if (state.comparison.length >= 3) state.comparison.shift();
    state.comparison.push(await loadCourseDetails(course));
  }
  await savePlanner();
  renderComparison();
  renderCourseResults();
  renderRecommendations();
}

function renderComparison() {
  clearElement(elements.comparisonContent);
  elements.comparisonPanel.hidden = state.comparison.length === 0;
  if (!state.comparison.length) return;

  const table = document.createElement("table");
  table.className = "comparison-table";
  const caption = document.createElement("caption");
  caption.className = "visually-hidden";
  caption.textContent = "Comparison of selected SkillsFuture courses";
  table.appendChild(caption);

  const body = document.createElement("tbody");
  const rows = [
    ["Course", (course) => course.title || "Untitled course"],
    ["Provider", (course) => course.provider_name || "Not listed"],
    ["Estimated fee", (course) => formatMoney(getCourseFee(course))],
    ["Duration", (course) => `${getCourseHours(course) || 0} hours`],
    ["Delivery", (course) => getDeliveryLabel(course) || "Not listed"],
    ["Next run", (course) => formatDate(getUpcomingRuns(course)[0]?.start_date)]
  ];
  rows.forEach(([label, value]) => {
    const row = document.createElement("tr");
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = label;
    row.appendChild(heading);
    state.comparison.forEach((course) => {
      const cell = document.createElement("td");
      cell.textContent = value(course);
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  table.appendChild(body);
  elements.comparisonContent.appendChild(table);
}

async function submitFeedback(courseId, feedbackType) {
  const key = String(courseId);
  try {
    await postJson(`${state.backendBaseUrl}/api/recommendations/feedback`, {
      course_id: courseId,
      feedback_type: feedbackType
    });
    state.feedback[key] = feedbackType;
    await savePlanner();
    renderRecommendations();
  } catch (error) {
    state.feedback[key] = "error";
    renderRecommendations();
  }
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

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const compareButton = document.createElement("button");
    const compared = state.comparison.some((item) => item.id === course.id);
    compareButton.className = compared ? "button small active" : "button small";
    compareButton.type = "button";
    compareButton.textContent = compared ? "Comparing" : "Compare";
    compareButton.setAttribute("aria-pressed", String(compared));
    compareButton.addEventListener("click", () => toggleComparison(course));

    const addButton = document.createElement("button");
    const alreadyPlanned = state.plan.some((item) => item.course.id === course.id);
    addButton.className = "button small primary";
    addButton.type = "button";
    addButton.disabled = alreadyPlanned;
    addButton.textContent = alreadyPlanned ? "Added" : "Add to plan";
    addButton.addEventListener("click", () => addCourseToPlan(course));
    actions.append(compareButton, addButton);
    head.append(copy, actions);

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

    const nextRun = getUpcomingRuns(course)[0];
    if (nextRun) {
      const runNote = document.createElement("p");
      runNote.className = "run-note";
      runNote.textContent = `Next run: ${formatDate(nextRun.start_date)}${nextRun.delivery_mode ? `, ${nextRun.delivery_mode}` : ""}`;
      card.appendChild(runNote);
    }

    if (recommendation && recommendation.explanation) {
      const reason = document.createElement("p");
      reason.className = "recommendation-reason";
      reason.textContent = recommendation.explanation;
      card.appendChild(reason);

      const feedback = document.createElement("div");
      feedback.className = "feedback-actions";
      const currentFeedback = state.feedback[String(course.id)];
      ["relevant", "not_relevant"].forEach((type) => {
        const button = document.createElement("button");
        button.className = currentFeedback === type ? "button small active" : "button small";
        button.type = "button";
        button.textContent = type === "relevant" ? "Relevant" : "Not relevant";
        button.setAttribute("aria-pressed", String(currentFeedback === type));
        button.addEventListener("click", () => submitFeedback(course.id, type));
        feedback.appendChild(button);
      });
      card.appendChild(feedback);
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

function getPathwayOrderKey() {
  return state.selectedJobId || "default";
}

function getOrderedPathwayStages() {
  const stages = Array.isArray(state.pathway && state.pathway.stages)
    ? state.pathway.stages
    : [];
  const savedOrder = state.pathwayOrder[getPathwayOrderKey()] || [];
  const rank = new Map(savedOrder.map((courseId, index) => [Number(courseId), index]));
  return [...stages].sort((left, right) => {
    const leftRank = rank.has(Number(left.course.id)) ? rank.get(Number(left.course.id)) : left.stage + 100;
    const rightRank = rank.has(Number(right.course.id)) ? rank.get(Number(right.course.id)) : right.stage + 100;
    return leftRank - rightRank;
  });
}

async function movePathwayStage(courseId, direction) {
  const stages = getOrderedPathwayStages();
  const ids = stages.map((stage) => Number(stage.course.id));
  const index = ids.indexOf(Number(courseId));
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  state.pathwayOrder[getPathwayOrderKey()] = ids;
  await savePlanner();
  renderPathway();
}

function renderPathway() {
  clearElement(elements.pathwayContent);
  const gaps = getSkillGaps();
  const stages = getOrderedPathwayStages();

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

  const narrative = state.pathway.narrative;
  const guidanceByCourse = new Map(
    (narrative && Array.isArray(narrative.stage_guidance) ? narrative.stage_guidance : [])
      .map((item) => [Number(item.course_id), item])
  );
  if (narrative) {
    const narrativePanel = document.createElement("section");
    narrativePanel.className = "narrative-panel";
    const source = document.createElement("span");
    source.className = "narrative-source";
    source.textContent = narrative.source === "llm" ? "Grounded AI plan" : "Verified fallback plan";
    const overview = document.createElement("p");
    overview.textContent = narrative.overview;
    narrativePanel.append(source, overview);

    if (Array.isArray(narrative.priority_summary) && narrative.priority_summary.length) {
      const priorities = document.createElement("ul");
      priorities.className = "narrative-priorities";
      narrative.priority_summary.forEach((item) => {
        const priority = document.createElement("li");
        priority.textContent = item;
        priorities.appendChild(priority);
      });
      narrativePanel.appendChild(priorities);
    }
    if (narrative.next_step) {
      const nextStep = document.createElement("p");
      const nextStepLabel = document.createElement("strong");
      nextStepLabel.textContent = "Next step: ";
      nextStep.append(nextStepLabel, narrative.next_step);
      narrativePanel.appendChild(nextStep);
    }
    elements.pathwayContent.appendChild(narrativePanel);
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
  stages.forEach((stage, stageIndex) => {
    const narrativeStage = guidanceByCourse.get(Number(stage.course.id));
    const row = document.createElement("article");
    row.className = "pathway-stage";
    const number = document.createElement("span");
    number.className = "pathway-number";
    number.textContent = String(stageIndex + 1);

    const content = document.createElement("div");
    const stageHeader = document.createElement("div");
    stageHeader.className = "pathway-stage-header";
    const heading = document.createElement("h3");
    heading.textContent = `${stage.stage_label}: ${stage.title}`;
    const orderActions = document.createElement("div");
    orderActions.className = "pathway-order-actions";
    const upButton = document.createElement("button");
    upButton.className = "button small";
    upButton.type = "button";
    upButton.textContent = "Move up";
    upButton.disabled = stageIndex === 0;
    upButton.setAttribute("aria-label", `Move ${stage.course.title} earlier`);
    upButton.addEventListener("click", () => movePathwayStage(stage.course.id, -1));
    const downButton = document.createElement("button");
    downButton.className = "button small";
    downButton.type = "button";
    downButton.textContent = "Move down";
    downButton.disabled = stageIndex === stages.length - 1;
    downButton.setAttribute("aria-label", `Move ${stage.course.title} later`);
    downButton.addEventListener("click", () => movePathwayStage(stage.course.id, 1));
    orderActions.append(upButton, downButton);
    stageHeader.append(heading, orderActions);
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
    if (narrativeStage && narrativeStage.guidance) {
      const guidance = document.createElement("p");
      guidance.className = "pathway-guidance";
      guidance.textContent = narrativeStage.guidance;
      course.appendChild(guidance);
    }
    const action = document.createElement("p");
    const actionLabel = document.createElement("strong");
    actionLabel.textContent = "Action: ";
    action.append(actionLabel, narrativeStage && narrativeStage.action
      ? narrativeStage.action
      : stage.practical_action);
    const outcome = document.createElement("p");
    outcome.className = "pathway-outcome";
    const outcomeLabel = document.createElement("strong");
    outcomeLabel.textContent = "Outcome: ";
    outcome.append(outcomeLabel, narrativeStage && narrativeStage.outcome
      ? narrativeStage.outcome
      : stage.measurable_outcome);

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

    course.prepend(courseHead, rationale);
    course.append(action, outcome, meta);
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

    content.append(stageHeader, reason, course);
    row.append(number, content);
    list.appendChild(row);
  });
  elements.pathwayContent.appendChild(list);
}

function renderPlan() {
  clearElement(elements.planList);
  const summary = getPlanSummary();
  const conflicts = getScheduleConflicts();

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

    const runs = getUpcomingRuns(item.course);
    const runField = document.createElement("div");
    const runLabel = document.createElement("label");
    runLabel.textContent = "Course run";
    const runSelect = document.createElement("select");
    const noRunOption = document.createElement("option");
    noRunOption.value = "";
    noRunOption.textContent = runs.length ? "Choose a run" : "No upcoming run listed";
    runSelect.appendChild(noRunOption);
    runs.forEach((run) => {
      const option = document.createElement("option");
      option.value = String(run.id);
      option.textContent = `${formatDate(run.start_date)}${run.delivery_mode ? ` - ${run.delivery_mode}` : ""}`;
      runSelect.appendChild(option);
    });
    runSelect.value = item.selectedRunId ? String(item.selectedRunId) : "";
    runSelect.disabled = runs.length === 0;
    runSelect.addEventListener("change", async () => {
      item.selectedRunId = runSelect.value;
      const selectedRun = getSelectedRun(item);
      if (selectedRun && selectedRun.start_date) item.plannedStart = selectedRun.start_date;
      await savePlanner();
      renderPlan();
    });
    runField.append(runLabel, runSelect);

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
    controls.append(statusField, runField, dateField, creditField);

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
    if (conflicts.has(index)) {
      const warning = document.createElement("p");
      warning.className = "conflict-warning";
      warning.setAttribute("role", "alert");
      warning.textContent = `Schedule conflict with ${conflicts.get(index)}. Select another run or change the target date.`;
      card.appendChild(warning);
    }
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

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function requestJson(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= state.network.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      state.network.timeoutSeconds * 1000
    );
    try {
      const headers = {
        ...(options.headers || {}),
        ...(state.network.apiAccessToken
          ? { Authorization: `Bearer ${state.network.apiAccessToken}` }
          : {})
      };
      const response = await fetch(url, { ...options, headers, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.detail || `Backend returned HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      lastError = error.name === "AbortError"
        ? new Error(`Request timed out after ${state.network.timeoutSeconds} seconds`)
        : error;
      const retryable = !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
      if (attempt < state.network.retries && retryable) {
        await wait(500 * (attempt + 1));
        continue;
      }
      break;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  return requestJson(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
}

async function postJson(url, body) {
  return requestJson(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function checkBackend() {
  try {
    await fetchJson(`${state.backendBaseUrl}/health`);
    elements.connectionStatus.className = "connection online";
    elements.connectionText.textContent = "Backend connected";
    elements.retryConnection.hidden = true;
    return true;
  } catch (error) {
    elements.connectionStatus.className = "connection offline";
    elements.connectionText.textContent = `Backend unavailable: ${error.message}`;
    elements.retryConnection.hidden = false;
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
    elements.retryConnection.hidden = true;
  } catch (error) {
    state.searchResults = [];
    clearElement(elements.courseResults);
    elements.courseResults.appendChild(
      createMessage(`Could not load courses. Start FastAPI and try again. ${error.message}`, true)
    );
    elements.connectionStatus.className = "connection offline";
    elements.connectionText.textContent = "Backend unavailable";
    elements.retryConnection.hidden = false;
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

async function loadPathway(includeNarrative = false) {
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
  elements.generateNarrative.disabled = true;
  const requestId = ++state.pathwayRequestId;
  try {
    const data = await postJson(
      `${state.backendBaseUrl}/api/recommendations/learning-pathway`,
      {
        skill_gaps: gaps.map((item) => ({
          skill: item.skill,
          current_level: item.currentLevel,
          job_skill: item.jobSkill,
          source_evidence: item.sourceEvidence
        })),
        available_credit: state.settings.creditBalance,
        monthly_hours: state.settings.monthlyHours,
        target_role: getSelectedJob().title || "",
        include_narrative: includeNarrative
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
      elements.generateNarrative.disabled = false;
    }
  }
}

async function addCourseToPlan(course) {
  if (state.plan.some((item) => item.course.id === course.id)) return;

  let detailedCourse = course;
  detailedCourse = await loadCourseDetails(course);
  const firstRun = getUpcomingRuns(detailedCourse)[0];

  state.plan.push({
    course: detailedCourse,
    status: "planned",
    plannedStart: firstRun?.start_date || "",
    selectedRunId: firstRun?.id ? String(firstRun.id) : "",
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

function escapeCalendarText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function calendarDate(value, addDay = false) {
  const date = new Date(`${value}T00:00:00`);
  if (addDay) date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function exportPlanCalendar() {
  const events = state.plan.flatMap((item, index) => {
    const range = getPlanDateRange(item);
    if (!range) return [];
    const run = getSelectedRun(item);
    return [
      "BEGIN:VEVENT",
      `UID:skillsfuture-${item.course.id}-${index}@local`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
      `DTSTART;VALUE=DATE:${calendarDate(range.start)}`,
      `DTEND;VALUE=DATE:${calendarDate(range.end, true)}`,
      `SUMMARY:${escapeCalendarText(item.course.title)}`,
      `LOCATION:${escapeCalendarText(run?.venue || "")}`,
      `DESCRIPTION:${escapeCalendarText(`Status: ${item.status || "planned"}. Verify course dates with the provider.`)}`,
      "END:VEVENT"
    ];
  });
  if (!events.length) {
    window.alert("Add a target start date or select a course run before exporting.");
    return;
  }
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SkillsFuture Course Planner//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR"
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "skillsfuture-learning-plan.ics";
  link.click();
  URL.revokeObjectURL(url);
}

async function loadDashboard() {
  const stored = await storageGet([
    "backendUrl",
    "apiAccessToken",
    "retryCount",
    "timeoutSeconds",
    HISTORY_STORAGE_KEY,
    PLANNER_STORAGE_KEY
  ]);
  state.backendBaseUrl = deriveBackendBase(stored.backendUrl || DEFAULT_BACKEND_URL);
  state.network.apiAccessToken = String(stored.apiAccessToken || "");
  state.network.retries = clamp(toNumber(stored.retryCount, DEFAULT_RETRY_COUNT), 0, 3);
  state.network.timeoutSeconds = clamp(
    toNumber(stored.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
    5,
    120
  );
  state.history = Array.isArray(stored[HISTORY_STORAGE_KEY])
    ? stored[HISTORY_STORAGE_KEY]
    : [];

  const planner = stored[PLANNER_STORAGE_KEY] || {};
  if (planner.settings) {
    state.settings.creditBalance = Math.max(toNumber(planner.settings.creditBalance, 500), 0);
    state.settings.monthlyHours = Math.max(toNumber(planner.settings.monthlyHours, 20), 1);
  }
  state.plan = Array.isArray(planner.plan) ? planner.plan : [];
  state.comparison = Array.isArray(planner.comparison) ? planner.comparison.slice(0, 3) : [];
  state.feedback = planner.feedback && typeof planner.feedback === "object" ? planner.feedback : {};
  state.pathwayOrder = planner.pathwayOrder && typeof planner.pathwayOrder === "object"
    ? planner.pathwayOrder
    : {};
  state.skillLevels = planner.skillLevels && typeof planner.skillLevels === "object"
    ? planner.skillLevels
    : {};

  elements.creditBalance.value = String(state.settings.creditBalance);
  elements.monthlyHours.value = String(state.settings.monthlyHours);
  renderSummary();
  renderPlan();
  renderComparison();
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
elements.creditBalance.addEventListener("change", () => loadPathway(false));

elements.monthlyHours.addEventListener("input", async () => {
  state.settings.monthlyHours = Math.max(toNumber(elements.monthlyHours.value, 1), 1);
  await savePlanner();
  renderSummary();
});
elements.monthlyHours.addEventListener("change", () => loadPathway(false));

elements.courseSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchCourses(elements.courseSearch.value);
});

elements.jobSelect.addEventListener("change", () => {
  state.selectedJobId = elements.jobSelect.value;
  renderCareerContext();
  loadRecommendations();
  loadPathway(false);
});

elements.refreshRecommendations.addEventListener("click", loadRecommendations);
elements.refreshPathway.addEventListener("click", () => loadPathway(false));
elements.generateNarrative.addEventListener("click", () => loadPathway(true));
elements.clearComparison.addEventListener("click", async () => {
  state.comparison = [];
  await savePlanner();
  renderComparison();
  renderCourseResults();
  renderRecommendations();
});
elements.exportCalendar.addEventListener("click", exportPlanCalendar);
elements.printPlan.addEventListener("click", () => window.print());
elements.retryConnection.addEventListener("click", async () => {
  elements.retryConnection.disabled = true;
  elements.connectionText.textContent = "Checking backend";
  const online = await checkBackend();
  if (online) await Promise.all([loadRecommendations(), loadPathway(false)]);
  elements.retryConnection.disabled = false;
});

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
