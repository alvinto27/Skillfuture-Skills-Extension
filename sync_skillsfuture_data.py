import argparse
import json

from skillsfuture_sync import sync_skillsfuture_data


def main():
    parser = argparse.ArgumentParser(description="Import SkillsFuture course datasets from local Excel files")
    parser.add_argument("--dataset", choices=["all", "courses", "course-runs"], default="all")
    parser.add_argument("--force", action="store_true", help="Import even when the local file hash is unchanged")
    parser.add_argument("--dry-run", action="store_true", help="Inspect local files without writing production rows")
    args = parser.parse_args()

    result = sync_skillsfuture_data(dataset=args.dataset, force=args.force, dry_run=args.dry_run)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
