require('dotenv').config();
const tally = require('./tally');
const config = require('./config');

(async () => {
  const url = tally.tallyUrl();
  console.log('Checking Tally at', url);
  console.log('Host from .env:', config.tally.host);
  console.log('Port from .env:', config.tally.port);

  const result = await tally.ping({ fresh: true });
  console.log(JSON.stringify(result, null, 2));

  if (!result.connected) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
