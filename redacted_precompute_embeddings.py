import pandas as pd
import os
from openai import OpenAI
from dotenv import load_dotenv
from tqdm import tqdm

# Load environment variables (your API key)
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Configuration
INPUT_FILE = "jobsandskills-skillsfuture-unique-skills-list.xlsx"
SHEET_NAME = "Unique Skills List"
OUTPUT_FILE = "skills_with_embeddings.pkl"
EMBEDDING_MODEL = "text-embedding-3-small"
BATCH_SIZE = 500  # Process in batches to respect API limits

def get_embeddings(text_list):
    """Fetches embeddings from OpenAI for a list of strings."""
    response = client.embeddings.create(
        input=text_list,
        model=EMBEDDING_MODEL
    )
    return [item.embedding for item in response.data]

def main():
    print(f"Loading data from {INPUT_FILE}...")
    
    # Read the Excel file
    try:
        df = pd.read_excel(INPUT_FILE, sheet_name=SHEET_NAME)
    except FileNotFoundError:
        print(f"Error: Could not find {INPUT_FILE}. Make sure it's in the same directory.")
        return

    # Clean the data: drop rows without a skill title and fill NaNs in description
    df = df.dropna(subset=['skill_title'])
    df['skill_description'] = df['skill_description'].fillna("")

    # Create a rich text representation for the AI to embed
    # Format: "Skill: [Title] | Description: [Description]"
    df['text_for_embedding'] = "Skill: " + df['skill_title'] + " | Description: " + df['skill_description']
    
    texts_to_embed = df['text_for_embedding'].tolist()
    all_embeddings = []

    print(f"Found {len(texts_to_embed)} unique skills. Generating embeddings in batches...")

    # Process in batches with a progress bar
    for i in tqdm(range(0, len(texts_to_embed), BATCH_SIZE), desc="Embedding Progress"):
        batch = texts_to_embed[i : i + BATCH_SIZE]
        try:
            batch_embeddings = get_embeddings(batch)
            all_embeddings.extend(batch_embeddings)
        except Exception as e:
            print(f"\nError hitting OpenAI API: {e}")
            print("Saving whatever progress we have so far...")
            break

    # If we got embeddings for everything (or at least some), save them
    if all_embeddings:
        # Match the length in case it failed halfway
        df = df.iloc[:len(all_embeddings)].copy()
        df['embedding'] = all_embeddings
        
        # Keep only the essential columns to keep the file lightweight
        columns_to_keep = ['skill_title', 'skill_description', 'skill_type', 'Emerging Skills', 'embedding']
        final_df = df[columns_to_keep]

        # Save as pickle for blazing fast loading in the backend
        final_df.to_pickle(OUTPUT_FILE)
        print(f"\nSuccess! Saved {len(final_df)} skills with embeddings to {OUTPUT_FILE}")
    else:
        print("\nFailed to generate any embeddings.")

if __name__ == "__main__":
    main()