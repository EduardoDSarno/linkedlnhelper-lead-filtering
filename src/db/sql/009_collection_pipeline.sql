-- Lead stages now match the evaluation's three answers, plus the outreach
-- stages and `failed` for a profile that could not be fetched.
ALTER TABLE leads DROP CONSTRAINT leads_stage_check;
UPDATE leads SET stage = 'approved' WHERE stage = 'qualified';
ALTER TABLE leads ADD CONSTRAINT leads_stage_check CHECK (stage IN (
    'found', 'profiled', 'approved', 'manual_review', 'rejected',
    'invited', 'accepted', 'failed'
));

-- Failed profile fetches for this lead; past the configured limit it is
-- marked failed instead of being retried forever.
ALTER TABLE leads ADD COLUMN fetch_attempts integer NOT NULL DEFAULT 0;

-- Where the campaign's search continues next time, and whether it has run
-- out of results.
ALTER TABLE campaigns ADD COLUMN search_cursor text;
ALTER TABLE campaigns ADD COLUMN search_exhausted boolean NOT NULL DEFAULT false;

-- The pipeline looks leads up by campaign and stage on every pass.
CREATE INDEX leads_campaign_stage ON leads (campaign_id, stage);
-- Every limit check counts one account's or campaign's recent actions of a type.
CREATE INDEX actions_account_type_time ON actions (linkedin_account_id, type, created_at);
CREATE INDEX actions_campaign_type_time ON actions (campaign_id, type, created_at);
