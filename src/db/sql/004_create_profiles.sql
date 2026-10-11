CREATE TABLE profiles(
    -- One profile per person, shared by every campaign that finds them; matches leads.linkedin_member_id.
    linkedin_member_id      text PRIMARY KEY,
    -- Which service answered, since each shapes its response differently.
    source                  text NOT NULL CHECK (source IN ('unipile', 'harvest')),
    -- The response exactly as received, so mapping fixes never need a new fetch.
    data                    jsonb NOT NULL,
    -- When it was fetched; old profiles are fetched again.
    fetched_at              timestamptz NOT NULL DEFAULT now()
);
