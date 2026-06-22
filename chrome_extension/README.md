# SkillsFuture Chrome Extension

## Backend validation

Start the FastAPI server from the project root:

```bash
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

On this Windows workspace, use the project virtual environment if the global `python` cannot import the project dependencies:

```powershell
venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Validate the endpoint:

```bash
curl -sS -X POST http://localhost:8000/analyze-job -H "Content-Type: application/json" -d "{\"job_description\":\"test job description with Python, SQL, APIs, cloud deployment, and data pipelines\"}"
```

The response should include a `results` array.

## Load the extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `chrome_extension` folder.
5. Open the extension details and enable file URL access if you want to use `test_page.html`.

## Configure backend URL

Open the extension options page and set the backend URL. The default is:

```text
http://localhost:8000/analyze-job
```

The content script checks `window.__skillsfuture_backend_url` first, then Chrome storage, then localStorage, then the default URL.

## Manual test

1. Start the backend.
2. Open `chrome_extension/test_page.html` in Chrome.
3. Click Analyze with SkillsFuture.
4. Confirm the modal displays extracted skills and top official matches.
5. Open DevTools console to inspect `window.__skillsfuture_last_request` and `window.__skillsfuture_last_response`.

## Supported pages

The content script is restricted to LinkedIn Jobs, MyCareersFuture job pages, localhost/127.0.0.1 pages for automated testing, and local file URLs for manual testing.
