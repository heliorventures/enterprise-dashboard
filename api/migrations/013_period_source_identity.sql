-- Bound period reconciliation to the two company snapshots being merged.
CREATE INDEX tally_source_batch_voucher_identity
ON tally_source_records(batch_id,source_id) WHERE collection='VOUCHER';
