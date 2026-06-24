const fs = require("fs");
const os = require("os");
const path = require("path");

const DEBUG_URL = "http://127.0.0.1:9222";
const TEST_URL = "http://127.0.0.1:8765/test_page.html";
const VALIDATION_LOG = path.join(__dirname, "extension_validation_log.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const callbacks = new Map();
    const listeners = new Map();
    let nextId = 1;

    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => {
            callbacks.set(id, { res, rej });
          });
        },
        on(method, handler) {
          if (!listeners.has(method)) listeners.set(method, []);
          listeners.get(method).push(handler);
        },
        close() {
          ws.close();
        }
      });
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && callbacks.has(message.id)) {
        const callback = callbacks.get(message.id);
        callbacks.delete(message.id);
        if (message.error) callback.rej(new Error(message.error.message));
        else callback.res(message.result);
        return;
      }

      for (const handler of listeners.get(message.method) || []) {
        handler(message.params || {});
      }
    });

    ws.addEventListener("error", reject);
  });
}

async function waitForExpression(client, expression, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    if (result.result && result.result.value) return result.result.value;
    await sleep(500);
  }

  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function waitForTarget(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const targets = await waitForJson(`${DEBUG_URL}/json`, 5000);
    const target = targets.find(predicate);
    if (target) return target;
    await sleep(500);
  }

  throw new Error("Timed out waiting for browser target");
}

