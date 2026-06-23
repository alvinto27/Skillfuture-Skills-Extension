from pathlib import Path

import pandas as pd
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parent
INPUT_FILE = PROJECT_ROOT / "jobsandskills-skillsfuture-unique-skills-list.xlsx"
SHEET_NAME = "Unique Skills List"
OUTPUT_FILE = PROJECT_ROOT / "skills_with_local_embeddings.pkl"
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BATCH_SIZE = 64

def get_embeddings(model, text_list):
    return model.encode(
        text_list,
        batch_size=BATCH_SIZE,
        show_progress_bar=False,
        normalize_embeddings=True,
    ).tolist()


def main():
    print(f"Loading data from {INPUT_FILE}...")

    try:
        df = pd.read_excel(INPUT_FILE, sheet_name=SHEET_NAME)
    except FileNotFoundError:
        print(f"Error: Could not find {INPUT_FILE}.")
        return

    df = df.dropna(subset=["skill_title"])
    df["skill_description"] = df["skill_description"].fillna("")
    df["text_for_embedding"] = (
        "Skill: " + df["skill_title"] + " | Description: " + df["skill_description"]
    )

    texts_to_embed = df["text_for_embedding"].tolist()
    all_embeddings = []
    model = SentenceTransformer(EMBEDDING_MODEL)

    print(f"Found {len(texts_to_embed)} unique skills. Generating local embeddings in batches...")

    for i in tqdm(range(0, len(texts_to_embed), BATCH_SIZE), desc="Embedding Progress"):
        batch = texts_to_embed[i:i + BATCH_SIZE]
        try:
            batch_embeddings = get_embeddings(model, batch)
            all_embeddings.extend(batch_embeddings)
        except Exception as exc:
            print(f"\nError generating local embeddings: {exc}")
            print("Saving whatever progress we have so far...")
            break

    if all_embeddings:
        df = df.iloc[:len(all_embeddings)].copy()
        df["embedding"] = all_embeddings
        columns_to_keep = [
            "skill_title",
            "skill_description",
            "skill_type",
            "Emerging Skills",
            "embedding",
        ]
        final_df = df[columns_to_keep]
        final_df.to_pickle(OUTPUT_FILE)
        print(f"\nSuccess! Saved {len(final_df)} skills with embeddings to {OUTPUT_FILE}")
    else:
        print("\nFailed to generate any embeddings.")


if __name__ == "__main__":
    main()
