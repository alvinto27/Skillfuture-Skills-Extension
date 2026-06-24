from pathlib import Path

import numpy as np
import pandas as pd


def load_skill_index(path):
    path = Path(path)
    if not path.exists():
        return pd.DataFrame(), np.empty((0, 0), dtype=np.float32), "Skill index file is missing"
    try:
        frame = pd.read_pickle(path)
        required_columns = {
            "skill_title",
            "skill_description",
            "Emerging Skills",
            "embedding",
        }
        missing_columns = required_columns.difference(frame.columns)
        if missing_columns:
            raise ValueError(f"missing columns: {', '.join(sorted(missing_columns))}")
        embeddings = np.stack(frame["embedding"].values).astype(np.float32, copy=False)
        if embeddings.ndim != 2 or len(embeddings) != len(frame):
            raise ValueError("invalid embedding matrix")
        return frame, embeddings, ""
    except Exception as exc:
        return (
            pd.DataFrame(),
            np.empty((0, 0), dtype=np.float32),
            f"Skill index could not be loaded: {type(exc).__name__}",
        )
