-- While on (the default), approved leads wait for a person to queue them
-- before any invite is sent; off lets the worker invite approved leads itself.
ALTER TABLE campaigns ADD COLUMN require_invite_approval boolean NOT NULL DEFAULT true;

-- `queued`: approved and cleared for an invite, waiting for the worker.
ALTER TABLE leads DROP CONSTRAINT leads_stage_check;
ALTER TABLE leads ADD CONSTRAINT leads_stage_check CHECK (stage IN (
    'found', 'profiled', 'approved', 'manual_review', 'rejected',
    'queued', 'invited', 'accepted', 'failed'
));

-- Who cleared the invite and when: the record of human approvals that shows
-- when the switch can be turned off.
ALTER TABLE leads ADD COLUMN queued_by bigint REFERENCES users(id);
ALTER TABLE leads ADD COLUMN queued_at timestamptz;
ALTER TABLE leads ADD COLUMN invited_at timestamptz;
ALTER TABLE leads ADD COLUMN accepted_at timestamptz;
