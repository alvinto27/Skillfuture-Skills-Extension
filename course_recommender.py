import json
from datetime import date, datetime

from skillsfuture_db import connect, rows_to_dicts, row_to_dict, json_loads, utc_now


DEFAULT_WEIGHTS = {
    "skill_gap_coverage": 0.45,
    "role_relevance": 0.20,
    "constraint_fit": 0.15,
    "difficulty_fit": 0.10,
    "run_availability": 0.10,
}


def parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def get_career_roles():
    conn = connect()
    try:
        return rows_to_dicts(conn.execute(
            "SELECT id, title, sector, description, is_active FROM career_roles WHERE is_active = 1 ORDER BY title"
        ).fetchall())
    finally:
        conn.close()


def list_courses(keyword=None, skill=None, provider=None, delivery_mode=None, category=None, active_upcoming_runs=False):
    filters = ["c.is_active = 1"]
    params = []
    joins = []
    if keyword:
        filters.append("(lower(c.title) LIKE ? OR lower(c.description) LIKE ?)")
        params.extend([f"%{keyword.lower()}%", f"%{keyword.lower()}%"])
    if provider:
        filters.append("lower(c.provider_name) LIKE ?")
        params.append(f"%{provider.lower()}%")
    if category:
        filters.append("lower(c.category) LIKE ?")
        params.append(f"%{category.lower()}%")
    if skill:
        joins.append("JOIN course_skills cs_filter ON cs_filter.course_id = c.id")
        joins.append("JOIN skills s_filter ON s_filter.id = cs_filter.skill_id")
        filters.append("lower(s_filter.canonical_name) LIKE ?")
        params.append(f"%{skill.lower()}%")
    if delivery_mode or active_upcoming_runs:
        joins.append("JOIN course_runs cr_filter ON cr_filter.course_id = c.id AND cr_filter.is_active = 1")
        if delivery_mode:
            filters.append("lower(cr_filter.delivery_mode) LIKE ?")
            params.append(f"%{delivery_mode.lower()}%")
        if active_upcoming_runs:
            filters.append("(cr_filter.start_date IS NULL OR cr_filter.start_date >= ?)")
            params.append(date.today().isoformat())

    sql = f"""
        SELECT DISTINCT c.*
        FROM courses c
        {' '.join(joins)}
        WHERE {' AND '.join(filters)}
        ORDER BY c.title
        LIMIT 100
    """
    conn = connect()
    try:
        return rows_to_dicts(conn.execute(sql, params).fetchall())
    finally:
        conn.close()


def get_course(course_id):
    conn = connect()
    try:
        course = row_to_dict(conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone())
        if not course:
            return None
        course["runs"] = rows_to_dicts(conn.execute(
            "SELECT * FROM course_runs WHERE course_id = ? AND is_active = 1 ORDER BY start_date",
            (course_id,),
        ).fetchall())
        course["skills"] = rows_to_dicts(conn.execute(
            """
            SELECT s.canonical_name, cs.coverage_score, cs.confidence, cs.source, cs.evidence_text
            FROM course_skills cs
            JOIN skills s ON s.id = cs.skill_id
            WHERE cs.course_id = ?
            ORDER BY cs.coverage_score DESC
            """,
            (course_id,),
        ).fetchall())
        return course
    finally:
        conn.close()


def get_role_skill_gaps(conn, target_role_id, user_skills):
    rows = conn.execute(
        """
        SELECT rs.skill_id, rs.required_level, rs.importance_weight, s.canonical_name
        FROM role_skills rs
        JOIN skills s ON s.id = rs.skill_id
        WHERE rs.career_role_id = ?
        """,
        (target_role_id,),
    ).fetchall()
    skill_name_to_level = {
        str(item.get("canonical_name", "")).lower(): int(item.get("current_level", 0))
        for item in user_skills or []
        if item.get("canonical_name")
    }
    gaps = []
    for row in rows:
        current_level = skill_name_to_level.get(row["canonical_name"].lower(), 0)
        gap = max(int(row["required_level"]) - current_level, 0) * float(row["importance_weight"])
        if gap > 0:
            gaps.append({
                "skill_id": row["skill_id"],
                "canonical_name": row["canonical_name"],
                "required_level": int(row["required_level"]),
                "current_level": current_level,
                "importance_weight": float(row["importance_weight"]),
                "gap_score": gap,
            })
    return gaps


