require('dotenv').config();

function parseServer(value) {
  const raw = String(value || 'localhost');
  const [host, instanceName] = raw.split('\\');
  return { host, instanceName };
}

const dbServer = parseServer(process.env.DB_SERVER);

module.exports = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: dbServer.host,
    instanceName: dbServer.instanceName,
    database: process.env.DB_NAME || 'EnterpriseDashboard',
  },
  tally: {
    host: process.env.TALLY_HOST || 'localhost',
    port: Number(process.env.TALLY_PORT) || 9000,
    timeoutMs: Number(process.env.TALLY_TIMEOUT_MS) || 8000,
  },
};
