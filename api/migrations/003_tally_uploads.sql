CREATE TABLE tally_uploads (
  batch_id varchar(200) PRIMARY KEY,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  bytes bigint NOT NULL DEFAULT 0,
  result jsonb
);
CREATE TABLE tally_upload_chunks (
  batch_id varchar(200) NOT NULL REFERENCES tally_uploads(batch_id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  checksum text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (batch_id, chunk_index)
);
CREATE INDEX tally_uploads_expiration ON tally_uploads(updated_at) WHERE result IS NULL;
