const DEFAULT_BACKEND_URL = "http://localhost:8000/analyze-job";

function normalizeBackendUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BACKEND_URL;
  return trimmed.endsWith("/analyze-job") ? trimmed : `${trimmed}/analyze-job`;
}

async function loadOptions() {
  const input = document.getElementById("backendUrl");

  try {
    const value = await chrome.storage.local.get("backendUrl");
    input.value = value.backendUrl || DEFAULT_BACKEND_URL;
  } catch (error) {
    input.value = window.localStorage.getItem("skillsfuture_backend_url") || DEFAULT_BACKEND_URL;
  }
}

async function saveOptions() {
  const input = document.getElementById("backendUrl");
  const status = document.getElementById("status");
  const backendUrl = normalizeBackendUrl(input.value);

  try {
    await chrome.storage.local.set({ backendUrl });
  } catch (error) {
    window.localStorage.setItem("skillsfuture_backend_url", backendUrl);
  }

  input.value = backendUrl;
  status.textContent = "Saved";
  window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

document.addEventListener("DOMContentLoaded", loadOptions);
document.getElementById("save").addEventListener("click", saveOptions);
