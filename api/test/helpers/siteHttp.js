const http = require('node:http');

// Node fetch does not preserve an overridden Host in every supported runtime.
// Use an actual HTTP authority header to exercise virtual-host routing.
function siteRequest(port, hostname, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method,
      headers: { ...headers, Host: hostname } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: response.statusCode, headers: response.headers,
          text: () => buffer.toString(), json: () => JSON.parse(buffer.toString()), buffer });
      });
    });
    request.setTimeout(10000, () => request.destroy(new Error('Website request timed out')));
    request.on('error', reject);
    request.end(body);
  });
}
module.exports = { siteRequest };
