CREATE TABLE organizations(
    -- A company using the app; its users share the same LinkedIn accounts and campaigns.
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                    text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Every user belongs to one organization; deleting it removes its users.
    organization_id         bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Saved in lowercase by the app, so "Ana@x.com" and "ana@x.com" are the same login.
    email                   text NOT NULL UNIQUE,
    -- Never the password itself: a one-way hash that can check a password but not reveal it.
    password_hash           text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);