async function main() {
  const version = await waitForJson(`${DEBUG_URL}/json/version`, 30000);
  const targets = await waitForJson(`${DEBUG_URL}/json`, 30000);
  const page = targets.find((target) => target.type === "page") || targets[0];
  if (!page) throw new Error("No debuggable page target found");

  const client = await connect(page.webSocketDebuggerUrl || version.webSocketDebuggerUrl);
  const network = {
    requestPayload: null,
    responseStatus: null,
    responseRequestId: null
  };
  const consoleLogs = [];

  client.on("Network.requestWillBeSent", (params) => {
    if (params.request && params.request.url.includes("/analyze-job")) {
      network.requestPayload = params.request.postData || null;
    }
  });

  client.on("Network.responseReceived", (params) => {
    if (params.response && params.response.url.includes("/analyze-job")) {
      network.responseStatus = params.response.status;
      network.responseRequestId = params.requestId;
    }
  });

  client.on("Runtime.consoleAPICalled", (params) => {
    consoleLogs.push({
      type: params.type,
      args: (params.args || []).map((arg) => arg.value || arg.description || "")
    });
  });

  await client.send("Network.enable");
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Page.navigate", { url: TEST_URL });
  await waitForExpression(client, "document.readyState === 'complete'", 30000);
  await waitForExpression(client, "Boolean(document.getElementById('skillsfuture-analyze-btn'))", 30000);

  await client.send("Runtime.evaluate", {
    expression: "document.getElementById('skillsfuture-analyze-btn').click()",
    awaitPromise: true
  });

  const modalText = await waitForExpression(
    client,
    "(() => { const modal = document.getElementById('skillsfuture-results-modal'); if (!modal || !modal.shadowRoot) return ''; return modal.shadowRoot.querySelector('.body')?.textContent || ''; })()",
    180000
  );

  if (!modalText.includes("Job skill") || !modalText.includes("SkillsFuture match")) {
    throw new Error("Results side panel did not render result cards");
  }

  if (!network.requestPayload) {
    const hookValues = await client.send("Runtime.evaluate", {
      expression: "({ request: document.documentElement.getAttribute('data-skillsfuture-last-request'), response: document.documentElement.getAttribute('data-skillsfuture-last-response'), status: document.documentElement.getAttribute('data-skillsfuture-last-status') })",
      returnByValue: true
    });
    const hooks = hookValues.result.value || {};
    if (!hooks.request || !hooks.response) {
      throw new Error(`No /analyze-job network request was observed. Modal text: ${modalText.replace(/\s+/g, " ").trim().slice(0, 300)}. Console: ${JSON.stringify(consoleLogs).slice(0, 800)}`);
    }
    network.requestPayload = hooks.request;
    network.responseStatus = Number(hooks.status);
    network.responseBody = hooks.response;
  }

  const request = network.requestPayload ? JSON.parse(network.requestPayload) : null;
  if (!request || typeof request.job_description !== "string" || !request.job_description.includes("Python programming")) {
    throw new Error("Network request payload did not contain the expected job_description text");
  }

  if (network.responseStatus !== 200) {
    throw new Error(`Expected /analyze-job status 200, received ${network.responseStatus}`);
  }

  if (!network.responseRequestId && !network.responseBody) {
    throw new Error("No /analyze-job response body was available");
  }

  const responseBody = network.responseBody
    ? { body: network.responseBody }
    : await client.send("Network.getResponseBody", { requestId: network.responseRequestId });
  const apiResponse = JSON.parse(responseBody.body);

  if (!Array.isArray(apiResponse.results) || apiResponse.results.length === 0) {
    throw new Error("Response did not contain a non-empty results array");
  }

  const response = await client.send("Runtime.evaluate", {
    expression: "(() => { const text = document.getElementById('skillsfuture-results-modal')?.shadowRoot?.querySelector('.body')?.textContent || ''; return { text, hasSkills: text.includes('Python') || text.includes('SQL') || text.includes('Data') }; })()",
    returnByValue: true
  });

  if (!response.result.value.hasSkills) {
    throw new Error("Results modal did not display expected skills");
  }

  const minimizeCheck = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const modal = document.getElementById('skillsfuture-results-modal');
      const root = modal && modal.shadowRoot;
      const minimize = root && root.querySelector('.minimize-button');
      minimize && minimize.click();
      const minimized = modal && modal.classList.contains('is-minimized');
      const restore = root && root.querySelector('.restore-button');
      restore && restore.click();
      return {
        minimized,
        restored: modal && !modal.classList.contains('is-minimized'),
        stillHasResults: Boolean(root && root.querySelector('.body')?.textContent.includes('SkillsFuture match')),
        analyzeButtonHidden: document.getElementById('skillsfuture-analyze-btn')?.style.display === 'none',
        restoreText: root && root.querySelector('.restore-button')?.textContent
      };
    })()`,
    returnByValue: true
  });

  if (
    !minimizeCheck.result.value.minimized ||
    !minimizeCheck.result.value.restored ||
    !minimizeCheck.result.value.stillHasResults ||
    !minimizeCheck.result.value.analyzeButtonHidden ||
    minimizeCheck.result.value.restoreText !== "Show analysis"
  ) {
    throw new Error("Results panel did not minimize and restore while keeping the analysis results");
  }

  await client.send("Runtime.evaluate", {
    expression: "document.getElementById('skillsfuture-results-modal').shadowRoot.querySelector('.dashboard-button').click()"
  });

  const dashboardTarget = await waitForTarget(
    (target) => target.type === "page" && target.url.includes("dashboard.html"),
    30000
  );
  const dashboardClient = await connect(dashboardTarget.webSocketDebuggerUrl);
  await dashboardClient.send("Runtime.enable");
  await dashboardClient.send("Page.enable");
  await waitForExpression(
    dashboardClient,
    "document.getElementById('connectionText')?.textContent === 'Backend connected'",
    90000
  );
  await waitForExpression(
    dashboardClient,
    "document.querySelectorAll('.skill-assessment select').length > 0",
    30000
  );
  await waitForExpression(
    dashboardClient,
    "document.querySelectorAll('#recommendedCourses .course-card').length > 0",
    90000
  );
  await waitForExpression(
    dashboardClient,
    "document.querySelectorAll('#pathwayContent .pathway-stage').length > 0",
    90000
  );

  const dashboardBefore = await dashboardClient.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      job: document.getElementById('jobSelect').selectedOptions[0]?.textContent || '',
      proficiencyControls: document.querySelectorAll('.skill-assessment select').length,
      recommendationCards: document.querySelectorAll('#recommendedCourses .course-card').length,
      gaps: [...document.querySelectorAll('.gap-label')].map((item) => item.textContent),
      firstSkill: document.querySelector('.skill-assessment-name')?.textContent || '',
      pathwayStages: document.querySelectorAll('#pathwayContent .pathway-stage').length,
      pathwayActions: [...document.querySelectorAll('#pathwayContent .pathway-stage')]
        .every((item) => item.textContent.includes('Action:') && item.textContent.includes('Outcome:'))
    })`,
    returnByValue: true
  });
  const dashboardBeforeValue = JSON.parse(dashboardBefore.result.value);

  await dashboardClient.send("Runtime.evaluate", {
    expression: `(() => {
      const first = document.querySelector('.skill-assessment select');
      first.value = '3';
      first.dispatchEvent(new Event('change', { bubbles: true }));
    })()`
  });
  await waitForExpression(
    dashboardClient,
    "document.querySelector('.gap-label')?.textContent === 'No gap'",
    30000
  );
  await waitForExpression(
    dashboardClient,
    "document.querySelectorAll('#recommendedCourses .course-card').length > 0",
    90000
  );
  await waitForExpression(
    dashboardClient,
    `(() => {
      const stages = [...document.querySelectorAll('#pathwayContent .pathway-stage')];
      return stages.length > 0 && !stages.some((item) => item.textContent.includes(${JSON.stringify(`Build ${dashboardBeforeValue.firstSkill}`)}));
    })()`,
    90000
  );

  await dashboardClient.send("Runtime.evaluate", {
    expression: "document.querySelector('#pathwayContent .pathway-stage .button.primary').click()"
  });
  await waitForExpression(
    dashboardClient,
    "document.querySelectorAll('#planList .plan-card').length === 1",
    30000
  );
  await dashboardClient.send("Runtime.evaluate", {
    expression: `(() => {
      const credit = document.getElementById('creditBalance');
      credit.value = '0';
      credit.dispatchEvent(new Event('input', { bubbles: true }));
    })()`
  });
  await waitForExpression(
    dashboardClient,
    "document.getElementById('cashMetric')?.textContent !== '$0.00'",
    30000
  );

  const dashboardAfter = await dashboardClient.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      firstGap: document.querySelector('.gap-label')?.textContent || '',
      recommendationCards: document.querySelectorAll('#recommendedCourses .course-card').length,
      pathwayStages: document.querySelectorAll('#pathwayContent .pathway-stage').length,
      pathwayHasAlternative: Boolean(document.querySelector('#pathwayContent .pathway-alternative')),
      pathwayTotals: document.querySelector('#pathwayContent .pathway-totals')?.textContent || '',
      planCards: document.querySelectorAll('#planList .plan-card').length,
      plannedFees: document.getElementById('feeMetric')?.textContent || '',
      creditUsed: document.getElementById('usedMetric')?.textContent || '',
      cashRequired: document.getElementById('cashMetric')?.textContent || ''
    })`,
    returnByValue: true
  });

  const dashboardValidation = {
    before: dashboardBeforeValue,
    after: JSON.parse(dashboardAfter.result.value)
  };
  if (
    !dashboardValidation.before.job ||
    dashboardValidation.before.proficiencyControls < 1 ||
    dashboardValidation.before.recommendationCards < 1 ||
    dashboardValidation.before.pathwayStages < 1 ||
    dashboardValidation.before.pathwayStages > 3 ||
    !dashboardValidation.before.pathwayActions ||
    dashboardValidation.after.firstGap !== "No gap" ||
    dashboardValidation.after.pathwayStages < 1 ||
    !dashboardValidation.after.pathwayTotals.includes("Fees") ||
    dashboardValidation.after.planCards !== 1 ||
    dashboardValidation.after.plannedFees === "$0.00" ||
    dashboardValidation.after.cashRequired === "$0.00"
  ) {
    throw new Error(`Dashboard workflow validation failed: ${JSON.stringify(dashboardValidation)}`);
  }

  const screenshot = await dashboardClient.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  const screenshotPath = path.join(os.tmpdir(), "skillsfuture-phase2-pathway.png");
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const summary = {
    status: "passed",
    network_request: {
      url: "http://localhost:8000/analyze-job",
      status: network.responseStatus,
      job_description_length: request.job_description.length
    },
    result_count: apiResponse.results.length,
    top_extracted_skills: apiResponse.results.slice(0, 5).map((result) => result.extracted_skill),
    modal_contains_results: true,
    modal_minimize_restore: true,
    modal_preview: response.result.value.text.replace(/\s+/g, " ").trim().slice(0, 240),
    console_logged_result: consoleLogs.some((entry) => entry.args.join(" ").includes("SkillsFuture analysis result")),
    dashboard: dashboardValidation,
    dashboard_screenshot: screenshotPath
  };

  fs.writeFileSync(VALIDATION_LOG, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  dashboardClient.close();
  client.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
