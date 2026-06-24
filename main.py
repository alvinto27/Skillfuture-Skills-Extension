import asyncio
import hashlib
import json
import logging
import math
import re
import secrets
import time
from pathlib import Path
from typing import Any, Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import OpenAI
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

import skillsfuture_config as settings
from course_semantic_search import CourseSemanticIndex
from course_recommender import (
    count_courses,
    get_career_roles,
    get_course,
    list_courses,
    recommend_course_pathway,
)
from learning_pathway import build_actionable_pathway
from pathway_narrative import generate_grounded_pathway_narrative
from reliability import (
    SlidingWindowRateLimiter,
    TTLCache,
    log_event,
    request_id,
    run_with_timeout,
)
from skill_index import load_skill_index
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

OPENAI_API_KEY = CONFIG_OPENAI_API_KEY
client = (
    OpenAI(
        api_key=OPENAI_API_KEY,
        timeout=settings.OPENAI_TIMEOUT_SECONDS,
        max_retries=settings.OPENAI_MAX_RETRIES,
    )
    if OPENAI_API_KEY
    else None
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
app = FastAPI(title="SkillsFuture Job Skill Matcher", version="0.5.0")

cors_origins = []
if settings.EXTENSION_ID:
    cors_origins.append(f"chrome-extension://{settings.EXTENSION_ID}")
if settings.ALLOW_LOCAL_DEVELOPMENT_ORIGINS:
    cors_origins.extend([
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "null",
    ])

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=(
        r"^chrome-extension://[a-z]{32}$|^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^file://.*$"
        if settings.ALLOW_LOCAL_DEVELOPMENT_ORIGINS
        else None
    ),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Authorization", "Content-Type", "X-Request-ID"],
)

skills_df, db_embeddings, skill_index_error = load_skill_index(SKILLS_FILE)
embedding_model = SentenceTransformer(EMBEDDING_MODEL)
course_index = CourseSemanticIndex(settings.COURSE_EMBEDDINGS_PATH)
database_error = ""
try:
    initialize_database()
except Exception as exc:
    database_error = f"Course database could not be initialized: {type(exc).__name__}"

