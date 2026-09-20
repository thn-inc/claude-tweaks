// bin/lib/render-tidy-report/render.js — renders a tidy report's Approve
// section directly from staged/*.json sidecars (#2612), replacing
// step-6-auto.md's prior independently-composed prose. staged/*.json
// becomes the single source of truth for the Approve section's content:
// this module cannot describe an item that isn't on disk, and cannot omit
// one that is — the inverse-drift bug #2612 exists to close.
'use strict';

const fs = require('fs');
const path = require('path');

// Column shape rule (step-6-auto.md): titles truncated to 50 chars + "…"
// when longer. The truncated form (49 chars + the ellipsis) still satisfies
// tidy-report-lint.js's own MAX_TITLE=50 check on the rendered line.
const MAX_TITLE = 50;

function truncateTitle(title) {
  const s = typeof title === 'string' ? title : '';
  if (s.length <= MAX_TITLE) return s;
  return `${s.slice(0, MAX_TITLE - 1)}…`;
}

// A record-less finding renders `#—` in the record column (step-6-auto.md's
// Column shape rule) — the literal record captured in this repo's own
// historical reports (e.g. "2  [git]     #—    Merged remote branch...").
function formatRecord(record) {
  if (record === null || record === undefined || record === '') return '#—';
  const s = String(record);
  return s.startsWith('#') ? s : `#${s}`;
}

// Reads every staged/*.json sidecar under `runDir`, in filename-sorted
// order, and flattens each file's item array into one ordered list — the
// Deliverables' "file-then-item order". A missing staged/ directory, or one
// holding no .json files, returns an empty list (nothing staged is not an
// error). A sidecar that fails to parse, or whose top level isn't an array,
// throws rather than silently dropping its items — a corrupt sidecar must
// fail the render loudly, never quietly under-report the Approve section.
function collectStagedItems(runDir) {
  const stagedDir = path.join(runDir, 'staged');
  let entries;
  try {
    entries = fs.readdirSync(stagedDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();

  const items = [];
  for (const name of files) {
    const raw = fs.readFileSync(path.join(stagedDir, name), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`staged/${name} is not valid JSON (${err.message})`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`staged/${name} must contain a JSON array of items`);
    }
    for (const item of parsed) items.push({ ...item, sourceFile: name });
  }
  return items;
}

// One item -> its three rendered lines, joined with '\n' (no leading/trailing
// newline). step-6-auto.md's Approve shape: "number + tag + record + title,
// then the staged action, then the command or mutation."
function renderItem(n, item) {
  const tag = item.tag || '';
  const record = formatRecord(item.record);
  const title = truncateTitle(item.title || '');
  const action = item.action || '';
  const commandLines = String(item.command || '').split('\n').map((l) => `   ${l}`);
  return [`${n}  [${tag}]  ${record}  ${title}`, `   ${action}`, ...commandLines].join('\n');
}

// Renders the full **Approve (N)** section — header + fenced text — ready
// to be embedded verbatim in report.md/report-condensed.md per the
// Deliverables ("step-6-auto.md's Step 6 ... uses its output verbatim").
// Returns '' when there is nothing staged: the empty string is the signal
// to omit the block entirely (step-6-auto.md's Report rules' empty-state
// clause) — a caller must never render a zero-item "**Approve (0)**".
function renderApproveSection(items) {
  if (!items || items.length === 0) return '';
  const body = items.map((item, i) => renderItem(i + 1, item)).join('\n');
  return `**Approve (${items.length})**\n\`\`\`text\n${body}\n\`\`\``;
}

module.exports = { collectStagedItems, renderApproveSection, renderItem, truncateTitle, formatRecord, MAX_TITLE };
