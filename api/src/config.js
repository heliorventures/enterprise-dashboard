require('dotenv').config({ quiet: true });
module.exports = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  production: process.env.NODE_ENV === 'production',
  ingestToken: process.env.TALLY_INGEST_TOKEN || '',
  tallyMode: process.env.TALLY_MODE || 'push',
  db: {
    user: process.env.DB_USER || 'enterprise_dashboard',
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'enterprise_dashboard',
  },
  tally: {
    host: process.env.TALLY_HOST || 'localhost',
    port: Number(process.env.TALLY_PORT) || 9000,
    timeoutMs: Number(process.env.TALLY_TIMEOUT_MS) || 8000,
  },
};