def get_best_future_run(runs, constraints):
    today = date.today()
    earliest = parse_date(constraints.get("earliest_start_date"))
    latest = parse_date(constraints.get("latest_start_date"))
    preferred_modes = {mode.lower() for mode in constraints.get("preferred_delivery_modes", [])}
    preferred_location = str(constraints.get("preferred_location") or "").lower()

    candidates = []
    for run in runs:
        start = parse_date(run.get("start_date"))
        deadline = parse_date(run.get("registration_deadline"))
        if start and start < today:
            continue
        if deadline and deadline < today:
            continue
        if earliest and start and start < earliest:
            continue
        if latest and start and start > latest:
            continue
        if preferred_modes and str(run.get("delivery_mode") or "").lower() not in preferred_modes:
            continue
        if preferred_location and preferred_location not in str(run.get("venue") or "").lower():
            continue
        candidates.append(run)
    return candidates[0] if candidates else None


def recommend_course_pathway(target_role_id, user_skills=None, constraints=None):
    constraints = constraints or {}
    conn = connect()
    try:
        role = row_to_dict(conn.execute("SELECT * FROM career_roles WHERE id = ?", (target_role_id,)).fetchone())
        if not role:
            return None

        gaps = get_role_skill_gaps(conn, target_role_id, user_skills or [])
        gap_by_skill = {gap["skill_id"]: gap for gap in gaps}
        total_gap = sum(gap["gap_score"] for gap in gaps) or 1.0

        courses = conn.execute(
            """
            SELECT c.*
            FROM courses c
            WHERE c.is_active = 1
            ORDER BY c.title
            """
        ).fetchall()

        scored = []
        for course in courses:
            course_skills = conn.execute(
                """
                SELECT cs.*, s.canonical_name
                FROM course_skills cs
                JOIN skills s ON s.id = cs.skill_id
                WHERE cs.course_id = ?
                """,
                (course["id"],),
            ).fetchall()
            addressed = [dict(skill) for skill in course_skills if skill["skill_id"] in gap_by_skill]
            if not addressed:
                continue

            runs = rows_to_dicts(conn.execute(
                "SELECT * FROM course_runs WHERE course_id = ? AND is_active = 1 ORDER BY start_date",
                (course["id"],),
            ).fetchall())
            best_run = get_best_future_run(runs, constraints)
            if not best_run:
                continue

            covered_gap = sum(
                gap_by_skill[item["skill_id"]]["gap_score"] * float(item["coverage_score"])
                for item in addressed
            )
            skill_gap_score = min(covered_gap / total_gap, 1.0)
            role_relevance = min(len(addressed) / max(len(gaps), 1), 1.0)
            constraint_fit = 1.0
            difficulty_fit = 0.8
            run_availability = 1.0
            score_parts = {
                "skill_gap_coverage": round(skill_gap_score * DEFAULT_WEIGHTS["skill_gap_coverage"] * 100, 2),
                "target_role_relevance": round(role_relevance * DEFAULT_WEIGHTS["role_relevance"] * 100, 2),
                "constraint_fit": round(constraint_fit * DEFAULT_WEIGHTS["constraint_fit"] * 100, 2),
                "difficulty_fit": round(difficulty_fit * DEFAULT_WEIGHTS["difficulty_fit"] * 100, 2),
                "run_availability": round(run_availability * DEFAULT_WEIGHTS["run_availability"] * 100, 2),
            }
            total_score = round(sum(score_parts.values()), 2)
            scored.append({
                "course": dict(course),
                "run": best_run,
                "total_score": total_score,
                "score_contribution": score_parts,
                "missing_skills_addressed": [
                    {
                        "skill": item["canonical_name"],
                        "gap_score": gap_by_skill[item["skill_id"]]["gap_score"],
                        "coverage_score": item["coverage_score"],
                        "evidence": item["evidence_text"],
                    }
                    for item in addressed
                ],
                "unmet_prerequisites": [],
                "plain_language_explanation": (
                    f"This course addresses {len(addressed)} missing skill(s) for the {role['title']} role "
                    "and has an available future run."
                ),
                "source": dict(course).get("source") or "skillsfuture.local_excel",
            })

        scored.sort(key=lambda item: (-item["total_score"], item["course"]["title"]))
        selected = scored[:5]
        stages = ["foundation", "core capability", "applied capability", "optional portfolio or practice milestone"]
        pathway = []
        for index, recommendation in enumerate(selected):
            recommendation["pathway_stage"] = stages[min(index, len(stages) - 1)]
            recommendation["alternatives"] = [
                {
                    "course_id": alt["course"]["id"],
                    "title": alt["course"]["title"],
                    "total_score": alt["total_score"],
                }
                for alt in scored[index + 1:index + 3]
            ]
            pathway.append(recommendation)

        return {
            "target_role": role,
            "skill_gaps": gaps,
            "pathway": pathway,
            "generated_at": utc_now(),
            "attribution": "Course data is imported from local SkillsFuture dataset files. Verify current details with SkillsFuture Singapore. This product is not operated, endorsed, or certified by SSG or the Singapore Government.",
        }
    finally:
        conn.close()
