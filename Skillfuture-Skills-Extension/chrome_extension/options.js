const DEFAULT_BACKEND_URL = "http://localhost:8000/analyze-job";
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_TIMEOUT_SECONDS = 45;

function normalizeBackendUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BACKEND_URL;
  return trimmed.endsWith("/analyze-job") ? trimmed : `${trimmed}/analyze-job`;
}

async function loadOptions() {
  const input = document.getElementById("backendUrl");
  const retryInput = document.getElementById("retryCount");
  const timeoutInput = document.getElementById("timeoutSeconds");

  try {
    const value = await chrome.storage.local.get([
      "backendUrl",
      "apiAccessToken",
      "retryCount",
      "timeoutSeconds"
    ]);
    input.value = value.backendUrl || DEFAULT_BACKEND_URL;
    document.getElementById("apiAccessToken").value = value.apiAccessToken || "";
    retryInput.value = String(value.retryCount ?? DEFAULT_RETRY_COUNT);
    timeoutInput.value = String(value.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
  } catch (error) {
    input.value = window.localStorage.getItem("skillsfuture_backend_url") || DEFAULT_BACKEND_URL;
    document.getElementById("apiAccessToken").value = window.localStorage.getItem("skillsfuture_api_access_token") || "";
    retryInput.value = window.localStorage.getItem("skillsfuture_retry_count") || String(DEFAULT_RETRY_COUNT);
    timeoutInput.value = window.localStorage.getItem("skillsfuture_timeout_seconds") || String(DEFAULT_TIMEOUT_SECONDS);
  }
}

async function saveOptions() {
  const input = document.getElementById("backendUrl");
  const status = document.getElementById("status");
  const backendUrl = normalizeBackendUrl(input.value);
  const apiAccessToken = String(document.getElementById("apiAccessToken").value || "").trim();
  const retryCount = Math.min(Math.max(Number(document.getElementById("retryCount").value) || 0, 0), 3);
  const timeoutSeconds = Math.min(Math.max(Number(document.getElementById("timeoutSeconds").value) || DEFAULT_TIMEOUT_SECONDS, 5), 120);

  try {
    await chrome.storage.local.set({ backendUrl, apiAccessToken, retryCount, timeoutSeconds });
  } catch (error) {
    window.localStorage.setItem("skillsfuture_backend_url", backendUrl);
    window.localStorage.setItem("skillsfuture_api_access_token", apiAccessToken);
    window.localStorage.setItem("skillsfuture_retry_count", String(retryCount));
    window.localStorage.setItem("skillsfuture_timeout_seconds", String(timeoutSeconds));
  }

  input.value = backendUrl;
  document.getElementById("retryCount").value = String(retryCount);
  document.getElementById("timeoutSeconds").value = String(timeoutSeconds);
  status.textContent = "Saved";
  window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

document.addEventListener("DOMContentLoaded", loadOptions);
document.getElementById("save").addEventListener("click", saveOptions);
