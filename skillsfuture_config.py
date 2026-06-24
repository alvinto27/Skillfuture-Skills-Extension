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

EXTENSION_ID = str(setting("EXTENSION_ID", "")).strip()
ALLOW_LOCAL_DEVELOPMENT_ORIGINS = bool(setting("ALLOW_LOCAL_DEVELOPMENT_ORIGINS", True))
API_ACCESS_TOKEN = str(setting("API_ACCESS_TOKEN", "")).strip()
MAX_REQUEST_BODY_BYTES = int(setting("MAX_REQUEST_BODY_BYTES", 128_000))
API_REQUEST_TIMEOUT_SECONDS = float(setting("API_REQUEST_TIMEOUT_SECONDS", 45))
OPENAI_TIMEOUT_SECONDS = float(setting("OPENAI_TIMEOUT_SECONDS", 30))
OPENAI_MAX_RETRIES = int(setting("OPENAI_MAX_RETRIES", 1))
JOB_ANALYSIS_CACHE_TTL_SECONDS = int(setting("JOB_ANALYSIS_CACHE_TTL_SECONDS", 900))
JOB_ANALYSIS_CACHE_MAX_SIZE = int(setting("JOB_ANALYSIS_CACHE_MAX_SIZE", 128))
QUERY_EMBEDDING_CACHE_TTL_SECONDS = int(setting("QUERY_EMBEDDING_CACHE_TTL_SECONDS", 1800))
QUERY_EMBEDDING_CACHE_MAX_SIZE = int(setting("QUERY_EMBEDDING_CACHE_MAX_SIZE", 256))
RATE_LIMIT_REQUESTS = int(setting("RATE_LIMIT_REQUESTS", 30))
RATE_LIMIT_WINDOW_SECONDS = int(setting("RATE_LIMIT_WINDOW_SECONDS", 60))
