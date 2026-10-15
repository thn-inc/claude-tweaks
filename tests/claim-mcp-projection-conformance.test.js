'use strict';
// tests/claim-mcp-projection-conformance.test.js — pins #3131's three
// observability additions on the MCP (gh-absent) transport: the
// bot:in-progress read-back-and-retry, the marker-comment composition rule
// plus read-back, and the claim-contest self-report's projection line.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The paragraph (blank-line delimited) whose first line starts with boldLead.
function paragraphStarting(md, boldLead) {
  const start = md.indexOf(`\n${boldLead}`);
  assert.ok(start !== -1, `paragraph not found: ${boldLead}`);
  const end = md.indexOf('\n\n', start + 1);
  return md.slice(start + 1, end === -1 ? md.length : end);
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
  const start = ISSUE_CLAIMS.indexOf('## The bot:in-progress label');
  const end = ISSUE_CLAIMS.indexOf('\n## ', start + 1);
  assert.ok(start !== -1 && end !== -1, 'label section anchors must exist');
  const section = ISSUE_CLAIMS.slice(start, end);
  assert.match(section, /read the labels back/i);
  assert.match(section, /retry the add once/i);
  assert.match(section, /flow\/claim-targets\.md/);
});

test('settle-and-merge.md claim-contest self-report names selection-time bot:in-progress presence from the queue snapshot', () => {
  const para = paragraphStarting(SETTLE, '**Selection-time projection line (contested-claim shape, #3131).**');
  assert.match(para, /queue pull/);
  assert.match(para, /snapshot/);
  assert.match(para, /Selection-time projection: #\{target\} \{carried\|did not carry\}/);
  const enrich = SETTLE.indexOf('**Open-linked-PR enrichment for the contested-claim shape (#2402).**');
  assert.ok(enrich !== -1 && enrich < SETTLE.indexOf(para), 'the projection line paragraph follows the #2402 enrichment paragraph');
});
