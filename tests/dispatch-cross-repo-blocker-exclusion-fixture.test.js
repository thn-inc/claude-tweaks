// tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js — #4793.
//
// A blocker linked natively from another repository blocks its dependent exactly when its state is
// not CLOSED (open or unreadable), and the Blocked-exclusion report names it `owner/name#N`, never
// as this repository's `#N`. The grouping snippet is extracted from queue-pull-script.md and run
// as shipped (extract-and-run, per skill-prose-conformance-tests); the two prose clauses are pinned
// with the shared fact-list helpers, each proven to go red on its own.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const DISPATCH_DIR = path.join(ROOT, 'plugin', 'skills', 'dispatch');
const QUEUE_PULL_SCRIPT = readText(path.join(DISPATCH_DIR, 'queue-pull-script.md'));
// The unquoted heredoc expands ${CLAUDE_PLUGIN_ROOT} into a JS string literal, where a Windows
// backslash path would be read as escapes — pass it with forward slashes.
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');

const START_ANCHOR = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_ELIGIBLE" "$DISPATCH_NATIVE_DEPS"';
const END_ANCHOR = '\nNODE_EVAL_EOF';

function extractGroupingSnippet() {
  const startIdx = QUEUE_PULL_SCRIPT.indexOf(START_ANCHOR);
  assert.notStrictEqual(startIdx, -1, 'extraction start anchor not found in queue-pull-script.md -- extraction is out of sync with the live file');
  const endIdx = QUEUE_PULL_SCRIPT.indexOf(END_ANCHOR, startIdx);
  assert.notStrictEqual(endIdx, -1, 'extraction end anchor not found in queue-pull-script.md -- extraction is out of sync with the live file');
  return QUEUE_PULL_SCRIPT.slice(startIdx, endIdx + END_ANCHOR.length);
}

const candidate = (number) => ({ number, labels: ['ready', 'auto:build'], body: `### Key Files\n\n- \`f${number}.js\` (modify)` });

test('a foreign open or unreadable-state native blocker excludes its record and is named owner/name#N in the exclusion (#4793)', () => {
  const snippet = extractGroupingSnippet();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-cross-repo-blocker-'));
  const file = (name) => path.join(scratch, name);

  fs.writeFileSync(file('eligible.json'), JSON.stringify([11, 12, 13, 14, 15].map(candidate)));
  fs.writeFileSync(file('native-deps.json'), JSON.stringify({
    11: { blockedBy: [5], openBlocker: true, openBlockerIds: [5], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }] },
    12: { blockedBy: [6], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 6, repository: 'other/repo', state: null }] },
    13: { blockedBy: [7], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 7, repository: 'other/repo', state: 'CLOSED' }] },
    14: { blockedBy: [8], openBlocker: true, openBlockerIds: [8] },
    15: { blockedBy: [4, 5], openBlocker: true, openBlockerIds: [4, 5], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }] },
  }));
  fs.writeFileSync(file('body-excluded.json'), '[]');

  execFileSync('bash', ['-c', snippet], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      DISPATCH_ELIGIBLE: file('eligible.json'),
      DISPATCH_NATIVE_DEPS: file('native-deps.json'),
      DISPATCH_BLOCKED_EXCLUDED_BODY: file('body-excluded.json'),
      DISPATCH_EXCLUSIONS: file('exclusions.json'),
      DISPATCH_GROUP_SIZE_GUARD: '10',
      DISPATCH_FASTLANE_BUNDLE_CAP: '3',
      DISPATCH_FASTLANE_BUNDLES: file('bundles.json'),
      DISPATCH_GROUPS: file('groups.json'),
    },
  });

  const blocked = JSON.parse(fs.readFileSync(file('exclusions.json'), 'utf8'))
    .filter((e) => e.reason === 'blocked')
    .map(({ reason, records, detail }) => ({ reason, records, detail }));
  assert.deepEqual(blocked, [
    { reason: 'blocked', records: [11], detail: { blockedBy: ['other/repo#5'] } },
    { reason: 'blocked', records: [12], detail: { blockedBy: ['other/repo#6 (state unreadable)'] } },
    { reason: 'blocked', records: [14], detail: { blockedBy: [8] } },
    { reason: 'blocked', records: [15], detail: { blockedBy: [4, 'other/repo#5'] } },
  ]);

  const groupedNumbers = JSON.parse(fs.readFileSync(file('groups.json'), 'utf8')).flat().map((r) => r.number);
  assert.ok(groupedNumbers.includes(13), 'the record whose foreign blocker is CLOSED stays eligible');
  assert.ok(
    ![11, 12, 14, 15].some((n) => groupedNumbers.includes(n)),
    'every blocked record (foreign-blocked or local) is out of the groups',
  );
});

const BODY_START_ANCHOR = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_OPEN_NUMBERS" "$DISPATCH_VERIFIED_OPEN_DEPS"';

function extractBodyPartitionSnippet() {
  const startIdx = QUEUE_PULL_SCRIPT.indexOf(BODY_START_ANCHOR);
  assert.notStrictEqual(startIdx, -1, 'body-text partition start anchor not found in queue-pull-script.md -- extraction is out of sync with the live file');
  const endIdx = QUEUE_PULL_SCRIPT.indexOf(END_ANCHOR, startIdx);
  assert.notStrictEqual(endIdx, -1, 'body-text partition end anchor not found in queue-pull-script.md -- extraction is out of sync with the live file');
  return QUEUE_PULL_SCRIPT.slice(startIdx, endIdx + END_ANCHOR.length);
}

