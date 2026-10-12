CREATE TABLE actions(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Stored directly, not only through the campaign, so the account cap is the simplest count.
    linkedin_account_id     bigint NOT NULL REFERENCES linkedin_accounts(id),
    campaign_id             bigint NOT NULL REFERENCES campaigns(id),
    -- The person the action was about; empty for searches.
    lead_id                 bigint REFERENCES leads(id),
    type                    text NOT NULL CHECK (type IN ('search', 'profile_fetch', 'invite')),
    -- Every limit counts actions of one type since some point in time.
    created_at              timestamptz NOT NULL DEFAULT now()
);
