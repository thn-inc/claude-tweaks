'use strict';
// #5882 — pins plugin/skills/_shared/release-block.md: its section order, the setters and
// clearing acts, the forge-keyed skip, the exit-code tables, the stamp-comment twin of
// bin/release-block.js, and the gh-absent (MCP) equivalents. Go-red controls run the same
// helpers on mutated or frozen copies (skill-prose-conformance-tests).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { stampCommentBody } = require('../plugin/bin/release-block');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'release-block.md');
const text = readText(FILE);

const HEADINGS = [
  '## What sets a block',
  '## How a block clears',
  '## The CLI',
  '### Stamp comment',
  '## What a release does while a block is open',
  '## gh-absent (MCP) path',
  '## What this does not stop',
];

function assertContractSections(src) {
  let last = -1;
  const lines = src.split('\n');
  for (const h of HEADINGS) {
    const idx = lines.indexOf(h);
    assert.notStrictEqual(idx, -1, `missing heading: ${h}`);
    assert.ok(idx > last, `heading out of order: ${h}`);
    last = idx;
  }
}

// The slice from a heading line to the next heading of the same or higher level.
function section(src, heading) {
  const lines = src.split('\n');
  const start = lines.indexOf(heading);
  assert.notStrictEqual(start, -1, `missing heading: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+) /);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

const REL = '## What a release does while a block is open';
const SKIP_LINE = 'condition: no GitHub origin (_shared/forge-detection.md check 1)';
function assertForgeKeyedSkip(src) {
  assert.ok(section(src, REL).includes(SKIP_LINE), 'skip line must be forge-keyed');
  assert.ok(!src.includes('condition: work-backend'), 'no work-backend condition anywhere');
}

// The superseded line, frozen (spec Plan Review Clarifications): keyed on work-backend.
const SUPERSEDED_SKIP = 'SKIP … — Step 1.5 release-block check (skipped): condition: work-backend local-files → fallback: no forge label to read; release proceeds. Reversibility: n/a.';

function assertGhBeforeBash(rel) {
  const detect = rel.indexOf('command -v gh');
  const bash = rel.indexOf('release-block.js" check');
  assert.ok(detect !== -1, 'command -v gh is named');
  assert.ok(bash !== -1, 'the bash check is named');
  assert.ok(detect < bash, 'command -v gh must precede the bash check');
}

// The fenced `text` block under ### Stamp comment.
function stampFence(src) {
  const m = section(src, '### Stamp comment').match(/```text\n([\s\S]*?)\n```/);
  assert.ok(m, 'Stamp comment needs a ```text fence');
  return m[1];
}
function assertStampTwin(fence) {
  assert.strictEqual(fence.replace('{finding}', 'X at general'), stampCommentBody('X at general').replace(/\n+$/, ''));
}

test('contract: every section heading is present, in order', () => {
  assertContractSections(text);
  const mutated = text.replace('## How a block clears\n', '');
  assert.notStrictEqual(mutated, text);
  assert.throws(() => assertContractSections(mutated), { message: /missing heading: ## How a block clears/ });
});

test('contract: sets and clears', () => {
  const sets = section(text, '## What sets a block');
  assert.match(sets, /critical or high/);
  assert.match(sets, /rolling review/);
  assert.match(sets, /delta review/);
  assert.match(sets, /Step 8's disposition/);
  assert.match(sets, /a human/);
  assert.ok(sets.includes('declined (covered by #{n})'), 'covering-record stamp');
  const clears = section(text, '## How a block clears');
  assert.match(clears, /close the record/);
  assert.match(clears, /remove the label/);
  assert.match(clears, /no reason is required/i);
});

test('contract: forge-keyed skip', () => {
  assertForgeKeyedSkip(text);
  const swapped = text.replace(/SKIP …[^\n]*\n?/, `${SUPERSEDED_SKIP}\n`);
  assert.notStrictEqual(swapped, text);
  assert.throws(() => assertForgeKeyedSkip(swapped), { message: /forge-keyed|work-backend/ });
  assert.throws(() => assertForgeKeyedSkip(`${text}\n${SUPERSEDED_SKIP}\n`), { message: /no work-backend condition/ });
});

test('contract: gh detected before the bash check', () => {
  const rel = section(text, REL);
  assertGhBeforeBash(rel);
  assert.match(rel, /gh absent[\s\S]{0,200}## gh-absent \(MCP\) path/);
  assert.match(rel, /no new exit code/);
  assert.match(rel, /unavailable[\s\S]{0,60}exit 3/);
  // Control: the same text with the two markers swapped must fail the order check.
  const swapped = rel.replace('command -v gh', '@@').replace('release-block.js" check', 'command -v gh').replace('@@', 'release-block.js" check');
  assert.throws(() => assertGhBeforeBash(swapped), { message: /must precede/ });
});

test('contract: exit codes', () => {
  const cli = section(text, '## The CLI');
  for (const row of [/\| 0 \| none open/, /\| 1 \| blocked/, /\| 2 \| usage/, /\| 3 \| state unreadable/]) assert.match(cli, row);
  assert.match(cli, /stamp[\s\S]*\| 0 \| stamped or already stamped/);
  assert.ok(cli.includes('{"blocked":true,"records":[{"number":N,"title":"…","url":"…"}]}'), 'exit-1 JSON shape');
  assert.match(cli, /fills `--limit 100`/);
  assert.match(cli, /missing label reads as none/);
});

test('contract: stamp comment twin', () => {
  assertStampTwin(stampFence(text));
  assert.throws(() => assertStampTwin(`${stampFence(text)} extra`), { name: 'AssertionError' });
});

test('AC2.1: a held release names each blocking record in release-held.md', () => {
  const rel = section(text, REL);
  assert.match(rel, /release-held\.md/);
  assert.match(rel, /`release-block`/);
  assert.ok(rel.includes('#N {title} {url}'));
  assert.match(rel, /effective version and its base/);
  assert.match(rel, /clearing act/);
  assert.match(rel, /No autonomy ceiling/);
  assert.match(rel, /re-runs `check`/);
});

test('contract: MCP path', () => {
  const mcp = section(text, '## gh-absent (MCP) path');
  assert.match(mcp, /`list_issues`[^\n]*release-block[^\n]*open[^\n]*`perPage: 100`/);
  assert.ok(mcp.includes('{number, title, url, state}'));
  assert.ok(mcp.includes('release-block.js" check --records-json'));
  assert.match(mcp, /unavailable or erroring[^\n]*exit 3/);
  assert.match(mcp, /`issue_read`/);
  assert.match(mcp, /`issue_write`[^\n]*`mergeLabelNames`[^\n]*Full-replace hazard/);
  assert.ok(mcp.includes('_shared/github-write-transport.md'));
  assert.match(mcp, /`add_issue_comment`/);
  assert.match(mcp, /`label create` has no MCP row/);
});
