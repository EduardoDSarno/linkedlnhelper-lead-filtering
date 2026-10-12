-- Campaigns are now set up from a form with LinkedIn's search fields instead
-- of a pasted search URL.
ALTER TABLE campaigns DROP COLUMN search_url;

-- The form's search fields (keywords, title, locations, …) in the shape the
-- LinkedIn client sends them. The default only fills rows that already exist.
ALTER TABLE campaigns ADD COLUMN search jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE campaigns ALTER COLUMN search DROP DEFAULT;

-- Collecting stops once this many leads are approved, or when the search
-- runs out of results. Empty means only the search running out stops it.
ALTER TABLE campaigns ADD COLUMN approved_target integer CHECK (approved_target > 0);

-- A campaign that reached its target or ran out of results is completed.
ALTER TABLE campaigns DROP CONSTRAINT campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
    CHECK (status IN ('active', 'paused', 'completed'));
