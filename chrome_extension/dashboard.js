const HISTORY_STORAGE_KEY = "skillsfuture_analysis_history";

const state = {
  history: [],
  selectedId: ""
};

const elements = {
  toolbar: document.getElementById("toolbar"),
  jobSelect: document.getElementById("jobSelect"),
  openJob: document.getElementById("openJob"),
  refresh: document.getElementById("refresh"),
  emptyState: document.getElementById("emptyState"),
  dashboard: document.getElementById("dashboard"),
  jobMeta: document.getElementById("jobMeta"),
  scoreMetric: document.getElementById("scoreMetric"),
  skillMetric: document.getElementById("skillMetric"),
  historyMetric: document.getElementById("historyMetric"),
  careerRoute: document.getElementById("careerRoute"),
  focusSkills: document.getElementById("focusSkills"),
  skillList: document.getElementById("skillList")
};

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch (error) {
    return "Unknown date";
  }
}

function getScoreClass(score) {
  if (typeof score !== "number") return "score";
  if (score >= 0.6) return "score high";
  if (score >= 0.4) return "score medium";
  return "score low";
}

function getScoreText(score) {
  if (typeof score !== "number") return "Unscored";
  if (score >= 0.6) return `Strong match - ${Math.round(score * 100)}%`;
  if (score >= 0.4) return `Partial match - ${Math.round(score * 100)}%`;
  return `Needs checking - ${Math.round(score * 100)}%`;
}

async function getAnalysisHistory() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const value = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
    return Array.isArray(value[HISTORY_STORAGE_KEY]) ? value[HISTORY_STORAGE_KEY] : [];
  }

  try {
    const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
}

function getResults(item) {
  return Array.isArray(item && item.data && item.data.results) ? item.data.results : [];
}

function getTopMatch(result) {
  const matches = Array.isArray(result && result.top_matches) ? result.top_matches : [];
  return matches[0] || null;
}

function getAverageConfidence(results) {
  const scores = results
    .map((result) => getTopMatch(result))
    .map((match) => match && match.similarity_score)
    .filter((score) => typeof score === "number");

  if (!scores.length) return null;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function getFocusSkills(results) {
  const lowerConfidence = results
    .filter((result) => {
      const match = getTopMatch(result);
      return !match || typeof match.similarity_score !== "number" || match.similarity_score < 0.6;
    })
    .map((result) => normalizeText(result.extracted_skill))
    .filter(Boolean);

  if (lowerConfidence.length) return lowerConfidence.slice(0, 8);

  return results
    .map((result) => normalizeText(result.extracted_skill))
    .filter(Boolean)
    .slice(0, 8);
}

function clearElement(element) {
  while (element.firstChild) element.firstChild.remove();
}

function renderJobSelect() {
  clearElement(elements.jobSelect);

  state.history.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    const company = item.company ? `, ${item.company}` : "";
    option.textContent = `${item.title || "Untitled job"}${company} - ${formatDate(item.analyzedAt)}`;
    elements.jobSelect.appendChild(option);
  });

  elements.jobSelect.value = state.selectedId;
}

function renderRoute(item, results) {
  clearElement(elements.careerRoute);

  const focusSkills = getFocusSkills(results);
  const topSkills = results
    .map((result) => normalizeText(result.extracted_skill))
    .filter(Boolean)
    .slice(0, 4);

  const steps = [
    {
      title: item.title || "Current job target",
      body: item.company
        ? `This route starts from the analyzed role at ${item.company}.`
        : "This route starts from the analyzed job post."
    },
    {
      title: "Core skills from the role",
      body: topSkills.length
        ? `Build evidence around ${topSkills.join(", ")}.`
        : "Review the extracted job skills and choose the ones that appear most important."
    },
    {
      title: "Skills to strengthen next",
      body: focusSkills.length
        ? `Focus on ${focusSkills.slice(0, 4).join(", ")} first.`
        : "No weak matches were found. Keep comparing similar jobs to spot repeated requirements."
    },
    {
      title: "Next career move",
      body: "Compare two or three similar job posts. Skills that repeat across them are stronger signals for your next learning plan."
    }
  ];

  steps.forEach((step, index) => {
    const row = document.createElement("div");
    row.className = "route-step";

    const number = document.createElement("span");
    number.className = "route-number";
    number.textContent = String(index + 1);

    const copy = document.createElement("div");
    copy.className = "route-copy";

    const title = document.createElement("h3");
    title.textContent = step.title;

    const body = document.createElement("p");
    body.textContent = step.body;

    copy.append(title, body);
    row.append(number, copy);
    elements.careerRoute.appendChild(row);
  });
}

