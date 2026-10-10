CREATE TABLE linkedin_accounts(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    label                   text NOT NULL,
    unipile_account_id      text NOT NULL UNIQUE,
    connected_at            timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()

    -- More fields to be added as later like organiztions and status
)
