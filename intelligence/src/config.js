const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../api/.env'), quiet: true });
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

module.exports = {
  port: Number(process.env.INTEL_PORT) || 3010,
  host: process.env.HOST || '0.0.0.0',
  production: process.env.NODE_ENV === 'production',
  dashboardUser: process.env.INTEL_USER || process.env.DASHBOARD_USER || 'admin',
  dashboardPassword: process.env.INTEL_PASSWORD || process.env.DASHBOARD_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin'),
  sessionSecret: process.env.INTEL_SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || '',
  storageDir: process.env.STORAGE_DIR || path.join(__dirname, '../storage'),
  db: {
    user: process.env.DB_USER || 'enterprise_dashboard',
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'enterprise_dashboard',
  },
};
