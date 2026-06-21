from fastapi import FastAPI, HTTPException
<<<<<<< Updated upstream
from pydantic import BaseModel
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from openai import OpenAI
import os
import json
import hashlib
import time
from fastapi.middleware.cors import CORSMiddleware

# --- 1. SETUP & LOADING ---
try:
    from config import OPENAI_API_KEY as CONFIG_OPENAI_API_KEY
except ImportError:
    CONFIG_OPENAI_API_KEY = ""

client = OpenAI(api_key=CONFIG_OPENAI_API_KEY)
MAX_JOB_DESCRIPTION_CHARS = int(os.getenv("MAX_JOB_DESCRIPTION_CHARS", "12000"))
MAX_EXTRACTED_SKILLS = int(os.getenv("MAX_EXTRACTED_SKILLS", "8"))
analysis_cache = {}
=======
from pydantic import BaseModel
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from openai import OpenAI
import os
import json
import re
from typing import Any
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

# --- 1. SETUP & LOADING ---
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
>>>>>>> Stashed changes

print("Loading API, Database, and MiniLM Model... (This takes a few seconds)")
app = FastAPI()

# Enable CORS so your Chrome Extension can talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://www.linkedin.com",
        "https://linkedin.com",
        "https://www.mycareersfuture.gov.sg",
    ],
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$|^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^file://.*$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the pickle file you made yesterday
df = pd.read_pickle("skills_with_local_embeddings.pkl")
# Stack all embeddings into a single, fast Numpy matrix
db_embeddings = np.stack(df['embedding'].values)

# Load your chosen local model
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
print("Server Ready!")

# --- 2. DATA MODELS ---
class JobRequest(BaseModel):
    job_description: str
<<<<<<< Updated upstream

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "skills_loaded": int(len(df)),
        "embedding_model": "all-MiniLM-L6-v2",
        "cache_entries": len(analysis_cache),
    }

def get_cosine_similarity(vec1, vec_matrix):
    """Blazing fast vector math to find similar items"""
    dot_product = np.dot(vec_matrix, vec1)
    norm_vec1 = np.linalg.norm(vec1)
    norm_matrix = np.linalg.norm(vec_matrix, axis=1)
    return dot_product / (norm_vec1 * norm_matrix)

# --- 3. THE MAGIC ENDPOINT ---
@app.post("/analyze-job")
async def analyze_job(request: JobRequest):
    started_at = time.perf_counter()
    job_description = request.job_description.strip()
    if len(job_description) < 10:
        raise HTTPException(status_code=400, detail="job_description is too short")
    if len(job_description) > MAX_JOB_DESCRIPTION_CHARS:
        job_description = job_description[:MAX_JOB_DESCRIPTION_CHARS]

    cache_key = hashlib.sha256(job_description.encode("utf-8")).hexdigest()
    cached_response = analysis_cache.get(cache_key)
    if cached_response:
        return {**cached_response, "cached": True}

    # STEP 1: Extract raw skills from the text
    extract_prompt = f"""
    Extract the top 5 technical skills from this job description.
    Return ONLY a raw JSON array of strings, nothing else. Example: ["Python", "REST API", "Cloud Deployment"]
    
    Job Description:
    {job_description}
    """
=======
    job_data: dict[str, Any] | None = None


def get_cosine_similarity(vec1, vec_matrix):
    """Blazing fast vector math to find similar items"""
    dot_product = np.dot(vec_matrix, vec1)
    norm_vec1 = np.linalg.norm(vec1)
    norm_matrix = np.linalg.norm(vec_matrix, axis=1)
    return dot_product / (norm_vec1 * norm_matrix)

def find_source_evidence(skill: str, job_description: str):
    """Return a short extracted requirement line that appears to justify a skill."""
    skill_words = [word.lower() for word in re.findall(r"[A-Za-z0-9+#.]+", skill) if len(word) > 2]
    lines = [line.strip(" -\t") for line in job_description.splitlines() if line.strip()]

    for line in lines:
        lower_line = line.lower()
        if skill.lower() in lower_line:
            return line[:260]
        if skill_words and all(word in lower_line for word in skill_words[:3]):
            return line[:260]

    for line in lines:
        lower_line = line.lower()
        if any(word in lower_line for word in skill_words):
            return line[:260]

    return ""

