CREATE TABLE sessions(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Whose login this is; deleting the user ends all their sessions.
    user_id                 bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Hash of the token in the browser's cookie, never the token itself, so a database leak logs no one in.
    token_hash              text NOT NULL UNIQUE,
    created_at              timestamptz NOT NULL DEFAULT now(),
    -- After this the cookie is refused, limiting how long a stolen one is useful.
    expires_at              timestamptz NOT NULL,
    -- Where the login came from: shows the user's devices, and later picks the Unipile proxy region.
    ip                      inet,
    user_agent              text,
    -- Filled from the IP once the location lookup exists.
    country                 text,
    city                    text
);

-- Finds every session of one user, for "log out everywhere".
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
