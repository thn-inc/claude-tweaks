// bin/lib/issues/named-target.js
// Pure: the single file a record names as its subject, when determinable
// mechanically -- used by dispatch's pre-flight target-existence check
// (queue-pull-script.md) and tidy's ledger-Delete Close-row bundling
// (scan-procedures.md). #1983.
//
// Narrow by design: only `by:docs-health` records carry a single, structured
// target field today (the "**Doc:** {value} | ..." header line). Every other
// origin returns null -- this module never guesses a target from prose;
// #1769's marker and #1829's `Premise-check:` line cover authored claims,
// and materialize.md's Named-location drift note covers the general case.
'use strict';

const { extractKeyFiles, hasOrigin } = require('./grouping');
const { normalizeLabelNames } = require('./record');

// record: { body, labels } shaped like `gh issue view --json body,labels`
// output (the same shape materialize.js's Resolution reads) -> { path } | null.
function namedTarget(record) {
  const names = normalizeLabelNames(record && record.labels);
  if (!hasOrigin(names, 'docs-health')) return null;

  // extractKeyFiles (grouping.js) already reads docs-health's own
  // "**Doc:** {value} | ..." header line (bin/lib/docs-health/issue-payload.js)
  // via the bold-header shape it shares with harness-health/journey-health --
  // reuse it rather than re-parsing the body here.
  const [value] = extractKeyFiles(record);
  if (!value) return null;

  // The header value is already a repo-relative path once #1851 lands
  // (docs/{...}.md); until then it's the pre-#1851 bare id -- a path
  // relative to docs/, without the .md extension (docs-health/SKILL.md's
  // `--target <id>` convention: "decisions/0007-foo"). Detect the landed
  // form by shape, not a flag, so this function needs no update either way.
  const path = /^docs\/.*\.md$/.test(value) ? value : `docs/${value}.md`;
  return { path };
}

module.exports = { namedTarget };
