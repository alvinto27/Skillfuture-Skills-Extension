# SkillsFuture Job Skill Matcher

Browser extension and FastAPI backend for extracting skills from job descriptions, matching them to the local SkillsFuture skill dictionary, and planning courses against a user-entered SkillsFuture Credit balance.

## Architecture

```text
Job page
  -> Chrome/Edge content script
  -> POST /analyze-job
  -> OpenAI skill extraction
  -> local sentence-transformer matching
  -> SkillsFuture skill results and optional grounded RAG
  -> course planner backed by SQLite
```

Course and skill data remain local:

- Skill embeddings: `skills_with_local_embeddings.pkl`
- Course directory: `MySkillsFutureCourseDirectory.xlsx`
- Course runs: `MySkillsFutureCourseRun.xlsx`
- Normalized course database: `skillsfuture_courses.sqlite3`

The project does not call a remote course dataset API.

## Project Layout

```text
main.py                              FastAPI application
course_recommender.py                Course and pathway ranking
skillsfuture_db.py                   SQLite access and migrations
skillsfuture_sync.py                 Local Excel import service
sync_skillsfuture_data.py            Import CLI
precompute_embeddings_local.py       Skill embedding generator
skillsfuture_config.py               Non-secret configuration loader
config.example.py                    Local configuration template
migrations/                          SQLite schema
data/career_roles.json               Initial local role taxonomy
tests/                               Backend unit tests
Skillfuture-Skills-Extension/
  chrome_extension/                  Manifest V3 extension
```

## Setup

```powershell
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item config.example.py config.py
```

Set the OpenAI key in `config.py`:

```python
OPENAI_API_KEY = "your-key"
```

`config.py`, local databases, virtual environments, caches, and validation logs are ignored by Git.

## Prepare Data

Generate the local skill index when the source skill workbook changes:

```powershell
venv\Scripts\python.exe precompute_embeddings_local.py
```

Inspect the local course files:

```powershell
venv\Scripts\python.exe sync_skillsfuture_data.py --dataset courses --dry-run
venv\Scripts\python.exe sync_skillsfuture_data.py --dataset course-runs --dry-run
```

Import both course datasets:

```powershell
venv\Scripts\python.exe sync_skillsfuture_data.py
```

Use `--force` to reimport files whose hashes have not changed.

Build the semantic course index after importing or changing course data:

```powershell
venv\Scripts\python.exe precompute_course_embeddings.py
```

Restart the backend after rebuilding the index. Course retrieval runs locally and does not use OpenAI tokens.

## Run Backend

```powershell
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Use reload only while editing:

```powershell
venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Validate health:

```powershell
curl.exe http://localhost:8000/health
```

Validate job analysis:

```powershell
curl.exe -X POST http://localhost:8000/analyze-job `
  -H "Content-Type: application/json" `
  -d "{\"job_description\":\"Python SQL API cloud deployment data pipeline role\"}"
```

Set `"include_rag": true` in the request body to add one grounded OpenAI recommendation call after local vector retrieval.

## Run Extension

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable Developer mode.
3. Select **Load unpacked**.
4. Select `Skillfuture-Skills-Extension/chrome_extension`.
5. Start the backend.
6. Open a supported job page.
7. Select **Analyze with SkillsFuture**.

Reload the unpacked extension after changing extension files.

The dashboard provides job-grounded semantic course recommendations, semantic course search, learning-plan statuses, target dates, user-controlled credit allocation, and estimates for subsidized fees, remaining credit, cash payable, and learning hours.

Credit calculations are planning estimates. They do not query a live SkillsFuture account or determine funding eligibility.

## API

```text
GET  /health
POST /analyze-job
GET  /api/career-roles
GET  /api/courses
GET  /api/courses/{course_id}
POST /api/recommendations/courses
POST /api/recommendations/course-pathway
POST /api/recommendations/feedback
```

Example course search:

```powershell
curl.exe "http://localhost:8000/api/courses?keyword=python"
```

Example semantic course recommendation:

```powershell
curl.exe -X POST http://localhost:8000/api/recommendations/courses `
  -H "Content-Type: application/json" `
  -d "{\"skills\":[\"Python\",\"data analysis\"],\"max_budget\":1000,\"limit\":5}"
```

## Tests

```powershell
venv\Scripts\python.exe -m unittest discover -s tests
node --check Skillfuture-Skills-Extension/chrome_extension/contentScript.js
node --check Skillfuture-Skills-Extension/chrome_extension/dashboard.js
```

## Data Notice

Course data is imported from local SkillsFuture dataset files. Verify current course fees, schedules, eligibility, and credit usage with SkillsFuture Singapore and the training provider. This product is not operated, endorsed, or certified by SkillsFuture Singapore, SSG, or the Singapore Government.
