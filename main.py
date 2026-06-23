import json
import os
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

import skillsfuture_config as settings
from course_semantic_search import CourseSemanticIndex
from course_recommender import get_career_roles, list_courses, get_course, recommend_course_pathway
from skillsfuture_db import connect, initialize_database, utc_now

PROJECT_ROOT = Path(__file__).resolve().parent
SKILLS_FILE = PROJECT_ROOT / "skills_with_local_embeddings.pkl"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
OPENAI_MODEL = "gpt-4o-mini"
MAX_JOB_DESCRIPTION_LENGTH = 12_000

try:
    from config import OPENAI_API_KEY as CONFIG_OPENAI_API_KEY
except ImportError:
    CONFIG_OPENAI_API_KEY = ""

OPENAI_API_KEY = CONFIG_OPENAI_API_KEY or os.getenv("OPENAI_API_KEY", "")
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

app = FastAPI(title="SkillsFuture Job Skill Matcher", version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://www.linkedin.com",
        "https://linkedin.com",
        "https://www.mycareersfuture.gov.sg",
        "https://mycareersfuture.gov.sg",
        "https://www.jobstreet.com.sg",
        "https://sg.jobstreet.com",
        "null",
    ],
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$|^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^file://.*$",
    allow_methods=["*"],
    allow_headers=["*"],
)

if not SKILLS_FILE.exists():
    raise RuntimeError(
        f"Missing {SKILLS_FILE.name}. Run precompute_embeddings_local.py before starting the API."
    )

skills_df = pd.read_pickle(SKILLS_FILE)
db_embeddings = np.stack(skills_df["embedding"].values)
embedding_model = SentenceTransformer(EMBEDDING_MODEL)
course_index = CourseSemanticIndex(settings.COURSE_EMBEDDINGS_PATH)
initialize_database()


class JobRequest(BaseModel):
    job_description: str
    job_data: dict[str, Any] | None = None
    include_rag: bool = False


class CoursePathwayRequest(BaseModel):
    target_role_id: int
    user_skills: list[dict[str, Any]] = Field(default_factory=list)
    max_budget: float | None = None
    available_hours_per_week: float | None = None
    preferred_delivery_modes: list[str] = Field(default_factory=list)
    earliest_start_date: str | None = None
    latest_start_date: str | None = None
    preferred_location: str | None = None
    maximum_course_duration: float | None = None
    skills_to_avoid: list[str] = Field(default_factory=list)


class RecommendationFeedbackRequest(BaseModel):
    user_id: str = "anonymous"
    course_id: int
    target_role_id: int | None = None
    feedback_type: str
    reason: str | None = None


class SemanticCourseRecommendationRequest(BaseModel):
    skills: list[str] = Field(min_length=1, max_length=10)
    available_credit: float | None = Field(default=None, ge=0)
    max_budget: float | None = Field(default=None, ge=0)
    maximum_duration_hours: float | None = Field(default=None, gt=0)
    require_upcoming_run: bool = False
    limit: int = Field(default=10, ge=1, le=20)


def get_cosine_similarity(vec1, vec_matrix):
    dot_product = np.dot(vec_matrix, vec1)
    norm_vec1 = np.linalg.norm(vec1)
    norm_matrix = np.linalg.norm(vec_matrix, axis=1)
    denominator = norm_vec1 * norm_matrix
    return np.divide(
        dot_product,
        denominator,
        out=np.zeros_like(dot_product, dtype=float),
        where=denominator != 0,
    )


def get_confidence(score: float):
    """Map cosine similarity to a user-facing confidence band."""
    if score >= 0.55:
        return {
            "tier": "high",
            "label": "High confidence",
            "explanation": "Strong semantic overlap with the official SkillsFuture skill.",
        }
    if score >= 0.35:
        return {
            "tier": "medium",
            "label": "Medium confidence",
            "explanation": "Likely related, but review the official definition before relying on it.",
        }
    return {
        "tier": "low",
        "label": "Low confidence",
        "explanation": "Weak semantic overlap. Treat this as a possible lead, not a confirmed match.",
    }


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


