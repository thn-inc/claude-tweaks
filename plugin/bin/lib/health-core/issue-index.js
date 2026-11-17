'use strict';
const fs = require('fs');
const { DEFAULT_IO, resolveAgainst } = require('./io');

// --issues <file> is an array of { number, state, labels, fingerprint }
// objects (the shape gh issue list + fingerprint extraction produces).
// decide() expects a map { "<fingerprint>": { number, state, labels } }, with
// state lowercased and labels reduced to label names (gh's raw OPEN/CLOSED
// state and { name } label objects are accepted as input).
// Shared by every health-suite CLI's validate-findings (ci-audit.js's too) — previously
// duplicated near-verbatim in each of the first four (code-health.js, harness-health.js,
// journey-health.js, docs-health.js), differing only in the bracketed
// [toolName] prefix on its stderr diagnostics.
// cwd (optional, () => string): a relative file is read against it while the
// diagnostics still print the caller's own spelling; omitted = the process cwd.
function loadIssueIndex(file, toolName, { stderr = DEFAULT_IO.stderr, cwd } = {}) {
  if (!file) return {};
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(cwd ? resolveAgainst(cwd(), file) : file, 'utf8'));
  } catch {
    stderr(`[${toolName}] validate-findings: could not read or parse --issues file: ${file} — dedup falls back to the local cache only\n`);
    return {};
  }
  if (!Array.isArray(arr)) {
    stderr(`[${toolName}] validate-findings: --issues file must contain a JSON array: ${file} — dedup falls back to the local cache only\n`);
    return {};
  }
  return buildIssueIndex(arr, toolName, { stderr });
}

// The same index built from an already-parsed issues array (a caller that read and validated
// the --issues file itself, e.g. through its own injected reader, passes the array and never
// re-reads the path). The array's elements are checked here; a non-array is the caller's to refuse.
function buildIssueIndex(arr, toolName, { stderr = DEFAULT_IO.stderr } = {}) {
  const index = {};
  let dropped = 0;
  let stateless = 0;
  for (const issue of arr) {
    if (!issue || typeof issue !== 'object') {
      stderr(`[${toolName}] loadIssueIndex: skipping malformed issue entry\n`);
      continue;
    }
    if (issue.fingerprint) {
      const normalized = normalizeLabels(issue.labels);
      dropped += normalized.dropped;
      if (typeof issue.state !== 'string') stateless++;
      index[issue.fingerprint] = {
        number: issue.number,
        state: typeof issue.state === 'string' ? issue.state.toLowerCase() : '',
        labels: normalized.names,
      };
    }
  }
  if (dropped > 0) stderr(`[${toolName}] loadIssueIndex: ignored ${dropped} label entries with no name\n`);
  if (stateless > 0) stderr(`[${toolName}] loadIssueIndex: ${stateless} issue entries with no state, treated as not closed\n`);
  return index;
}

// Reduces a raw labels value (names, gh's label objects, or a mix) to label
// names. A nullish value is []; a non-array value is [] counted as one dropped
// entry; an array element that is neither a string nor an object with a string
// name is dropped and counted. Names are kept as given — no case folding.
function normalizeLabels(labels) {
  if (labels === undefined || labels === null) return { names: [], dropped: 0 };
  if (!Array.isArray(labels)) return { names: [], dropped: 1 };
  const names = [];
  let dropped = 0;
  for (const label of labels) {
    if (typeof label === 'string') names.push(label);
    else if (label && typeof label === 'object' && typeof label.name === 'string') names.push(label.name);
    else dropped++;
  }
  return { names, dropped };
}

module.exports = { loadIssueIndex, buildIssueIndex };
