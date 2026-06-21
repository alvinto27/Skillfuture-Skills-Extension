from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from transformers import pipeline
import json
import re
from typing import Any
from fastapi.middleware.cors import CORSMiddleware

# --- 1. SETUP & LOADING ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the local precomputed embeddings file
SKILLS_FILE = "skills_with_local_embeddings.pkl"
df = pd.read_pickle(SKILLS_FILE)
print(f"Loaded {len(df)} skills from {SKILLS_FILE}")

# Stack all embeddings into a single Numpy matrix
# These embeddings are expected to be normalized if generated with sentence-transformers normalize_embeddings=True
try:
    db_embeddings = np.stack(df['embedding'].values)
except Exception as exc:
    raise RuntimeError(f"Unable to stack embeddings from {SKILLS_FILE}: {exc}")

# Local models for extraction and query embedding
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
extractor = pipeline(
    "text-generation",
    model="google/flan-t5-small",
    device=-1,
    max_length=256,
    do_sample=False,
)

print("✅ Local API ready. Using open-source models for extraction and embeddings.")

# --- 2. DATA MODELS ---
class JobRequest(BaseModel):
    job_description: str
    job_data: dict[str, Any] | None = None


def get_cosine_similarity(vec1, vec_matrix):
    dot_product = np.dot(vec_matrix, vec1)
    norm_vec1 = np.linalg.norm(vec1)
    norm_matrix = np.linalg.norm(vec_matrix, axis=1)
    return dot_product / (norm_vec1 * norm_matrix)


def find_source_evidence(skill: str, job_description: str):
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


def extract_skills_from_text(text: str):
    prompt = (
        "Extract a list of the top 5 skills, tools, domain requirements, qualifications, "
        "or experience requirements from this employer job listing text. Use only employer "
        "responsibilities, requirements, qualifications, and required tools. Ignore profile "
        "prompts, job-match widgets, navigation, footer text, and phrases like "
        "'Tell employers what skills you have'. "
        "Return ONLY a JSON array of strings.\n\n"
        "Employer job requirements:\n"
        f"{text}\n\n"
        "JSON:"
    )

    output = extractor(prompt)[0]['generated_text']
    cleaned = output.replace("```json", "").replace("```", "").strip()

    try:
        skills = json.loads(cleaned)
    except json.JSONDecodeError:
        cleaned = cleaned.strip()
        if cleaned.startswith("[") and cleaned.endswith("]"):
            cleaned = cleaned[1:-1]
        items = re.split(r',|\n|- ', cleaned)
        skills = [item.strip().strip('"').strip("'") for item in items if item.strip()]

    if not isinstance(skills, list):
        return []

    return [str(skill).strip() for skill in skills if str(skill).strip()][:5]


@app.post("/analyze-job")
async def analyze_job(request: JobRequest):
    extracted_skills = extract_skills_from_text(request.job_description)

    if not extracted_skills:
        return {"results": [], "error": "No skills were extracted from the job description."}

    final_results = []

    for skill in extracted_skills:
        query_vec = embedding_model.encode(skill, normalize_embeddings=True)
        if query_vec.ndim > 1:
            query_vec = query_vec[0]

        similarities = get_cosine_similarity(query_vec, db_embeddings)
        top_3_idx = np.argsort(similarities)[-3:][::-1]
        top_matches = []

        for idx in top_3_idx:
            row = df.iloc[idx]
            top_matches.append({
                "official_skill_title": row['skill_title'],
                "official_skill_description": row['skill_description'],
                "similarity_score": float(similarities[idx]),
                "is_emerging": bool(row.get('Emerging Skills', False)),
            })

        final_results.append({
            "extracted_skill": skill,
            "source_evidence": find_source_evidence(str(skill), request.job_description),
            "top_matches": top_matches,
        })

    top_scores = [
        result["top_matches"][0]["similarity_score"]
        for result in final_results
        if result["top_matches"]
    ]

    return {
        "results": final_results,
        "matched_skills": [result["extracted_skill"] for result in final_results],
        "missing_skills": [],
        "suitability_score": round(float(np.mean(top_scores)) * 100) if top_scores else 0,
        "explanation": "Matched skills are based only on extracted employer responsibilities, requirements, qualifications, and required tools. No user profile skills were provided to calculate personal missing skills.",
    }
