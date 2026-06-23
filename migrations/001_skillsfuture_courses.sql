CREATE TABLE IF NOT EXISTS dataset_sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id TEXT NOT NULL,
    dataset_name TEXT,
    source_last_updated_at TEXT,
    raw_file_path TEXT,
    sha256 TEXT,
    status TEXT NOT NULL,
    rows_read INTEGER DEFAULT 0,
    rows_inserted INTEGER DEFAULT 0,
    rows_updated INTEGER DEFAULT 0,
    rows_deactivated INTEGER DEFAULT 0,
    warnings TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dataset_sync_runs_dataset_id ON dataset_sync_runs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_dataset_sync_runs_status ON dataset_sync_runs(status);

CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    external_course_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    objectives TEXT,
    provider_name TEXT,
    category TEXT,
    level TEXT,
    duration_value REAL,
    duration_unit TEXT,
    delivery_modes TEXT,
    fee_info TEXT,
    support_dates TEXT,
    source_last_updated_at TEXT,
    raw_source_data TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source, external_course_id)
);

CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active);
CREATE INDEX IF NOT EXISTS idx_courses_title ON courses(title);
CREATE INDEX IF NOT EXISTS idx_courses_provider ON courses(provider_name);

CREATE TABLE IF NOT EXISTS course_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    external_run_id TEXT NOT NULL,
    external_course_id TEXT NOT NULL,
    course_id INTEGER,
    start_date TEXT,
    end_date TEXT,
    registration_deadline TEXT,
    delivery_mode TEXT,
    venue TEXT,
    schedule_details TEXT,
    fee_info TEXT,
    run_status TEXT,
    raw_source_data TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source, external_run_id),
    FOREIGN KEY(course_id) REFERENCES courses(id)
);

CREATE INDEX IF NOT EXISTS idx_course_runs_course_id ON course_runs(course_id);
CREATE INDEX IF NOT EXISTS idx_course_runs_dates ON course_runs(start_date, registration_deadline);
CREATE INDEX IF NOT EXISTS idx_course_runs_active ON course_runs(is_active);

CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT NOT NULL UNIQUE,
    aliases TEXT NOT NULL DEFAULT '[]',
    category TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS course_skills (
    course_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    coverage_score REAL NOT NULL,
    confidence TEXT NOT NULL,
    source TEXT NOT NULL,
    evidence_text TEXT,
    reviewed_at TEXT,
    PRIMARY KEY(course_id, skill_id),
    FOREIGN KEY(course_id) REFERENCES courses(id),
    FOREIGN KEY(skill_id) REFERENCES skills(id)
);

CREATE INDEX IF NOT EXISTS idx_course_skills_skill_id ON course_skills(skill_id);

CREATE TABLE IF NOT EXISTS career_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL UNIQUE,
    sector TEXT,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS role_skills (
    career_role_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    required_level INTEGER NOT NULL DEFAULT 3,
    importance_weight REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY(career_role_id, skill_id),
    FOREIGN KEY(career_role_id) REFERENCES career_roles(id),
    FOREIGN KEY(skill_id) REFERENCES skills(id)
);

CREATE TABLE IF NOT EXISTS user_skills (
    user_id TEXT NOT NULL,
    skill_id INTEGER NOT NULL,
    current_level INTEGER NOT NULL DEFAULT 1,
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL DEFAULT 'manual',
    confirmed_by_user INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, skill_id),
    FOREIGN KEY(skill_id) REFERENCES skills(id)
);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    course_id INTEGER NOT NULL,
    target_role_id INTEGER,
    feedback_type TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(course_id) REFERENCES courses(id),
    FOREIGN KEY(target_role_id) REFERENCES career_roles(id)
);
