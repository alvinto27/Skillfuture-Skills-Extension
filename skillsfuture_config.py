from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent

try:
    import config as local_config
except ImportError:
    local_config = None


def setting(name, default):
    if local_config is not None and hasattr(local_config, name):
        return getattr(local_config, name)
    return default


def project_path(name, default):
    path = Path(setting(name, default)).expanduser()
    return path if path.is_absolute() else PROJECT_ROOT / path


LOCAL_COURSE_DIRECTORY_XLSX = project_path(
    "LOCAL_COURSE_DIRECTORY_XLSX",
    "MySkillsFutureCourseDirectory.xlsx",
)
LOCAL_COURSE_RUN_XLSX = project_path(
    "LOCAL_COURSE_RUN_XLSX",
    "MySkillsFutureCourseRun.xlsx",
)
COURSE_DB_PATH = project_path("COURSE_DB_PATH", "skillsfuture_courses.sqlite3")
CAREER_ROLES_SEED_PATH = project_path("CAREER_ROLES_SEED_PATH", "data/career_roles.json")
COURSE_EMBEDDINGS_PATH = project_path("COURSE_EMBEDDINGS_PATH", "course_embeddings.npz")
