// Shared by preparation and packaging. Never glob the source agent directory:
// installations can contain real tokens, previews, outboxes and accounting logs.
module.exports=['agent.js','source-agent.js','source-export.js','tally-source-parser.js','tally.js','outbox.js','launcher.js','startup.js','export-diagnostics.js'];
