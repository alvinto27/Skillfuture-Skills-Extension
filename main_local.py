from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from transformers import pipeline
import json
import re
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


def get_cosine_similarity(vec1, vec_matrix):
    dot_product = np.dot(vec_matrix, vec1)
    norm_vec1 = np.linalg.norm(vec1)
    norm_matrix = np.linalg.norm(vec_matrix, axis=1)
    return dot_product / (norm_vec1 * norm_matrix)


def extract_skills_from_text(text: str):
    prompt = (
        "Extract a list of the top 5 technical skills required from this job description. "
        "Return ONLY a JSON array of strings.\n\n"
        "Job Description:\n"
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
            "top_matches": top_matches,
        })

    return {"results": final_results}
