/healt# SkillsFuture Job Skill Matcher

Browser extension plus FastAPI backend for extracting skills from job descriptions and mapping them to official SkillsFuture skills.

## What It Does

- Chrome/Edge extension injects an **Analyze with SkillsFuture** button on supported job pages.
- The content script extracts job description text from the page, or from highlighted text if scraping fails.
- FastAPI receives the job text at `POST /analyze-job`.
- OpenAI extracts candidate skills from the job text.
- A local `sentence-transformers` model matches extracted skills against `skills_with_local_embeddings.pkl`.
- The extension displays a side panel with extracted skills, official SkillsFuture matches, definitions, confidence labels, and Emerging Skill badges.

## Files

- `main.py` - FastAPI backend.
- `precompute_embeddings_local.py` - creates local embeddings from the SkillsFuture Excel data.
- `skills_with_local_embeddings.pkl` - precomputed local vector index.
- `chrome_extension/` - browser extension files.
- `.env` - local secrets such as `OPENAI_API_KEY`; do not commit this file.

## Setup

```powershell
venv\Scripts\python.exe -m pip install -r requirements.txt
```

If you do not have a venv yet:

```powershell
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Run Backend

For normal demo use, avoid reload so the embedding model is not repeatedly reloaded:

```powershell
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

For development:

```powershell
venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Health check:

```powershell
curl.exe http://localhost:8000/health
```

Analyze endpoint:

```powershell
curl.exe -X POST http://localhost:8000/analyze-job -H "Content-Type: application/json" -d "{\"job_description\":\"Python SQL API cloud deployment data pipeline role\"}"
```

## Run Extension

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select `chrome_extension`.
5. Start the backend.
6. Open a supported job page or `chrome_extension/test_page.html`.
7. Click **Analyze with SkillsFuture**.

Supported site patterns are configured in `chrome_extension/manifest.json`.

## Current Hardening

- `.env` is ignored by Git.
- Backend caps job text length before OpenAI use.
- Backend validates extracted skills and removes duplicates.
- Backend caches repeated analyses by SHA-256 hash of job text.
- Extension caps job text before sending.
- Extension supports selected-text fallback.
- Extension debug request/response DOM attributes are only enabled on localhost, 127.0.0.1, or file URLs.
