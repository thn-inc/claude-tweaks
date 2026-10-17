'use strict';

// #3358 — a marker comment drives behavior only when its author is an owner,
// member, or collaborator. `_shared/pr-run-comments.md`'s `## Trusted authors`
// section is the one statement of the rule; this suite pins the prose sites
// against `plugin/bin/lib/issues/comment-trust.js` (the code twin). The jq text
// is never retyped here: it is built by the module's own builders and compared
// against the prose, so a change to the module's set or order goes red until the
// prose is updated in the same change.
//
// The live prose is read on purpose (skill-prose-conformance-tests' "declared
// contract" carve-out): updating these sites IS the response to a change in the
// trust module. Every pin is paired with a frozen pre-change excerpt it must
// NOT match, so a green result proves the pattern can go red [IL-105].

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  TRUSTED_AUTHOR_ASSOCIATIONS,
  trustedJqSelect,
  untrustedJqNote,
} = require('../plugin/bin/lib/issues/comment-trust.js');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const COMMENTS = fs.readFileSync(path.join(SKILLS, '_shared', 'pr-run-comments.md'), 'utf8');
const SCAN = fs.readFileSync(path.join(SKILLS, 'tidy', 'scan-procedures.md'), 'utf8');

// Frozen pre-change excerpts (the bytes #3358 Task 4 replaced).
const PRE_CHANGE_FIND_JQ = `  --jq '.comments[] | select(.body | startswith("<!-- run-comment: {kind} -->")) | .id'`;
const PRE_CHANGE_MCP_PARAGRAPH = `**MCP transport (no \`gh\`, #3131).** The find and update steps above are \`gh\`-only, and there is no
MCP comment-edit mapping — post a new comment with \`add_issue_comment\` on the PR's number instead
of updating. Before posting, list the PR's comments (\`issue_read\`, \`get_comments\`) and look for a
prior comment of this kind by its marker; when one is found, make the new body's second line
\`Supersedes {prior comment URL} — this transport cannot edit comments.\` so a reader knows which one
is current, and log an \`AUTO\` line naming both comment ids. When the read cannot identify one (the
read fails, or returns no marker), post without that line — never skip the post to avoid a duplicate. Compose`;
const PRE_CHANGE_TOMBSTONE_ROW = `| \`CLOSED\` (unmerged) — check for the tombstone marker: \`gh pr view {pr-number} --json comments --jq '.comments[] \\| select(.body \\| startswith("<!-- run-comment: failure -->"))'\` | **Non-empty result → tombstoned.**`;

// Text of the `## {heading}` section, up to (not including) the next `## `
// heading. Both anchors must resolve — a missing end anchor would otherwise
// widen the slice to the rest of the file and let a later section satisfy a
// presence pin.
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === heading);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length; // deliberate: last section has no following heading
  return lines.slice(start + 1, end).join('\n');
}

// Paragraph (blank-line delimited) that begins with `opener`, or null.
function paragraphStartingWith(text, opener) {
  return text.split(/\r?\n\r?\n/).find((p) => p.startsWith(opener)) ?? null;
}

