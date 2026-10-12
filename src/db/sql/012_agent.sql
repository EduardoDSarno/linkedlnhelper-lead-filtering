-- One turn of an account's agent: woken by the schedule or by a chat message.
CREATE TABLE agent_runs(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    linkedin_account_id     bigint NOT NULL REFERENCES linkedin_accounts(id),
    trigger                 text NOT NULL CHECK (trigger IN ('schedule', 'chat')),
    status                  text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
    error                   text,
    prompt_tokens           integer NOT NULL DEFAULT 0,
    completion_tokens       integer NOT NULL DEFAULT 0,
    started_at              timestamptz NOT NULL DEFAULT now(),
    finished_at             timestamptz
);

-- Everything said and done in an account's conversation with its agent:
-- user and assistant messages, and every tool call with its arguments and
-- result, so any action the agent took can be traced back to why.
CREATE TABLE agent_messages(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    linkedin_account_id     bigint NOT NULL REFERENCES linkedin_accounts(id),
    run_id                  bigint REFERENCES agent_runs(id),
    role                    text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content                 text,
    -- The person who wrote a user message; empty for the agent and the schedule.
    user_id                 bigint REFERENCES users(id),
    -- For an assistant message that calls tools: the model's call list.
    tool_calls              jsonb,
    -- For a tool message: which call it answers and with what.
    tool_call_id            text,
    tool_name               text,
    created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_messages_account ON agent_messages (linkedin_account_id, id);

-- What the agent decided to remember about its account between runs:
-- lessons from reviews, acceptance, and the user's instructions.
CREATE TABLE agent_notes(
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    linkedin_account_id     bigint NOT NULL REFERENCES linkedin_accounts(id),
    content                 text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);