function renderFocusSkills(results) {
  clearElement(elements.focusSkills);
  const skills = getFocusSkills(results);

  if (!skills.length) {
    const item = document.createElement("li");
    item.className = "chip";
    item.textContent = "Analyze more jobs to find focus areas";
    elements.focusSkills.appendChild(item);
    return;
  }

  skills.forEach((skill) => {
    const item = document.createElement("li");
    item.className = "chip";
    item.textContent = skill;
    elements.focusSkills.appendChild(item);
  });
}

function renderSkills(results) {
  clearElement(elements.skillList);

  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "skill-detail";
    empty.textContent = "No saved skill results were found for this job.";
    elements.skillList.appendChild(empty);
    return;
  }

  results.slice(0, 8).forEach((result) => {
    const match = getTopMatch(result);
    const card = document.createElement("article");
    card.className = "skill-card";

    const main = document.createElement("div");
    main.className = "skill-main";

    const skillName = document.createElement("p");
    skillName.className = "skill-name";
    skillName.textContent = result.extracted_skill || "Job skill";

    const matchName = document.createElement("p");
    matchName.className = "match-name";
    matchName.textContent = match && match.official_skill_title
      ? match.official_skill_title
      : "No SkillsFuture match returned";

    const meta = document.createElement("div");
    meta.className = "meta";
    const score = document.createElement("span");
    score.className = getScoreClass(match && match.similarity_score);
    score.textContent = getScoreText(match && match.similarity_score);
    meta.appendChild(score);

    main.append(skillName, matchName, meta);
    card.appendChild(main);

    const definition = document.createElement("p");
    definition.className = "skill-detail";
    const definitionLabel = document.createElement("strong");
    definitionLabel.textContent = "What it means: ";
    definition.append(
      definitionLabel,
      match && match.official_skill_description
        ? match.official_skill_description
        : "No official definition returned."
    );
    card.appendChild(definition);

    if (result.source_evidence) {
      const evidence = document.createElement("p");
      evidence.className = "skill-detail";
      const evidenceLabel = document.createElement("strong");
      evidenceLabel.textContent = "Found in the job post: ";
      evidence.append(evidenceLabel, result.source_evidence);
      card.appendChild(evidence);
    }

    elements.skillList.appendChild(card);
  });
}

function renderDashboard() {
  const item = state.history.find((entry) => entry.id === state.selectedId) || state.history[0];

  if (!item) {
    elements.toolbar.hidden = true;
    elements.dashboard.hidden = true;
    elements.emptyState.hidden = false;
    return;
  }

  state.selectedId = item.id;
  const results = getResults(item);
  const averageConfidence = getAverageConfidence(results);

  elements.toolbar.hidden = false;
  elements.dashboard.hidden = false;
  elements.emptyState.hidden = true;

  renderJobSelect();

  const company = item.company ? `${item.company} · ` : "";
  elements.jobMeta.textContent = `${company}${formatDate(item.analyzedAt)}`;
  elements.scoreMetric.textContent = typeof item.suitabilityScore === "number"
    ? `${item.suitabilityScore}%`
    : averageConfidence === null
      ? "-"
      : `${Math.round(averageConfidence * 100)}%`;
  elements.skillMetric.textContent = String(results.length);
  elements.historyMetric.textContent = String(state.history.length);
  elements.openJob.disabled = !item.url;

  renderRoute(item, results);
  renderFocusSkills(results);
  renderSkills(results);
}

async function loadDashboard() {
  state.history = await getAnalysisHistory();
  if (!state.selectedId && state.history[0]) {
    state.selectedId = state.history[0].id;
  }
  renderDashboard();
}

elements.jobSelect.addEventListener("change", () => {
  state.selectedId = elements.jobSelect.value;
  renderDashboard();
});

elements.openJob.addEventListener("click", () => {
  const item = state.history.find((entry) => entry.id === state.selectedId);
  if (item && item.url) window.open(item.url, "_blank", "noopener");
});

elements.refresh.addEventListener("click", loadDashboard);
document.addEventListener("DOMContentLoaded", loadDashboard);