def normalize_extracted_skills(value):
    if not isinstance(value, list):
        return []

    normalized = []
    seen = set()
    for item in value:
        skill = re.sub(r"\s+", " ", str(item)).strip()
        key = skill.casefold()
        if not skill or key in seen:
            continue
        seen.add(key)
        normalized.append(skill[:120])
        if len(normalized) == 5:
            break
    return normalized


def build_rag_recommendation(final_results):
    """Use retrieved SkillsFuture matches as grounding context for one recommendation call."""
    if client is None:
        return None

    grounding_context = []
    for result in final_results[:5]:
        top_match = result["top_matches"][0] if result.get("top_matches") else None
        if not top_match:
            continue
        grounding_context.append({
            "job_skill": result["extracted_skill"],
            "source_evidence": result.get("source_evidence", ""),
            "official_skill_title": top_match["official_skill_title"],
            "official_skill_description": top_match["official_skill_description"],
            "confidence_label": top_match["confidence_label"],
            "is_emerging": top_match["is_emerging"],
        })

    if not grounding_context:
        return None

    rag_prompt = f"""
    You are recommending upskilling priorities using ONLY the retrieved official SkillsFuture skill matches below.
    Do not invent courses, certifications, or facts not present in the context.

    Return ONLY valid JSON with this shape:
    {{
      "summary": "one short paragraph",
      "priority_skills": [
        {{
          "job_skill": "skill from the job",
          "official_skill": "official SkillsFuture skill title",
          "why_it_matched": "grounded explanation using the official description",
          "learning_priority": "High|Medium|Low",
          "next_step": "short practical next step"
        }}
      ]
    }}

    Retrieved context:
    {json.dumps(grounding_context, ensure_ascii=False)}
    """

    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": rag_prompt}],
            temperature=0.2,
        )
        raw_response = (
            response.choices[0].message.content
            .replace("```json", "")
            .replace("```", "")
            .strip()
        )
        rag_response = json.loads(raw_response)
    except Exception:
        return None

    if not isinstance(rag_response, dict):
        return None
    if not isinstance(rag_response.get("priority_skills"), list):
        rag_response["priority_skills"] = []
    return rag_response


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "skills_loaded": len(skills_df),
        "course_database_ready": True,
        "course_semantic_index_ready": course_index.ready,
        "courses_indexed": len(course_index.course_ids),
        "openai_configured": client is not None,
    }


