-- A customer. Everything it owns is reached through its LinkedIn accounts,
-- so only accounts and users carry organization_id.
CREATE TABLE organizations(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                    text NOT NULL UNIQUE,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id         bigint NOT NULL REFERENCES organizations(id),
    -- Stored lowercased, so the same address cannot sign up twice in different case.
    email                   text NOT NULL UNIQUE,
    -- scrypt hash with its salt; the password itself is never stored.
    password_hash           text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions(
    -- SHA-256 of the cookie's token: a leaked table cannot be replayed as cookies.
    token_hash              text PRIMARY KEY,
    user_id                 bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at              timestamptz NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- Accounts connected before organizations existed are given a first one.
INSERT INTO organizations (name)
    SELECT 'Default' WHERE EXISTS (SELECT 1 FROM linkedin_accounts);

ALTER TABLE linkedin_accounts ADD COLUMN organization_id bigint REFERENCES organizations(id);
UPDATE linkedin_accounts SET organization_id = (SELECT min(id) FROM organizations);
ALTER TABLE linkedin_accounts ALTER COLUMN organization_id SET NOT NULL;
