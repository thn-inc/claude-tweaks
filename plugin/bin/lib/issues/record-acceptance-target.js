// bin/lib/issues/record-acceptance-target.js
// Pure: the `Acceptance-target:` body line (#4615) — the one reader every consumer shares
// (parseAcceptanceTarget, itemOverrideOf). A record body, not a facet, carries the line, so
// the GitHub and local-files backends read it through the same function. No I/O.
//
// Grammar. Exactly `Acceptance-target: local` or `Acceptance-target: dev`, one line. An
// absent line is no per-item override. A present line that is anything else — a duplicate,
// a variant spelling, an unknown value, an empty value — is malformed, never absent.
// accept/target.js reads only `local` as an item override; `dev` and a malformed line both
// read as invalid input there and resolve to `local`, so a bad line can never fall through
// to the policy default.
//
// Scope. Only the preamble is read: after an optional leading `---` frontmatter block, the
// lines before the first `## ` heading, fenced lines ignored (a quoted line is never the
// record's own). Detection is wider than the grammar — any preamble line matching
// TARGET_LINE_RE is a target line — so a variant (`acceptance-target:`, `**Acceptance-target:**`,
// `- Acceptance-target:`, `> Acceptance-target:`, `Acceptance_target:`) reads malformed.
// Same preamble rules as record-risk-flags.js's scanPreamble; written as a local twin so
// that module stays untouched.
'use strict';

const { fencedLineMask } = require('../markdown-blocks');

// Blockquote marks, one list marker, then emphasis — each repeat anchored by a literal, so
// the scan stays linear.
const LINE_PREFIX = String.raw`^\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)?[*_]*`;
const TARGET_LINE_RE = new RegExp(String.raw`${LINE_PREFIX}acceptance[-_ ]?target[*_]*\s*:`, 'i');
const EXACT_TARGET_RE = /^Acceptance-target: (local|dev)$/;
const PREAMBLE_END_RE = /^## /;

// body -> the unfenced preamble lines that are target lines.
function targetLines(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const frontmatterEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const start = frontmatterEnd === -1 ? 0 : frontmatterEnd + 1;
  const fenced = fencedLineMask(lines.slice(start));
  const found = [];
  for (let i = start; i < lines.length; i += 1) {
    if (fenced[i - start]) continue;
    if (PREAMBLE_END_RE.test(lines[i])) break;
    if (TARGET_LINE_RE.test(lines[i])) found.push(lines[i]);
  }
  return found;
}

// body -> { status: 'absent' | 'ok' | 'malformed', value: 'local' | 'dev' | null, raw: string | null }.
function parseAcceptanceTarget(body) {
  const found = targetLines(body);
  if (found.length === 0) return { status: 'absent', value: null, raw: null };
  const raw = found.join('\n');
  const match = found.length === 1 ? EXACT_TARGET_RE.exec(found[0]) : null;
  if (!match) return { status: 'malformed', value: null, raw };
  return { status: 'ok', value: match[1], raw };
}

// parsed -> the `itemOverride` accept/target.js reads. `undefined` (absent) is the one
// "no override" answer; `null` (malformed) and `'dev'` read as invalid input there.
function itemOverrideOf(parsed) {
  if (parsed.status === 'absent') return undefined;
  if (parsed.status === 'ok') return parsed.value;
  return null;
}

module.exports = { parseAcceptanceTarget, itemOverrideOf };
