import json


MAX_TEXT_LENGTH = 700


def bounded_text(value, maximum=MAX_TEXT_LENGTH):
    text = " ".join(str(value or "").split())
    return text[:maximum]


def build_fallback_narrative(pathway):
    stages = []
    for stage in pathway.get("stages", []):
        skill = stage["skill_gap"]["skill"]
        course = stage["course"]
        stages.append({
            "stage": stage["stage"],
            "course_id": course["id"],
            "skill": skill,
            "guidance": (
                f"Complete {course['title']} to address the {skill} gap before moving "
                "to the next stage."
            ),
            "action": stage["practical_action"],
            "outcome": stage["measurable_outcome"],
        })

    return {
        "source": "deterministic",
        "overview": pathway.get("summary", ""),
        "priority_summary": [
            f"{item['skill']} is a priority because the reported level is "
            f"{item['current_level']} and the target is 3."
            for item in pathway.get("prioritized_skill_gaps", [])
        ],
        "stage_guidance": stages,
        "next_step": (
            "Add the first course to the planner and set a realistic target start date."
            if stages
            else "Review the proficiency levels before generating a pathway."
        ),
    }


def build_grounding_context(pathway, target_role=None):
    stages = []
    for stage in pathway.get("stages", []):
        course = stage["course"]
        stages.append({
            "stage": stage["stage"],
            "stage_label": stage["stage_label"],
            "skill_gap": stage["skill_gap"],
            "job_skill": stage["skill_gap"].get("job_skill", ""),
            "job_evidence": stage["skill_gap"].get("source_evidence", ""),
            "course": {
                "id": course["id"],
                "title": course["title"],
                "provider_name": course.get("provider_name", ""),
                "description": bounded_text(course.get("description"), 1000),
                "objectives": bounded_text(course.get("objectives"), 1000),
            },
            "dataset_logic": {
                "semantic_score": stage["semantic_score"],
                "confidence_label": stage["confidence_label"],
                "has_upcoming_run": stage["has_upcoming_run"],
                "estimated_fee": stage["estimated_fee"],
                "credit_used": stage["credit_used"],
                "cash_required": stage["cash_required"],
                "duration_hours": stage["duration_hours"],
                "why_this_stage": stage["why_this_stage"],
                "why_this_course": stage["why_this_course"],
            },
        })
    return {
        "target_role": bounded_text(target_role, 160),
        "stages": stages,
        "totals": pathway.get("totals", {}),
        "assumptions": pathway.get("assumptions", []),
    }


def validate_narrative(payload, pathway):
    if not isinstance(payload, dict):
        raise ValueError("Narrative response must be an object")

    expected_stages = pathway.get("stages", [])
    returned_stages = payload.get("stage_guidance")
    if not isinstance(returned_stages, list) or len(returned_stages) != len(expected_stages):
        raise ValueError("Narrative stage count does not match the pathway")

    valid_skills = {
        item["skill"].casefold(): item["skill"]
        for item in pathway.get("prioritized_skill_gaps", [])
    }
    validated_stages = []
    for expected, returned in zip(expected_stages, returned_stages):
        if not isinstance(returned, dict):
            raise ValueError("Narrative stage must be an object")
        if int(returned.get("stage", -1)) != expected["stage"]:
            raise ValueError("Narrative stage order changed")
        if int(returned.get("course_id", -1)) != expected["course"]["id"]:
            raise ValueError("Narrative referenced an invalid course ID")
        skill_key = bounded_text(returned.get("skill"), 120).casefold()
        if skill_key != expected["skill_gap"]["skill"].casefold():
            raise ValueError("Narrative referenced an invalid skill")

        validated_stages.append({
            "stage": expected["stage"],
            "course_id": expected["course"]["id"],
            "skill": valid_skills[skill_key],
            "guidance": bounded_text(returned.get("guidance")),
            "action": bounded_text(returned.get("action"), 400),
            "outcome": bounded_text(returned.get("outcome"), 400),
        })

    priorities = payload.get("priority_summary", [])
    if not isinstance(priorities, list):
        priorities = []

    return {
        "source": "llm",
        "overview": bounded_text(payload.get("overview"), 900),
        "priority_summary": [bounded_text(item, 300) for item in priorities[:3] if bounded_text(item, 300)],
        "stage_guidance": validated_stages,
        "next_step": bounded_text(payload.get("next_step"), 400),
    }


def generate_grounded_pathway_narrative(client, model, pathway, target_role=None):
    fallback = build_fallback_narrative(pathway)
    if client is None or not pathway.get("stages"):
        return fallback

    context = build_grounding_context(pathway, target_role)
    prompt = f"""
You are writing a concise career learning plan using ONLY the supplied evidence.

Rules:
- Do not add, remove, reorder, or replace courses.
- Use the exact stage number, course_id, and skill for every stage.
- Do not change fees, credit, cash, duration, scores, or availability.
- Do not claim funding eligibility, guaranteed employment, or certification outcomes.
- Explain why the sequence is practical and give one specific action and measurable outcome.
- Return only valid JSON.

Required JSON shape:
{{
  "overview": "readable two-to-three sentence career plan",
  "priority_summary": ["up to three concise evidence-grounded priorities"],
  "stage_guidance": [
    {{
      "stage": 1,
      "course_id": 123,
      "skill": "exact supplied skill",
      "guidance": "why this stage helps and why it comes here",
      "action": "one concrete action",
      "outcome": "one measurable outcome"
    }}
  ],
  "next_step": "one immediate next step"
}}

Grounding evidence:
{json.dumps(context, ensure_ascii=False)}
"""

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content
        return validate_narrative(json.loads(raw), pathway)
    except Exception:
        return fallback