# --- 3. THE MAGIC ENDPOINT ---
@app.post("/analyze-job")
async def analyze_job(request: JobRequest):
    job_description = request.job_description.strip()
    if len(job_description) < 10:
        raise HTTPException(status_code=400, detail="job_description is too short")

    # STEP 1: Extract raw skills from employer-provided requirement text only.
    extract_prompt = f"""
    Extract the top 5 skills, tools, domain requirements, qualifications, or experience requirements from this employer job listing text.
    Use only employer job requirements, responsibilities, qualifications, and required tools.
    Ignore profile prompts, job-match widgets, navigation, footer text, and phrases like "Tell employers what skills you have".
    Return ONLY a raw JSON array of strings, nothing else. Example: ["Python", "REST API", "Cloud Deployment"]
    
    Employer job requirements:
    {job_description}
    """
>>>>>>> Stashed changes

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": extract_prompt}],
            temperature=0.0
        )

        # Clean the output just in case the LLM added markdown formatting
        raw_response = response.choices[0].message.content.replace("```json", "").replace("```", "").strip()
<<<<<<< Updated upstream
        extracted_skills = json.loads(raw_response)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="OpenAI returned invalid skill JSON") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Skill extraction failed: {exc}") from exc

    if not isinstance(extracted_skills, list):
        raise HTTPException(status_code=502, detail="OpenAI response was not a skill array")

    cleaned_skills = []
    seen_skills = set()
    for skill in extracted_skills:
        if not isinstance(skill, str):
            continue
        cleaned_skill = skill.strip()
        if not cleaned_skill:
            continue
        skill_key = cleaned_skill.casefold()
        if skill_key in seen_skills:
            continue
        seen_skills.add(skill_key)
        cleaned_skills.append(cleaned_skill)
        if len(cleaned_skills) >= MAX_EXTRACTED_SKILLS:
            break

    if not cleaned_skills:
        raise HTTPException(status_code=502, detail="No valid extracted skills returned")

    final_results = []

    # STEP 2: Vector Search locally against precomputed embeddings
    for skill in cleaned_skills:
        # Embed the single extracted skill locally
        query_vec = embedding_model.encode(skill, normalize_embeddings=True)
=======
        extracted_skills = json.loads(raw_response)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="OpenAI returned invalid skill JSON") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Skill extraction failed: {exc}") from exc

    if not isinstance(extracted_skills, list):
        raise HTTPException(status_code=502, detail="OpenAI response was not a skill array")

    final_results = []

    # STEP 2: Vector Search locally against precomputed embeddings
    for skill in extracted_skills:
        # Embed the single extracted skill locally
        query_vec = embedding_model.encode(skill, normalize_embeddings=True)
>>>>>>> Stashed changes
        if query_vec.ndim > 1:
            query_vec = query_vec[0]

        # Calculate similarity against ALL SkillsFuture skills instantly
        similarities = get_cosine_similarity(query_vec, db_embeddings)
        
        # Get the row indexes of the Top 3 highest scores
        top_3_idx = np.argsort(similarities)[-3:][::-1]
        top_matches = []

        for idx in top_3_idx:
            row = df.iloc[idx]
            top_matches.append({
                "official_skill_title": row['skill_title'],
                "official_skill_description": row['skill_description'],
                "similarity_score": float(similarities[idx]),
                "is_emerging": bool(row['Emerging Skills'])
            })

        final_results.append({
            "extracted_skill": skill,
<<<<<<< Updated upstream
            "top_matches": top_matches,
        })

    response_payload = {
        "results": final_results,
        "cached": False,
        "job_description_chars": len(job_description),
        "processing_ms": round((time.perf_counter() - started_at) * 1000),
    }
    analysis_cache[cache_key] = response_payload
    return response_payload
=======
            "source_evidence": find_source_evidence(str(skill), job_description),
            "top_matches": top_matches,
        })

    suitability_score = 0
    if final_results:
        top_scores = [
            result["top_matches"][0]["similarity_score"]
            for result in final_results
            if result["top_matches"]
        ]
        if top_scores:
            suitability_score = round(float(np.mean(top_scores)) * 100)

    return {
        "results": final_results,
        "matched_skills": [result["extracted_skill"] for result in final_results],
        "missing_skills": [],
        "suitability_score": suitability_score,
        "explanation": "Matched skills are based only on extracted employer responsibilities, requirements, qualifications, and required tools. No user profile skills were provided to calculate personal missing skills.",
    }
>>>>>>> Stashed changes
