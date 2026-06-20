<<<<<<< HEAD
# SkillsFuture Job Skill Matcher

## Progress So Far

### Day 1: Data Prep & Backend Scaffolding
- Data source loaded from `jobsandskills-skillsfuture-unique-skills-list.xlsx`
- Data cleaned by dropping rows missing `skill_title` and filling empty descriptions
- Precomputed embeddings pipeline available:
  - `precompute_embeddings.py` for OpenAI embeddings
  - `precompute_embeddings_local.py` for local `sentence-transformers` embeddings
- Saved local embeddings to `skills_with_local_embeddings.pkl`
- Backend scaffolding created using FastAPI

### Day 2: Core AI Engine
- API endpoint `/analyze-job` implemented
- Current local version in `main_local.py`:
  - extracts top skills from job text using OpenAI for higher-quality parsing
  - embeds extracted skills locally with `all-MiniLM-L6-v2`
  - matches against precomputed SkillsFuture embeddings with cosine similarity
- OpenAI is used only for extraction in `main_local.py`; embeddings remain local

## Files
- `main.py` — original OpenAI-backed FastAPI implementation
- `main_local.py` — open-source local FastAPI implementation
- `precompute_embeddings.py` — generates OpenAI embeddings and saves them to a pickle
- `precompute_embeddings_local.py` — generates local embeddings and saves them to a pickle
- `jobsandskills-skillsfuture-unique-skills-list.xlsx` — input dataset
- `skills_with_local_embeddings.pkl` — precomputed local embeddings file

## How to Run Locally

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   If `requirements.txt` does not exist, install:
   ```bash
   pip install fastapi uvicorn pandas numpy sentence-transformers transformers torch
   ```

2. Start the local API:
   ```bash
   uvicorn main_local:app --reload
   ```

3. Send a POST request to `/analyze-job` with JSON:
   ```json
   {
     "job_description": "Your job description text here"
   }
   ```

## Notes
- Use `main_local.py` if you do not want to rely on OpenAI credits.
- `main.py` still exists as a reference implementation using OpenAI.
- If you want Skill IDs returned, the dataset may need additional columns and mapping logic.
=======
# Skillfuture-Skills-Extension
>>>>>>> 46ffef9a2b17ba51e05fbb7478101a9d4e0ff318
