CREATE TABLE leads(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- The campaign whose search found this person; the account is reached through it.
    campaign_id             bigint NOT NULL REFERENCES campaigns(id),
    -- LinkedIn's permanent id for the person (Unipile's provider_id); URLs can change, this cannot.
    linkedin_member_id      text NOT NULL,
    name                    text NOT NULL,
    headline                text,
    -- Where the lead is in the funnel; later stages are added here as they are built.
    stage                   text NOT NULL DEFAULT 'found'
                            CHECK (stage IN ('found', 'profiled', 'qualified', 'rejected', 'invited')),
    -- The model's verdict and reasons; empty until the lead is evaluated.
    evaluation              jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    -- Running the same search again must not add the same person twice.
    UNIQUE (campaign_id, linkedin_member_id)
);
