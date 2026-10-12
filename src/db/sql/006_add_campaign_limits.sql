-- Optional budgets a campaign spends inside its account's caps.
-- Empty means no budget of its own: only the account cap applies.
ALTER TABLE campaigns
    ADD COLUMN weekly_invite_limit  integer CHECK (weekly_invite_limit >= 0),
    ADD COLUMN daily_profile_limit  integer CHECK (daily_profile_limit >= 0);