// Backticked all-caps tokens in prose outside fenced blocks, first-seen order,
// de-duplicated.
function capsTokens(text) {
  const prose = text.replace(/```[\s\S]*?```/g, '');
  const seen = [];
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    if (/^[A-Z_]+$/.test(m[1]) && !seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

const collapse = (s) => s.replace(/\s+/g, ' ');

test('AC5.1: the Find-step jq tests the association', () => {
  const needle = `select(.body | startswith("<!-- run-comment: {kind} -->")) | ${trustedJqSelect()} | .id`;
  assert.ok(COMMENTS.includes(needle), 'Find-step jq must pipe the marker select through trustedJqSelect() before .id');
  assert.ok(!PRE_CHANGE_FIND_JQ.includes(needle), 'needle must NOT match the pre-change Find jq (proves it can go red)');
});

test('AC5.1: the Find step also runs the skip-notice jq so skipped comments are named', () => {
  const note = untrustedJqNote();
  const from = COMMENTS.indexOf('1. **Find.**');
  const to = COMMENTS.indexOf('2. **Found');
  assert.ok(from !== -1 && to > from, 'Find step anchors must resolve before slicing');
  const findStep = COMMENTS.slice(from, to);
  assert.ok(findStep.includes(`startswith("<!-- run-comment: {kind} -->")) | ${note}`), 'Find step must run untrustedJqNote() over the marker comments');
  assert.ok(!PRE_CHANGE_FIND_JQ.includes(note), 'note must NOT match the pre-change Find jq');
});

test('the gh pr view command the Find step pins stays byte-identical', () => {
  assert.ok(
    COMMENTS.includes('gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments'),
    'tests/pr-run-comments.test.js pins this exact command',
  );
});

test('AC5.3: the Trusted authors section exists and lists exactly the module set, in order', () => {
  const body = section(COMMENTS, '## Trusted authors');
  assert.notStrictEqual(body, null, '`## Trusted authors` heading missing from _shared/pr-run-comments.md');
  assert.strictEqual(section(PRE_CHANGE_FIND_JQ, '## Trusted authors'), null, 'extractor must find nothing in pre-change text');

  // The excluded-on-purpose paragraph names CONTRIBUTOR; the trusted list is every
  // other paragraph's backticked all-caps tokens.
  const excluded = paragraphStartingWith(body, '**Excluded on purpose.**');
  assert.notStrictEqual(excluded, null, 'the section needs an `**Excluded on purpose.**` paragraph');
  const trustedProse = body.split(/\r?\n\r?\n/).filter((p) => p !== excluded).join('\n\n');
  assert.deepStrictEqual(capsTokens(trustedProse), [...TRUSTED_AUTHOR_ASSOCIATIONS]);
  assert.ok(capsTokens(excluded).includes('CONTRIBUTOR'), 'the excluded paragraph names CONTRIBUTOR');
  assert.ok(!capsTokens(trustedProse).includes('CONTRIBUTOR'), 'CONTRIBUTOR must appear only in the excluded paragraph');
});

test('AC5.3: the Trusted authors section carries the jq select and skip-notice jq verbatim', () => {
  const body = section(COMMENTS, '## Trusted authors');
  assert.notStrictEqual(body, null);
  assert.ok(body.includes(trustedJqSelect()), 'section must paste trustedJqSelect() verbatim');
  assert.ok(body.includes(untrustedJqNote()), 'section must paste untrustedJqNote() verbatim');
  const mutated = body.replace('"OWNER"', '"OWNER2"');
  assert.notStrictEqual(mutated, body, 'doctoring must change the section');
  assert.ok(!mutated.includes(trustedJqSelect()), 'a changed set member in the prose must read as drift');
});

test('AC5.3: the Trusted authors section states the fixed facts', () => {
  const body = collapse(section(COMMENTS, '## Trusted authors') ?? '');
  for (const fact of [
    '`authorAssociation`',
    '`author_association`',
    'bin/lib/issues/comment-trust.js',
    'missing',
    'viewer',
  ]) {
    assert.ok(body.includes(fact), `Trusted authors section must mention: ${fact}`);
  }
});

test('AC5.2: the MCP transport paragraph filters the Supersedes lookup by author_association', () => {
  const para = paragraphStartingWith(COMMENTS, '**MCP transport');
  assert.notStrictEqual(para, null, '**MCP transport paragraph missing');
  const flat = collapse(para);
  assert.ok(flat.includes('`author_association`'), 'MCP paragraph must name author_association');
  assert.ok(flat.includes('Trusted authors'), 'MCP paragraph must cite Trusted authors');
  assert.ok(flat.includes('github-write-transport.md'), 'MCP paragraph keeps its existing transport citation');
  const pre = collapse(PRE_CHANGE_MCP_PARAGRAPH);
  assert.ok(!pre.includes('`author_association`') && !pre.includes('Trusted authors'), 'pre-change paragraph must lack both (proves the pins can go red)');
});

test("tidy's tombstone check filters by association", () => {
  const rows = SCAN.split(/\r?\n/).filter((l) => l.includes('run-comment: failure'));
  assert.strictEqual(rows.length, 1, 'exactly one scan-procedures line carries the failure tombstone marker');
  // The row lives in a markdown table cell, so each pipe between jq stages is `\|`.
  const needle = `startswith("<!-- run-comment: failure -->")) \\| ${trustedJqSelect()}`;
  assert.ok(rows[0].includes(needle), 'tombstone jq must pipe the marker select through trustedJqSelect()');
  assert.ok(!PRE_CHANGE_TOMBSTONE_ROW.includes(needle), 'needle must NOT match the pre-change tombstone row');
  assert.ok(PRE_CHANGE_TOMBSTONE_ROW.includes('run-comment: failure'), 'control carries the anchor, lacking only the filter');
});
