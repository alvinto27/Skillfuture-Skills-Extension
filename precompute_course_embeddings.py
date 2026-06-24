import argparse
from datetime import datetime, timezone

import numpy as np
from sentence_transformers import SentenceTransformer

import skillsfuture_config as settings
from course_semantic_search import build_course_embedding_text
from skillsfuture_db import connect


DEFAULT_MODEL = "all-MiniLM-L6-v2"


def load_courses():
    conn = connect()
    try:
        return [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, title, description, objectives, category, level, updated_at
                FROM courses
                WHERE is_active = 1
                ORDER BY id
                """
            ).fetchall()
        ]
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Build the local semantic course index")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()

    courses = load_courses()
    if not courses:
        raise SystemExit("No active courses found. Run sync_skillsfuture_data.py first.")

    texts = [build_course_embedding_text(course) for course in courses]
    model = SentenceTransformer(args.model)
    embeddings = model.encode(
        texts,
        batch_size=args.batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype(np.float32, copy=False)
    course_ids = np.asarray([course["id"] for course in courses], dtype=np.int64)
    source_max_updated_at = max(
        (str(course.get("updated_at") or "") for course in courses),
        default="",
    )

    target = settings.COURSE_EMBEDDINGS_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        target,
        course_ids=course_ids,
        embeddings=embeddings,
        model_name=np.asarray(args.model),
        generated_at=np.asarray(datetime.now(timezone.utc).isoformat()),
        source_course_count=np.asarray(len(course_ids), dtype=np.int64),
        source_max_updated_at=np.asarray(source_max_updated_at),
    )
    print(f"Saved {len(course_ids)} course embeddings to {target}")


if __name__ == "__main__":
    main()
