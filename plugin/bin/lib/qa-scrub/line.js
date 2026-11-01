// plugin/bin/lib/qa-scrub/line.js — the one rendering of a story's secret-scrub
// outcome (#4477). Shared by the scrub pass (lib/qa-scrub/scrub.js) and the QA
// report composer (lib/qa-report/compose.js), so report.json and the agent's
// SCRUB: line never word the same counts two ways.
'use strict';

function scrubLine({ values_scrubbed, artifacts_scrubbed, screenshots_removed }) {
  return `${values_scrubbed} secret value(s) scrubbed from ${artifacts_scrubbed} artifact(s); `
    + `${screenshots_removed} screenshot(s) removed`;
}

module.exports = { scrubLine };
