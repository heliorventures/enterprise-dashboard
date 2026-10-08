const path = require('node:path');
const config = require('../config');

module.exports = {
  ...config,
  storageDir: process.env.EXCEL_IMPORT_STORAGE || path.join(__dirname, '../../storage'),
};