@app.post("/analyze-job")
async def analyze_job(request: JobRequest):
    job_description = request.job_description.strip()
    if len(job_description) < 10:
        raise HTTPException(status_code=400, detail="job_description is too short")
    if client is None:
        raise HTTPException(status_code=503, detail="OpenAI API key is not configured")
    job_description = job_description[:MAX_JOB_DESCRIPTION_LENGTH]

    extract_prompt = f"""
    Extract the top 5 skills, tools, domain requirements, qualifications, or experience requirements from this employer job listing text.
    Use only employer job requirements, responsibilities, qualifications, and required tools.
    Ignore profile prompts, job-match widgets, navigation, footer text, and phrases like "Tell employers what skills you have".
    Return ONLY a raw JSON array of strings, nothing else. Example: ["Python", "REST API", "Cloud Deployment"]
    
    Employer job requirements:
    {job_description}
    """

    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": extract_prompt}],
            temperature=0.0,
        )

        raw_response = (
            response.choices[0].message.content
            .replace("```json", "")
            .replace("```", "")
            .strip()
        )
        extracted_skills = normalize_extracted_skills(json.loads(raw_response))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="OpenAI returned invalid skill JSON") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Skill extraction failed") from exc

    if not extracted_skills:
        raise HTTPException(status_code=502, detail="OpenAI returned no usable skills")

    final_results = []

    for skill in extracted_skills:
        query_vec = embedding_model.encode(skill, normalize_embeddings=True)
        if query_vec.ndim > 1:
            query_vec = query_vec[0]

        similarities = get_cosine_similarity(query_vec, db_embeddings)
        top_3_idx = np.argsort(similarities)[-3:][::-1]
        top_matches = []

        for idx in top_3_idx:
            row = skills_df.iloc[idx]
            similarity_score = float(similarities[idx])
            confidence = get_confidence(similarity_score)
            top_matches.append({
                "official_skill_title": row["skill_title"],
                "official_skill_description": row["skill_description"],
                "similarity_score": similarity_score,
                "confidence_tier": confidence["tier"],
                "confidence_label": confidence["label"],
                "confidence_explanation": confidence["explanation"],
                "is_emerging": bool(row["Emerging Skills"]),
            })

        final_results.append({
            "extracted_skill": skill,
            "source_evidence": find_source_evidence(str(skill), job_description),
            "confidence_tier": top_matches[0]["confidence_tier"] if top_matches else "low",
            "confidence_label": top_matches[0]["confidence_label"] if top_matches else "Low confidence",
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

    response_payload = {
        "results": final_results,
        "matched_skills": [result["extracted_skill"] for result in final_results],
        "missing_skills": [],
        "suitability_score": suitability_score,
        "explanation": "Matched skills are based only on extracted employer responsibilities, requirements, qualifications, and required tools. No user profile skills were provided to calculate personal missing skills.",
    }

    if request.include_rag:
        response_payload["rag_recommendation"] = build_rag_recommendation(final_results)

    return response_payload


@app.get("/api/career-roles")
async def api_career_roles():
    return {"career_roles": get_career_roles()}


@app.get("/api/courses")
async def api_courses(
    keyword: str | None = None,
    skill: str | None = None,
    provider: str | None = None,
    delivery_mode: str | None = None,
    category: str | None = None,
    active_upcoming_runs: bool = False,
):
    return {
        "courses": list_courses(
            keyword=keyword,
            skill=skill,
            provider=provider,
            delivery_mode=delivery_mode,
            category=category,
            active_upcoming_runs=active_upcoming_runs,
        ),
        "attribution": "Course data is imported from local SkillsFuture dataset files. Verify current details with SkillsFuture Singapore. This product is not operated, endorsed, or certified by SSG or the Singapore Government.",
    }


@app.post("/api/recommendations/courses")
async def api_semantic_course_recommendations(request: SemanticCourseRecommendationRequest):
    if not course_index.ready:
        raise HTTPException(
            status_code=503,
            detail="Course semantic index is not built. Run precompute_course_embeddings.py.",
        )

    skills = normalize_extracted_skills(request.skills)
    if not skills:
        raise HTTPException(status_code=400, detail="At least one usable skill is required")

    query_embeddings = embedding_model.encode(
        skills,
        normalize_embeddings=True,
        convert_to_numpy=True,
    )
    recommendations = course_index.search(
        query_embeddings=query_embeddings,
        skills=skills,
        limit=request.limit,
        available_credit=request.available_credit,
        max_budget=request.max_budget,
        maximum_duration_hours=request.maximum_duration_hours,
        require_upcoming_run=request.require_upcoming_run,
    )
    return {
        "skills": skills,
        "recommendations": recommendations,
        "index_model": course_index.model_name,
        "attribution": "Recommendations use local semantic retrieval over imported course data. Verify current course details and funding eligibility with SkillsFuture Singapore.",
    }


@app.get("/api/courses/{course_id}")
async def api_course_detail(course_id: int):
    course = get_course(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return {
        "course": course,
        "attribution": "Course data is imported from local SkillsFuture dataset files. Verify current details with SkillsFuture Singapore. This product is not operated, endorsed, or certified by SSG or the Singapore Government.",
    }


@app.post("/api/recommendations/course-pathway")
async def api_course_pathway(request: CoursePathwayRequest):
    constraints = {
        "max_budget": request.max_budget,
        "available_hours_per_week": request.available_hours_per_week,
        "preferred_delivery_modes": request.preferred_delivery_modes,
        "earliest_start_date": request.earliest_start_date,
        "latest_start_date": request.latest_start_date,
        "preferred_location": request.preferred_location,
        "maximum_course_duration": request.maximum_course_duration,
        "skills_to_avoid": request.skills_to_avoid,
    }
    result = recommend_course_pathway(
        target_role_id=request.target_role_id,
        user_skills=request.user_skills,
        constraints=constraints,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Target role not found")
    return result


@app.post("/api/recommendations/feedback")
async def api_recommendation_feedback(request: RecommendationFeedbackRequest):
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO recommendation_feedback (
                user_id, course_id, target_role_id, feedback_type, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                request.user_id,
                request.course_id,
                request.target_role_id,
                request.feedback_type,
                request.reason,
                utc_now(),
            ),
        )
        conn.commit()
    return {"status": "ok"}
