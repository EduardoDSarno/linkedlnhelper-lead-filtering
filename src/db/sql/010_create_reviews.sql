-- Every decision a person makes on a lead, next to what the AI had said.
-- Agreements and overrides are the evidence for tuning the criteria and for
-- deciding when the AI may decide alone.
CREATE TABLE reviews(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id                 bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id                 bigint NOT NULL REFERENCES users(id),
    -- The AI's verdict when the person decided; empty if it never judged the lead.
    model_decision          text,
    model_score             integer,
    decision                text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    note                    text,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reviews_lead ON reviews (lead_id);