job_analysis_cache = TTLCache(
    max_size=settings.JOB_ANALYSIS_CACHE_MAX_SIZE,
    ttl_seconds=settings.JOB_ANALYSIS_CACHE_TTL_SECONDS,
)
query_embedding_cache = TTLCache(
    max_size=settings.QUERY_EMBEDDING_CACHE_MAX_SIZE,
    ttl_seconds=settings.QUERY_EMBEDDING_CACHE_TTL_SECONDS,
)
rate_limiter = SlidingWindowRateLimiter(
    limit=settings.RATE_LIMIT_REQUESTS,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
RATE_LIMITED_PATHS = {
    "/analyze-job",
    "/api/recommendations/courses",
    "/api/recommendations/learning-pathway",
    "/api/recommendations/course-pathway",
}


@app.middleware("http")
async def reliability_middleware(request: Request, call_next):
    current_request_id = request.headers.get("x-request-id") or request_id()
    started = time.perf_counter()
    client_host = request.client.host if request.client else "unknown"
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            request_size = int(content_length)
        except ValueError:
            request_size = settings.MAX_REQUEST_BODY_BYTES + 1
        if request_size > settings.MAX_REQUEST_BODY_BYTES:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request body is too large."},
                headers={"X-Request-ID": current_request_id},
            )

    if settings.API_ACCESS_TOKEN and request.url.path != "/health":
        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        authenticated = (
            scheme.casefold() == "bearer"
            and token
            and secrets.compare_digest(token, settings.API_ACCESS_TOKEN)
        )
        if not authenticated:
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required."},
                headers={
                    "WWW-Authenticate": "Bearer",
                    "X-Request-ID": current_request_id,
                },
            )

    if request.url.path in RATE_LIMITED_PATHS:
        allowed, retry_after = rate_limiter.check(f"{client_host}:{request.url.path}")
        if not allowed:
            log_event(
                "rate_limited",
                request_id=current_request_id,
                method=request.method,
                path=request.url.path,
                client=client_host,
            )
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Try again shortly."},
                headers={
                    "Retry-After": str(retry_after),
                    "X-Request-ID": current_request_id,
                },
            )

    try:
        response = await asyncio.wait_for(
            call_next(request),
            timeout=settings.API_REQUEST_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        response = JSONResponse(
            status_code=504,
            content={"detail": "The request timed out. Try again."},
        )
    except Exception:
        log_event(
            "unhandled_error",
            request_id=current_request_id,
            method=request.method,
            path=request.url.path,
            client=client_host,
        )
        response = JSONResponse(
            status_code=500,
            content={"detail": "An internal server error occurred."},
        )

    response.headers["X-Request-ID"] = current_request_id
    log_event(
        "request_completed",
        request_id=current_request_id,
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
        client=client_host,
    )
    return response


class JobRequest(BaseModel):
    job_description: str = Field(min_length=10, max_length=MAX_JOB_DESCRIPTION_LENGTH)
    job_data: dict[str, Any] | None = None
    include_rag: bool = False


class UserSkillInput(BaseModel):
    canonical_name: str = Field(min_length=1, max_length=120)
    current_level: int = Field(ge=0, le=5)


class CoursePathwayRequest(BaseModel):
    target_role_id: int = Field(gt=0)
    user_skills: list[UserSkillInput] = Field(default_factory=list, max_length=100)
    max_budget: float | None = Field(default=None, ge=0, le=1_000_000)
    available_hours_per_week: float | None = Field(default=None, gt=0, le=168)
    preferred_delivery_modes: list[str] = Field(default_factory=list, max_length=20)
    earliest_start_date: str | None = Field(default=None, max_length=10)
    latest_start_date: str | None = Field(default=None, max_length=10)
    preferred_location: str | None = Field(default=None, max_length=160)
    maximum_course_duration: float | None = Field(default=None, gt=0, le=100_000)
    skills_to_avoid: list[str] = Field(default_factory=list, max_length=100)


class RecommendationFeedbackRequest(BaseModel):
    course_id: int = Field(gt=0)
    target_role_id: int | None = Field(default=None, gt=0)
    feedback_type: Literal["relevant", "not_relevant"]
    reason: str | None = Field(default=None, max_length=500)


class SemanticCourseRecommendationRequest(BaseModel):
    skills: list[str] = Field(min_length=1, max_length=10)
    available_credit: float | None = Field(default=None, ge=0)
    max_budget: float | None = Field(default=None, ge=0)
    maximum_duration_hours: float | None = Field(default=None, gt=0)
    require_upcoming_run: bool = False
    limit: int = Field(default=10, ge=1, le=20)


class SkillGapInput(BaseModel):
    skill: str = Field(min_length=1, max_length=120)
    current_level: int = Field(ge=0, le=3)
    job_skill: str = Field(default="", max_length=120)
    source_evidence: str = Field(default="", max_length=500)


class ActionablePathwayRequest(BaseModel):
    skill_gaps: list[SkillGapInput] = Field(min_length=1, max_length=10)
    available_credit: float = Field(default=0, ge=0)
    monthly_hours: float = Field(default=20, gt=0, le=744)
    maximum_duration_hours: float | None = Field(default=None, gt=0, le=100_000)
    target_role: str = Field(default="", max_length=160)
    include_narrative: bool = False


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


def get_query_embeddings(skills):
    normalized_key = tuple(skill.casefold() for skill in skills)
    cached = query_embedding_cache.get(normalized_key)
    if cached is not None:
        return np.asarray(cached, dtype=np.float32), True
    embeddings = embedding_model.encode(
        skills,
        normalize_embeddings=True,
        convert_to_numpy=True,
    )
    embeddings = np.asarray(embeddings, dtype=np.float32)
    query_embedding_cache.set(normalized_key, embeddings)
    return embeddings, False


class CachedEmbeddingModel:
    def encode(self, skills, **_kwargs):
        embeddings, _ = get_query_embeddings(list(skills))
        return embeddings


cached_embedding_model = CachedEmbeddingModel()


def course_index_status():
    return course_index.freshness()


def require_course_index():
    status = course_index_status()
    if status["status"] == "unavailable":
        raise HTTPException(
            status_code=503,
            detail="Course semantic index is unavailable. Run precompute_course_embeddings.py.",
        )
    if status["stale"]:
        raise HTTPException(
            status_code=503,
            detail="Course semantic index is stale. Run precompute_course_embeddings.py.",
        )
    return status


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
    index_status = course_index_status()
    healthy = not skill_index_error and not database_error and not index_status["stale"]
    return {
        "status": "ok" if healthy else "degraded",
        "skills_loaded": len(skills_df),
        "skill_index_error": skill_index_error or None,
        "course_database_ready": not database_error,
        "course_database_error": database_error or None,
        "course_semantic_index_ready": course_index.ready,
        "course_semantic_index": index_status,
        "courses_indexed": len(course_index.course_ids),
        "openai_configured": client is not None,
        "cache": {
            "job_analyses": len(job_analysis_cache),
            "query_embeddings": len(query_embedding_cache),
        },
    }


def analyze_job_uncached(job_description, include_rag=False):
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

    if include_rag:
        response_payload["rag_recommendation"] = build_rag_recommendation(final_results)

    return response_payload


@app.post("/analyze-job")
async def analyze_job(request: JobRequest):
    job_description = request.job_description.strip()
    if len(job_description) < 10:
        raise HTTPException(status_code=400, detail="job_description is too short")
    if skill_index_error:
        raise HTTPException(status_code=503, detail=skill_index_error)
    if client is None:
        raise HTTPException(status_code=503, detail="OpenAI API key is not configured")
    job_description = job_description[:MAX_JOB_DESCRIPTION_LENGTH]
    content_hash = hashlib.sha256(job_description.encode("utf-8")).hexdigest()
    cache_key = (content_hash, bool(request.include_rag))
    cached = job_analysis_cache.get(cache_key)
    if cached is not None:
        cached["cache_status"] = "hit"
        return cached

    try:
        response_payload = await run_with_timeout(
            analyze_job_uncached,
            job_description,
            request.include_rag,
            timeout_seconds=settings.API_REQUEST_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Job analysis timed out. Try again.") from exc
    job_analysis_cache.set(cache_key, response_payload)
    response_payload["cache_status"] = "miss"
    return response_payload


@app.get("/api/career-roles")
async def api_career_roles():
    return {"career_roles": get_career_roles()}


@app.get("/api/courses")
async def api_courses(
    keyword: str | None = Query(default=None, max_length=160),
    skill: str | None = Query(default=None, max_length=120),
    provider: str | None = Query(default=None, max_length=160),
    delivery_mode: str | None = Query(default=None, max_length=80),
    category: str | None = Query(default=None, max_length=120),
    active_upcoming_runs: bool = False,
    page: int = Query(default=1, ge=1, le=100_000),
    page_size: int = Query(default=20, ge=1, le=100),
):
    filters = {
        "keyword": keyword,
        "skill": skill,
        "provider": provider,
        "delivery_mode": delivery_mode,
        "category": category,
        "active_upcoming_runs": active_upcoming_runs,
    }
    total = count_courses(**filters)
    return {
        "courses": list_courses(
            **filters,
            limit=page_size,
            offset=(page - 1) * page_size,
        ),
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": math.ceil(total / page_size) if total else 0,
        },
        "attribution": "Course data is imported from local SkillsFuture dataset files. Verify current details with SkillsFuture Singapore. This product is not operated, endorsed, or certified by SSG or the Singapore Government.",
    }


@app.post("/api/recommendations/courses")
async def api_semantic_course_recommendations(request: SemanticCourseRecommendationRequest):
    index_status = require_course_index()

    skills = normalize_extracted_skills(request.skills)
    if not skills:
        raise HTTPException(status_code=400, detail="At least one usable skill is required")

    try:
        query_embeddings, cache_hit = await run_with_timeout(
            get_query_embeddings,
            skills,
            timeout_seconds=settings.API_REQUEST_TIMEOUT_SECONDS,
        )
        recommendations = await run_with_timeout(
            course_index.search,
            query_embeddings=query_embeddings,
            skills=skills,
            limit=request.limit,
            available_credit=request.available_credit,
            max_budget=request.max_budget,
            maximum_duration_hours=request.maximum_duration_hours,
            require_upcoming_run=request.require_upcoming_run,
            timeout_seconds=settings.API_REQUEST_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Course recommendation timed out. Try again.") from exc
    return {
        "skills": skills,
        "recommendations": recommendations,
        "index_model": course_index.model_name,
        "index_status": index_status,
        "embedding_cache_status": "hit" if cache_hit else "miss",
        "attribution": "Recommendations use local semantic retrieval over imported course data. Verify current course details and funding eligibility with SkillsFuture Singapore.",
    }


@app.post("/api/recommendations/learning-pathway")
async def api_actionable_learning_pathway(request: ActionablePathwayRequest):
    index_status = require_course_index()

    try:
        pathway = await run_with_timeout(
            build_actionable_pathway,
            course_index=course_index,
            embedding_model=cached_embedding_model,
            skill_gaps=[item.model_dump() for item in request.skill_gaps],
            available_credit=request.available_credit,
            monthly_hours=request.monthly_hours,
            maximum_duration_hours=request.maximum_duration_hours,
            timeout_seconds=settings.API_REQUEST_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Pathway generation timed out. Try again.") from exc
    if request.include_narrative:
        try:
            narrative = await run_with_timeout(
                generate_grounded_pathway_narrative,
                client=client,
                model=OPENAI_MODEL,
                pathway=pathway,
                target_role=request.target_role,
                timeout_seconds=settings.API_REQUEST_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            narrative = generate_grounded_pathway_narrative(
                client=None,
                model=OPENAI_MODEL,
                pathway=pathway,
                target_role=request.target_role,
            )
    else:
        narrative = None
    return {
        **pathway,
        "narrative": narrative,
        "index_status": index_status,
        "attribution": "Pathway stages use local semantic retrieval, self-reported proficiency gaps, and deterministic fee and credit calculations.",
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
        user_skills=[item.model_dump() for item in request.user_skills],
        constraints=constraints,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Target role not found")
    return result


@app.post("/api/recommendations/feedback")
async def api_recommendation_feedback(request: RecommendationFeedbackRequest):
    with connect() as conn:
        if not conn.execute(
            "SELECT 1 FROM courses WHERE id = ? AND is_active = 1",
            (request.course_id,),
        ).fetchone():
            raise HTTPException(status_code=404, detail="Course not found")
        if request.target_role_id is not None and not conn.execute(
            "SELECT 1 FROM career_roles WHERE id = ? AND is_active = 1",
            (request.target_role_id,),
        ).fetchone():
            raise HTTPException(status_code=404, detail="Target role not found")
        conn.execute(
            """
            INSERT INTO recommendation_feedback (
                user_id, course_id, target_role_id, feedback_type, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "local-user",
                request.course_id,
                request.target_role_id,
                request.feedback_type,
                request.reason,
                utc_now(),
            ),
        )
        conn.commit()
    return {"status": "ok"}
