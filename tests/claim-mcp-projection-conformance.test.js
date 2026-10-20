'use strict';
// tests/claim-mcp-projection-conformance.test.js — pins #3131's three
// observability additions on the MCP (gh-absent) transport: the
// bot:in-progress read-back-and-retry, the marker-comment composition rule
// plus read-back, and the claim-contest self-report's projection line.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

// The paragraph (blank-line delimited) whose first line starts with boldLead.
function paragraphStarting(md, boldLead) {
  const start = md.indexOf(`\n${boldLead}`);
  assert.ok(start !== -1, `paragraph not found: ${boldLead}`);
  const end = md.indexOf('\n\n', start + 1);
  return md.slice(start + 1, end === -1 ? md.length : end);
}

// The section from a `## Heading` line up to (not including) the next `## ` heading.
function sectionStarting(md, heading) {
  const start = md.indexOf(heading);
  const end = md.indexOf('\n## ', start + 1);
  assert.ok(start !== -1 && end !== -1, `section anchors must exist: ${heading}`);
  return md.slice(start, end);
}

const CLAIM_TARGETS = read('plugin/skills/flow/claim-targets.md');
const ISSUE_CLAIMS = read('plugin/skills/_shared/issue-claims.md');
const SETTLE = read('plugin/skills/dispatch/settle-and-merge.md');

test('claim-targets.md MCP branch reads back bot:in-progress, retries once via mergeLabelNames, traces with SKIP, keeps the claim', () => {
  const para = paragraphStarting(CLAIM_TARGETS, '**Read back the `bot:in-progress` add (MCP, #3131).**');
  assert.match(para, /issue_read/);
  assert.match(para, /mergeLabelNames/);
  assert.match(para, /once/);
  assert.match(para, /--status SKIP/);
  assert.match(para, /\(degraded\)/);
  assert.match(para, /never aborted/);
  const mcpBranch = CLAIM_TARGETS.indexOf('This CLI is the `gh` transport only');
  const confirm = CLAIM_TARGETS.indexOf('**Confirming the manual MCP path actually landed (#1728).**');
  const here = CLAIM_TARGETS.indexOf(para);
  assert.ok(mcpBranch < here && here < confirm, 'the read-back paragraph sits between the MCP branch and the #1728 confirmation');
});

test('issue-claims.md states the MCP read-back-and-retry obligation in the bot:in-progress label section', () => {
  const section = sectionStarting(ISSUE_CLAIMS, '## The bot:in-progress label');
  assert.match(section, /read the labels back/i);
  assert.match(section, /retry the add once/i);
  assert.match(section, /flow\/claim-targets\.md/);
});

test('settle-and-merge.md claim-contest self-report compares selection time with the holder claim time', () => {
  const para = paragraphStarting(SETTLE, '**Selection-time projection line (contested-claim shape, #3131).**');
  assert.match(para, /task-prompt\.md` item 8/);
  assert.match(para, /Selection-time projection: #\{target\} selected at \{Selected at\} without `bot:in-progress`; holder claimed \{claimedAt\}/);
  assert.match(para, /projection gap if earlier, else race/);
  assert.match(para, /holder claim unreadable/);
  assert.match(para, /Dedup hit: once-per-build comment only/);
  const enrich = SETTLE.indexOf('**Open-linked-PR enrichment for the contested-claim shape (#2402).**');
  assert.ok(enrich !== -1 && enrich < SETTLE.indexOf(para), 'the projection line paragraph follows the #2402 enrichment paragraph');
});

test('task-prompt.md context pack threads the selection time into the Task call (#3131)', () => {
  const prompt = read('plugin/skills/dispatch/task-prompt.md');
  const start = prompt.indexOf('## Context pack');
  const end = prompt.indexOf('Substitute this whole block', start);
  assert.ok(start !== -1 && end !== -1, 'context pack anchors must exist');
  const pack = prompt.slice(start, end);
  assert.match(pack, /^8\. \*\*Selected at\*\* \(#3131\)/m);
  assert.match(pack, /`Selected at: \{ISO\}`/);
  assert.match(pack, /dispatch-groups\.json/);
  assert.match(pack, /`Selected at: unknown`/);
  assert.match(pack, /sessionTmpPath/);
  assert.match(prompt, /resolved seven of these facts/);
});

const TRANSPORT = read('plugin/skills/_shared/github-write-transport.md');
const RUN_COMMENTS = read('plugin/skills/_shared/pr-run-comments.md');

test('github-write-transport.md comment row and MCP marker subsection carry the composition rule, evidence and read-back', () => {
  const row = TRANSPORT.split('\n').find((l) => l.startsWith('| Comment |'));
  assert.ok(row, 'Comment CRUD row must exist');
  assert.match(row, /Marker comments on the MCP path/);
  const start = TRANSPORT.indexOf('### Marker comments on the MCP path');
  const end = TRANSPORT.indexOf('### Full-replace hazard');
  assert.ok(start !== -1 && end !== -1 && start < end, 'subsection sits before Full-replace hazard');
  const sub = TRANSPORT.slice(start, end);
  assert.match(sub, /&lt;!--/);
  assert.match(sub, /never from text read back through an MCP tool/);
  assert.match(sub, /performed_via_github_app/);
  assert.match(sub, /begin(s|ning) `&lt;!--`/);
  assert.match(sub, /--status SKIP/);
  assert.match(sub, /post the same locally composed body once more/);
  assert.match(sub, /not yet identified/);
  assert.match(sub, /No-run-dir/);
  assert.match(sub, /A read-back call that fails outright counts\s+as not escaped/);
  assert.match(sub, /orphan to delete by hand/);
  assert.doesNotMatch(sub, /composed from sanitized reads/);
  assert.doesNotMatch(sub, /byte for byte/);
});

test('pr-run-comments.md post-or-update has an MCP read-back for the run-comment marker', () => {
  const para = paragraphStarting(RUN_COMMENTS, '**MCP transport (no `gh`, #3131).**');
  assert.match(para, /add_issue_comment/);
  assert.match(para, /Marker comments on the MCP path/);
  assert.match(para, /read back/i);
  assert.match(para, /begins `&lt;!--`/);
  const create = RUN_COMMENTS.indexOf('3. **Not found → create**');
  const failure = RUN_COMMENTS.indexOf('**On failure of either the find or the write**');
  const here = RUN_COMMENTS.indexOf(para);
  assert.ok(create < here && here < failure, 'the MCP paragraph sits between step 3 and the failure paragraph');
});

test('issue-claims.md mirror section points MCP posts at the marker composition rule', () => {
  const section = sectionStarting(ISSUE_CLAIMS, '## The mirror');
  assert.match(section, /Marker comments on the MCP path/);
});

test('claim-mcp: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const FILE = path.join(ROOT, 'plugin/skills/flow/claim-targets.md');
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  assert.match(paragraphStarting(text, '**Read back the `bot:in-progress` add (MCP, #3131).**'), /mergeLabelNames/);
});
