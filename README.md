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

## Reliability

Phase 5 reliability controls are enabled by default:

- `GET /api/courses` supports `page` and `page_size` and returns pagination metadata.
- Repeated job analyses and query embeddings use bounded in-memory TTL caches.
- `/health` reports missing, corrupt, or stale skill and course indexes.
- Recommendation endpoints refuse to serve a stale semantic course index.
- API requests produce structured JSON logs with request IDs, status, and duration.
- OpenAI and API requests have explicit timeouts.
- Expensive analysis and recommendation endpoints use per-client in-memory rate limits.
- The extension provides configurable retries, request timeouts, and a reconnect action.

Configure backend reliability in `config.py`:

```python
API_REQUEST_TIMEOUT_SECONDS = 45
OPENAI_TIMEOUT_SECONDS = 30
OPENAI_MAX_RETRIES = 1
JOB_ANALYSIS_CACHE_TTL_SECONDS = 900
JOB_ANALYSIS_CACHE_MAX_SIZE = 128
QUERY_EMBEDDING_CACHE_TTL_SECONDS = 1800
QUERY_EMBEDDING_CACHE_MAX_SIZE = 256
RATE_LIMIT_REQUESTS = 30
RATE_LIMIT_WINDOW_SECONDS = 60
```

The caches and rate limiter are process-local. A production deployment with multiple workers should use a shared store such as Redis.

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

The backend reads secrets only from ignored `config.py`; `.env` files are not used. If an OpenAI key was ever committed, pasted into logs, or shared outside this machine, revoke it in the provider dashboard and replace it in `config.py`. Key revocation cannot be performed by this repository.

For production extension access, configure:

```python
EXTENSION_ID = "your-32-character-extension-id"
ALLOW_LOCAL_DEVELOPMENT_ORIGINS = False
API_ACCESS_TOKEN = "a-long-random-backend-access-token"
MAX_REQUEST_BODY_BYTES = 128000
```

Set the same backend access token in the extension options page. With local development origins disabled, CORS accepts only the configured extension origin. Authentication is optional for local single-user development but must be enabled before exposing the API or supporting multiple users.

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

If `course_semantic_index.status` is `stale` or `unavailable`, rebuild it before serving recommendations:

```powershell
venv\Scripts\python.exe precompute_course_embeddings.py
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

The dashboard provides:

- A 0–3 self-assessment for each extracted job skill
- Gap-based recommendations that exclude skills marked proficient
- A maximum three-stage pathway: Foundation, Core Capability, and Applied Evidence
- Job-grounded semantic course recommendations
- Semantic course search
- Learning-plan statuses and target dates
- User-controlled credit allocation
- Estimates for subsidized fees, remaining credit, cash payable, and learning hours
- Comparison of up to three courses
- Upcoming course-run selection and schedule-conflict warnings
- Persistent pathway reordering and course progress states
- Relevant/not-relevant recommendation feedback
- Calendar export and print-to-PDF output

The proficiency scale is:

```text
0 No experience
1 Beginner
2 Working knowledge
3 Proficient
```

Course recommendations target levels below `3`. This is a user self-assessment, not an inferred or certified proficiency score.

Each pathway stage contains one primary course, one alternative where available, dataset-backed reasoning, estimated fee and credit allocation, one practical action, and one measurable outcome.

Select **Explain with AI** to generate a readable career-plan narrative. The backend sends only the already selected pathway stages and dataset evidence to OpenAI. Returned stage numbers, skills, and course IDs are validated against the deterministic pathway. Invalid or unavailable LLM output is replaced with a deterministic fallback, while fees, credit, duration, and course selection always remain backend-controlled.

Credit calculations are planning estimates. They do not query a live SkillsFuture account or determine funding eligibility.

Use **Export calendar** to download an `.ics` file for plan items with a selected run or target date. Use **Print / PDF** and choose the browser's PDF destination to save the plan.

## Security

- Request bodies and all public request fields are bounded and validated.
- Feedback accepts only `relevant` or `not_relevant` and verifies referenced IDs.
- Internal exception details are not returned to clients.
- Production CORS can be restricted to one extension ID.
- Optional bearer authentication protects every endpoint except `/health`.
- The current product is intentionally single-user and stores planner state in extension storage. Do not treat the `local-user` feedback identifier as multi-user authentication.

## API

```text
GET  /health
POST /analyze-job
GET  /api/career-roles
GET  /api/courses
GET  /api/courses/{course_id}
POST /api/recommendations/courses
POST /api/recommendations/learning-pathway
POST /api/recommendations/course-pathway
POST /api/recommendations/feedback
```

Example course search:

```powershell
curl.exe "http://localhost:8000/api/courses?keyword=python&page=1&page_size=20"
```

Example semantic course recommendation:

```powershell
curl.exe -X POST http://localhost:8000/api/recommendations/courses `
  -H "Content-Type: application/json" `
  -d "{\"skills\":[\"Python\",\"data analysis\"],\"max_budget\":1000,\"limit\":5}"
```

Example actionable pathway:

```powershell
curl.exe -X POST http://localhost:8000/api/recommendations/learning-pathway `
  -H "Content-Type: application/json" `
  -d "{\"skill_gaps\":[{\"skill\":\"Python\",\"current_level\":1,\"source_evidence\":\"The role requires Python.\"},{\"skill\":\"SQL\",\"current_level\":2}],\"available_credit\":500,\"monthly_hours\":20,\"target_role\":\"Data Engineer\",\"include_narrative\":true}"
```

`include_narrative: true` uses one additional OpenAI call. Leaving it false returns the complete deterministic pathway without additional token usage.

## Tests

```powershell
venv\Scripts\python.exe -m unittest discover -s tests
node --check Skillfuture-Skills-Extension/chrome_extension/contentScript.js
node --check Skillfuture-Skills-Extension/chrome_extension/dashboard.js
```

## Data Notice

Course data is imported from local SkillsFuture dataset files. Verify current course fees, schedules, eligibility, and credit usage with SkillsFuture Singapore and the training provider. This product is not operated, endorsed, or certified by SkillsFuture Singapore, SSG, or the Singapore Government.
