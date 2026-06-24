# SkillsFuture Job Skill Matcher

A local FastAPI backend plus a browser extension for extracting skills from job descriptions, matching them to SkillsFuture skill data, and planning course pathways.

## Project Demo Video
This is the link to the Demo Video:
https://youtu.be/6mezVTgYD2o

## Overview

- Backend: `main.py` runs a FastAPI app
- Extension: `Skillfuture-Skills-Extension/chrome_extension` injects UI into supported job sites
- Local data: skill embeddings, course database, course run data, and semantic course index
- Optional OpenAI usage: job skill extraction and grounded RAG summarization

## What the project uses

- FastAPI backend API
- SQLite course database (`skillsfuture_courses.sqlite3`)
- Local skill embeddings (`skills_with_local_embeddings.pkl`)
- SentenceTransformer semantic retrieval for courses
- Chrome/Edge manifest v3 extension for page integration

## Prerequisites

- Python 3.12+
- PowerShell or terminal access
- Chrome or Edge for extension testing

## Setup

1. Create a virtual environment:

```powershell
python -m venv venv
```

2. Activate the virtual environment:

```powershell
venv\Scripts\Activate.ps1
```

3. Install dependencies:

```powershell
venv\Scripts\python.exe -m pip install -r requirements.txt
```

4. Copy the example config:

```powershell
Copy-Item config.example.py config.py
```

5. Open `config.py` and set your OpenAI API key:

```python
OPENAI_API_KEY = "your-key"
```

## Configuration

In `config.py`, adjust only non-secret application settings and local paths.

Required settings:

- `OPENAI_API_KEY` — your OpenAI key

Local development settings:

- `ALLOW_LOCAL_DEVELOPMENT_ORIGINS = True` to permit local browser page origins
- `API_ACCESS_TOKEN = ""` for no auth in local development

Production settings:

- `EXTENSION_ID = "your-32-character-extension-id"`
- `ALLOW_LOCAL_DEVELOPMENT_ORIGINS = False`
- `API_ACCESS_TOKEN = "a-long-random-backend-access-token"

## Prepare data

### Skill index

Build local skill embeddings if you need to refresh or regenerate them:

```powershell
venv\Scripts\python.exe precompute_embeddings_local.py
```

### Course import

Inspect the course files first:

```powershell
venv\Scripts\python.exe sync_skillsfuture_data.py --dataset courses --dry-run
venv\Scripts\python.exe sync_skillsfuture_data.py --dataset course-runs --dry-run
```

Import the course data:

```powershell
venv\Scripts\python.exe sync_skillsfuture_data.py
```

Use `--force` to reimport data even when hashes have not changed.

### Semantic course index

Build the local semantic course index after importing or changing course data:

```powershell
venv\Scripts\python.exe precompute_course_embeddings.py
```

## Run the backend

Start the FastAPI app:

```powershell
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

For development with auto reload:

```powershell
venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Verify the backend

Check health:

```powershell
curl.exe http://localhost:8000/health
```

Expected results:

- `skills_loaded` should be greater than `0`
- `course_database_ready` should be `true`
- `course_semantic_index_ready` should be `true`
- `openai_configured` should be `true` if your OpenAI key is set

If `course_semantic_index_ready` is `false`, run:

```powershell
venv\Scripts\python.exe precompute_course_embeddings.py
```

## Run the extension

1. Open `edge://extensions` or `chrome://extensions`
2. Enable Developer mode
3. Load unpacked extension from `Skillfuture-Skills-Extension/chrome_extension`
4. Start the backend
5. Open a supported job page
6. Click **Analyze with SkillsFuture**

## Local development and CORS

For local page injection on `mycareersfuture.gov.sg`, keep:

```python
ALLOW_LOCAL_DEVELOPMENT_ORIGINS = True
```

If you want production-style security, set:

```python
ALLOW_LOCAL_DEVELOPMENT_ORIGINS = False
EXTENSION_ID = "your-32-character-extension-id"
API_ACCESS_TOKEN = "your-token"
```

Then use the same token in extension options.

## API endpoints

- `GET /health`
- `POST /analyze-job`
- `GET /api/career-roles`
- `GET /api/courses`
- `GET /api/courses/{course_id}`
- `POST /api/recommendations/courses`
- `POST /api/recommendations/learning-pathway`
- `POST /api/recommendations/course-pathway`
- `POST /api/recommendations/feedback`

### Example analyze request

```powershell
curl.exe -X POST http://localhost:8000/analyze-job `
  -H "Content-Type: application/json" `
  -d "{\"job_description\": \"Python developer with SQL and REST API experience\"}"
```

### Example course recommendation

```powershell
curl.exe -X POST http://localhost:8000/api/recommendations/courses `
  -H "Content-Type: application/json" `
  -d "{\"skills\":[\"Python\",\"data analysis\"],\"max_budget\":1000,\"limit\":5}"
```

### Example pathway request

```powershell
curl.exe -X POST http://localhost:8000/api/recommendations/learning-pathway `
  -H "Content-Type: application/json" `
  -d "{\"skill_gaps\":[{\"skill\":\"Python\",\"current_level\":1,\"source_evidence\":\"The role requires Python.\"},{\"skill\":\"SQL\",\"current_level\":2}],\"available_credit\":500,\"monthly_hours\":20,\"target_role\":\"Data Engineer\",\"include_narrative\":true}"
```

## Testing

Run backend unit tests:

```powershell
venv\Scripts\python.exe -m unittest discover -s tests
```

Validate extension scripts before browser launch:

```powershell
node --check Skillfuture-Skills-Extension/chrome_extension/contentScript.js
node --check Skillfuture-Skills-Extension/chrome_extension/dashboard.js
```

## Notes

- The backend stores no user session data outside the local SQLite database.
- Course and skill data are local; the app does not call a remote SkillsFuture dataset API.
- If CORS or auth is misconfigured, the browser will block requests before they reach the backend.
- If the OpenAI key is missing, `/analyze-job` returns `503`.

## Troubleshooting

### `ERR_CONNECTION_REFUSED`
- Confirm the backend is running on `http://localhost:8000`.
- Restart with:
  ```powershell
  venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
  ```
- Verify with:
  ```powershell
  curl.exe http://localhost:8000/health
  ```

### `400 Bad Request`
- Check the request body for the endpoint:
  - `/analyze-job` requires `job_description` and optional `include_rag`
  - `/api/recommendations/courses` requires `skills`
- Ensure `Content-Type: application/json` is set.
- For browser requests, inspect the DevTools network request body and response detail.

### CORS / preflight failures
- Keep `ALLOW_LOCAL_DEVELOPMENT_ORIGINS = True` during local browser testing.
- Ensure the extension is loading from a supported page and the request is sent to `http://localhost:8000`.
- If using production auth, set `EXTENSION_ID` and `API_ACCESS_TOKEN` consistently in `config.py` and extension options.

### `503 Service Unavailable`
- If `/analyze-job` returns `503`, check `/health` output.
- Common causes:
  - OpenAI key not configured in `config.py`
  - course semantic index is missing or stale
  - `skills_with_local_embeddings.pkl` failed to load
