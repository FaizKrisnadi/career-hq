-- career-hq D1 schema v1
-- Conventions follow the career-ops DATA_CONTRACT:
--   status_log    mirrors status-log.tsv      (append-only ledger, '-' sentinels)
--   candidates    mirrors scan-history.tsv    (SimHash dedup, trust score/flags)
--   portal_health mirrors portal-health.tsv   (same status vocabulary)
-- The dashboard DB is canonical (user decision 2026-11-06); Atlas files are
-- mirrored via write-back (see sync_log).

CREATE TABLE opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'job'
    CHECK (kind IN ('job','fellowship','publication','phd','program','event','other')),
  company TEXT,
  role TEXT,
  location TEXT,
  url TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('linkedin-export','muse','chrome-audit','manual','sweep','import')),
  description TEXT,
  deadline_at TEXT,
  deadline_tz TEXT,
  deadline_verified INTEGER NOT NULL DEFAULT 0,
  liveness TEXT NOT NULL DEFAULT 'uncertain'
    CHECK (liveness IN ('live','closed','uncertain','evergreen')),
  priority TEXT
    CHECK (priority IN ('priority','credible','stretch','eligibility_check','monitor','skip_closed')),
  simhash TEXT,
  company_key TEXT,
  posting_date TEXT,
  trust_score REAL,
  trust_flags TEXT,
  verification_note TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_opportunities_kind ON opportunities(kind);
CREATE INDEX idx_opportunities_simhash ON opportunities(simhash);
CREATE INDEX idx_opportunities_company_key ON opportunities(company_key);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id),
  applied_date TEXT,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  score REAL,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered','researching','drafting','ready','applied',
                      'interview','offer','outcome','rejected','withdrawn')),
  pdf_path TEXT,
  report_path TEXT,
  notes TEXT,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_opportunity ON applications(opportunity_id);

CREATE TABLE status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  date TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '-',
  to_status TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('manual','engine','import','sweep','sync','correction')),
  note TEXT
);
CREATE INDEX idx_status_log_app ON status_log(application_id);

CREATE TABLE postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id),
  application_id INTEGER REFERENCES applications(id),
  title TEXT,
  company TEXT,
  fetched_url TEXT,
  content TEXT,
  simhash TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT,
  url TEXT,
  source TEXT,
  found_at TEXT NOT NULL DEFAULT (datetime('now')),
  deadline_at TEXT,
  simhash TEXT,
  company_key TEXT,
  trust_score REAL,
  trust_flags TEXT,
  liveness TEXT NOT NULL DEFAULT 'uncertain'
    CHECK (liveness IN ('live','closed','uncertain','evergreen')),
  fit_score REAL,
  fit_summary TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','dismissed','promoted')),
  opportunity_id INTEGER REFERENCES opportunities(id),
  raw_json TEXT
);
CREATE INDEX idx_candidates_simhash ON candidates(simhash);
CREATE INDEX idx_candidates_status ON candidates(status);

CREATE TABLE portals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT,
  base_url TEXT,
  provider TEXT,
  query TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  portals_scanned INTEGER,
  items_found INTEGER,
  items_new INTEGER,
  items_dup INTEGER,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','ok','partial','failed')),
  error TEXT
);

CREATE TABLE portal_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal_id INTEGER NOT NULL REFERENCES portals(id),
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('reachable','empty','slug_gone','network','auth','server','unknown'))
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  kind TEXT NOT NULL
    CHECK (kind IN ('cv','cover_letter','interview_prep','followup','report','other')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','id')),
  title TEXT,
  text_content TEXT,
  r2_key TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_documents_app ON documents(application_id);

CREATE TABLE doc_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  version INTEGER NOT NULL,
  text_content TEXT,
  r2_key TEXT,
  lint_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, version)
);

CREATE TABLE fit_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  application_id INTEGER REFERENCES applications(id),
  score REAL,
  summary TEXT,
  evidence_json TEXT,
  gaps_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE follow_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  due_date TEXT,
  kind TEXT,
  note TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  scheduled_at TEXT,
  stage TEXT,
  notes TEXT,
  prep_doc_id INTEGER REFERENCES documents(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('offer','rejected','withdrawn','no_response','other')),
  decided_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE salary_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('desired','advertised','actual')),
  amount REAL,
  currency TEXT,
  source TEXT,
  note TEXT
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL
    CHECK (kind IN ('intake','fit','tailor_cv','cover_letter','interview_prep',
                    'sweep','writeback','export','import_parse')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','done','failed')),
  claimed_at TEXT,
  finished_at TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE engine_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id),
  event TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  target_file TEXT NOT NULL,
  action TEXT NOT NULL,
  diff_summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','done','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
