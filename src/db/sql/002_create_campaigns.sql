CREATE TABLE campaigns(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- The account that runs this campaign; Postgres refuses ids that do not exist.
    linkedin_account_id     bigint NOT NULL REFERENCES linkedin_accounts(id),
    name                    text NOT NULL,
    search_url              text NOT NULL,
    -- Who qualifies, in the shape the evaluation code reads (FullEvaluationCriteria).
    criteria                jsonb NOT NULL,
    status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'paused')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
