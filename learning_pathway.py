import math


STAGE_DEFINITIONS = [
    {
        "key": "foundation",
        "label": "Foundation",
        "action": "Complete the course and document three practical examples of {skill}.",
        "outcome": "Explain the core concepts of {skill} and complete one guided exercise.",
    },
    {
        "key": "core_capability",
        "label": "Core Capability",
        "action": "Apply {skill} in a small project based on a realistic work task.",
        "outcome": "Produce one working project artifact that demonstrates {skill}.",
    },
    {
        "key": "applied_evidence",
        "label": "Applied Evidence",
        "action": "Publish or present evidence of {skill} and add it to your resume or portfolio.",
        "outcome": "Create one reviewable portfolio artifact and describe its result.",
    },
]


def normalize_skill_gaps(skill_gaps):
    normalized = []
    seen = set()
    for item in skill_gaps or []:
        skill = " ".join(str(item.get("skill") or "").split())[:120]
        if not skill:
            continue
        key = skill.casefold()
        if key in seen:
            continue
        seen.add(key)
        current_level = max(0, min(int(item.get("current_level", 0)), 3))
        gap = max(3 - current_level, 0)
        if gap == 0:
            continue
        normalized.append({
            "skill": skill,
            "current_level": current_level,
            "gap": gap,
        })
    normalized.sort(key=lambda item: (-item["gap"], item["skill"].casefold()))
    return normalized[:3]


def allocate_cost(fee, remaining_credit):
    estimated_fee = max(float(fee or 0), 0)
    credit_used = min(estimated_fee, remaining_credit)
    return {
        "estimated_fee": round(estimated_fee, 2),
        "credit_used": round(credit_used, 2),
        "cash_required": round(estimated_fee - credit_used, 2),
        "remaining_credit": round(remaining_credit - credit_used, 2),
    }


def compact_recommendation(recommendation):
    if not recommendation:
        return None
    return {
        "course": recommendation["course"],
        "semantic_score": recommendation["semantic_score"],
        "confidence_label": recommendation["confidence_label"],
        "estimated_fee": recommendation["estimated_fee"],
        "duration_hours": recommendation["duration_hours"],
        "has_upcoming_run": recommendation["has_upcoming_run"],
        "explanation": recommendation["explanation"],
    }


def build_actionable_pathway(
    course_index,
    embedding_model,
    skill_gaps,
    available_credit=0,
    monthly_hours=20,
    maximum_duration_hours=None,
):
    gaps = normalize_skill_gaps(skill_gaps)
    remaining_credit = max(float(available_credit or 0), 0)
    monthly_hours = max(float(monthly_hours or 1), 1)
    selected_course_ids = set()
    reserved_alternative_ids = set()
    stages = []

    for stage_index, gap in enumerate(gaps):
        query_embedding = embedding_model.encode(
            [gap["skill"]],
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        candidates = course_index.search(
            query_embeddings=query_embedding,
            skills=[gap["skill"]],
            limit=10,
            available_credit=remaining_credit,
            maximum_duration_hours=maximum_duration_hours,
        )
        primary = next(
            (
                item for item in candidates
                if item["course"]["id"] not in selected_course_ids
                and item["course"]["id"] not in reserved_alternative_ids
            ),
            None,
        )
        if not primary:
            continue

        selected_course_ids.add(primary["course"]["id"])
        alternative = next(
            (
                item for item in candidates
                if item["course"]["id"] not in selected_course_ids
                and item["course"]["id"] not in reserved_alternative_ids
            ),
            None,
        )
        if alternative:
            reserved_alternative_ids.add(alternative["course"]["id"])

        stage_definition = STAGE_DEFINITIONS[min(stage_index, len(STAGE_DEFINITIONS) - 1)]
        cost = allocate_cost(primary["estimated_fee"], remaining_credit)
        remaining_credit = cost.pop("remaining_credit")
        duration_hours = float(primary["duration_hours"] or 0)
        duration_months = max(1, math.ceil(duration_hours / monthly_hours)) if duration_hours else 1

        stages.append({
            "stage": stage_index + 1,
            "stage_key": stage_definition["key"],
            "stage_label": stage_definition["label"],
            "title": f"Build {gap['skill']}",
            "priority": "High" if gap["gap"] >= 2 else "Medium",
            "skill_gap": gap,
            "course": primary["course"],
            "alternative": compact_recommendation(alternative),
            "semantic_score": primary["semantic_score"],
            "confidence_label": primary["confidence_label"],
            "has_upcoming_run": primary["has_upcoming_run"],
            "why_this_course": (
                f"{primary['confidence_label']} for the {gap['skill']} gap "
                f"({round(primary['semantic_score'] * 100)}% semantic similarity). "
                f"The user reported level {gap['current_level']} against a target level of 3."
            ),
            "why_this_stage": (
                "Start with the largest remaining proficiency gap."
                if stage_index == 0
                else "Continue after the previous stage to broaden job readiness without adding overlapping courses."
            ),
            "practical_action": stage_definition["action"].format(skill=gap["skill"]),
            "measurable_outcome": stage_definition["outcome"].format(skill=gap["skill"]),
            "duration_hours": round(duration_hours, 2),
            "estimated_months": duration_months,
            **cost,
        })

    total_fee = round(sum(stage["estimated_fee"] for stage in stages), 2)
    total_credit_used = round(sum(stage["credit_used"] for stage in stages), 2)
    total_cash_required = round(sum(stage["cash_required"] for stage in stages), 2)
    total_hours = round(sum(stage["duration_hours"] for stage in stages), 2)

    return {
        "summary": (
            f"A {len(stages)}-stage pathway focused on the highest-priority proficiency gaps."
            if stages
            else "No pathway was generated because no course matched the remaining skill gaps."
        ),
        "prioritized_skill_gaps": gaps,
        "stages": stages,
        "totals": {
            "estimated_fee": total_fee,
            "credit_used": total_credit_used,
            "cash_required": total_cash_required,
            "remaining_credit": round(remaining_credit, 2),
            "learning_hours": total_hours,
            "estimated_months": max(1, math.ceil(total_hours / monthly_hours)) if total_hours else 0,
        },
        "assumptions": [
            "Target proficiency is level 3 (Proficient).",
            "Credit is allocated in pathway order.",
            "Fees and availability come from the imported local dataset and must be verified.",
        ],
    }