// PATH holds only a `node` symlink, so `gh` is absent and bin/resolve-foreign-blockers.js exits 2:
// the deterministic fail-closed case. A symlink to node.exe needs privileges on a Windows checkout.
test('a body-declared foreign blocker whose state cannot be read excludes its record, naming it (state unreadable) (#4793)', { skip: process.platform === 'win32' && 'needs a node symlink' }, () => {
  const snippet = extractBodyPartitionSnippet();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-body-foreign-blocker-'));
  const file = (name) => path.join(scratch, name);
  fs.mkdirSync(file('bin'));
  fs.symlinkSync(process.execPath, path.join(file('bin'), 'node'));

  fs.writeFileSync(file('pre-dep.json'), JSON.stringify([
    { number: 21, body: 'Blocked by other/repo#5' },
    { number: 22, body: 'nothing' },
  ]));
  fs.writeFileSync(file('open.json'), '[]');
  fs.writeFileSync(file('verified-open.txt'), '');

  const res = spawnSync('/bin/bash', ['-c', snippet], {
    encoding: 'utf8',
    env: {
      PATH: file('bin'),
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      DISPATCH_ELIGIBLE_PRE_DEP: file('pre-dep.json'),
      DISPATCH_OPEN_NUMBERS: file('open.json'),
      DISPATCH_VERIFIED_OPEN_DEPS: file('verified-open.txt'),
      DISPATCH_ELIGIBLE: file('eligible.json'),
      DISPATCH_BLOCKED_EXCLUDED_BODY: file('excluded.json'),
    },
  });
  assert.strictEqual(res.status, 0, res.stderr);

  assert.deepEqual(JSON.parse(fs.readFileSync(file('excluded.json'), 'utf8')), [
    { number: 21, blockedBy: ['other/repo#5 (state unreadable)'] },
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('eligible.json'), 'utf8')).map((r) => r.number), [22]);
  assert.match(res.stderr, /foreign blocker state lookup failed/);
});

// The report and the MCP section hard-wrap at about 100 columns, so whitespace is collapsed first.
const collapse = (text) => text.replace(/\s+/g, ' ');

const REPORT_FACTS = [
  [/A `blockedBy` entry that is a string — `owner\/name#N`/, 'a string blockedBy entry is an owner/name#N foreign blocker'],
  [/renders verbatim, never with a `#` prefix/, 'a string entry renders verbatim, never with a # prefix'],
];
const MCP_FACTS = [
  [/a mention naming another repository \(`owner\/name#N`\)/i, 'a mention naming another repository is owner/name#N'],
  [/open or unreadable, it blocks/, 'a foreign blocker that is open or unreadable blocks'],
  [/suffixed ` \(state unreadable\)` when `issue_read` cannot read its state/, 'an unreadable foreign state is suffixed (state unreadable)'],
];
const NOTES_FACTS = [
  [/suffixed ` \(state unreadable\)` when its state could not be read/, 'the queue notes name an unreadable foreign state with the suffix'],
  [/`bodyForeignBlockers` \(`bin\/lib\/issues\/cross-repo-states\.js`\) looks up every such ref in one batched call/, 'the body-text pass looks up every Blocked by owner/name#N ref in one batched call'],
  [/`partitionByOpenBodyBlockers` drops the candidate while that blocker is open or its state is unreadable/, 'the body-text pass drops a candidate whose body-declared foreign blocker is open or unreadable'],
  [/a failed lookup reads unreadable \(fail closed, one `Warning:` line\)/, 'a failed body-text lookup fails closed with one Warning line'],
  [/a CLOSED one does not block/, 'a CLOSED body-declared foreign blocker does not block'],
];

test('the report and the MCP workaround name a foreign blocker owner/name#N (#4793)', () => {
  const report = collapse(readText(path.join(DISPATCH_DIR, 'blocked-exclusion-report.md')));
  const mcpSection = collapse(sectionOf(
    readText(path.join(DISPATCH_DIR, 'mcp-transport.md')),
    '## Step 2 — native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)',
  ));

  const notes = collapse(readText(path.join(DISPATCH_DIR, 'queue-pull-notes.md')));

  const missingFromReport = missingFactsOf(REPORT_FACTS);
  const missingFromMcp = missingFactsOf(MCP_FACTS);
  const missingFromNotes = missingFactsOf(NOTES_FACTS);
  assert.deepEqual(missingFromReport(report), [], 'blocked-exclusion-report.md states every fact');
  assert.deepEqual(missingFromMcp(mcpSection), [], 'mcp-transport.md states every fact');
  assert.deepEqual(missingFromNotes(notes), [], 'queue-pull-notes.md states every fact');
  assertEachPatternGoesRed(report, REPORT_FACTS, missingFromReport);
  assertEachPatternGoesRed(mcpSection, MCP_FACTS, missingFromMcp);
  assertEachPatternGoesRed(notes, NOTES_FACTS, missingFromNotes);
});
