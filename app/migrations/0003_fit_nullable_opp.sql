-- fit_analyses.opportunity_id was declared NOT NULL but fits can be
-- application-only (opportunity not yet created). SQLite cannot ALTER
-- nullability: recreate.

CREATE TABLE fit_analyses_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id),
  application_id INTEGER REFERENCES applications(id),
  score REAL,
  summary TEXT,
  evidence_json TEXT,
  gaps_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO fit_analyses_new (id, opportunity_id, application_id, score, summary, evidence_json, gaps_json, created_at)
  SELECT id, opportunity_id, application_id, score, summary, evidence_json, gaps_json, created_at FROM fit_analyses;
DROP TABLE fit_analyses;
ALTER TABLE fit_analyses_new RENAME TO fit_analyses;
CREATE INDEX idx_fit_analyses_app ON fit_analyses(application_id);
