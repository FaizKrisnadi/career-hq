-- Add normalized company key to applications (repost/repeat-application dedup,
-- mirrors opportunities.company_key and career-ops scan-history col 12).

ALTER TABLE applications ADD COLUMN company_key TEXT;
CREATE INDEX idx_applications_company_key ON applications(company_key);
