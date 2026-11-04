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
const { pathWithOnly } = require('./helpers/path-stub');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const DISPATCH_DIR = path.join(ROOT, 'plugin', 'skills', 'dispatch');
const QUEUE_PULL_SCRIPT = readText(path.join(DISPATCH_DIR, 'queue-pull-script.md'));
// The unquoted heredoc expands ${CLAUDE_PLUGIN_ROOT} into a JS string literal, where a Windows
// backslash path would be read as escapes — pass it with forward slashes.
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');

const START_ANCHOR = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_ELIGIBLE" "$DISPATCH_NATIVE_DEPS"';
const END_ANCHOR = '\nNODE_EVAL_EOF';

function extractSnippet(startAnchor, label) {
  const startIdx = QUEUE_PULL_SCRIPT.indexOf(startAnchor);
  assert.notStrictEqual(startIdx, -1, `${label} start anchor not found in queue-pull-script.md -- extraction is out of sync with the live file`);
  const endIdx = QUEUE_PULL_SCRIPT.indexOf(END_ANCHOR, startIdx);
  assert.notStrictEqual(endIdx, -1, `${label} end anchor not found in queue-pull-script.md -- extraction is out of sync with the live file`);
  return QUEUE_PULL_SCRIPT.slice(startIdx, endIdx + END_ANCHOR.length);
}

const candidate = (number) => ({ number, labels: ['ready', 'auto:build'], body: `### Key Files\n\n- \`f${number}.js\` (modify)` });

test('a foreign open or unreadable-state native blocker excludes its record and is named owner/name#N in the exclusion (#4793)', () => {
  const snippet = extractSnippet(START_ANCHOR, 'grouping snippet');
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

// PATH holds node and bash but never gh (pathWithOnly), so bin/resolve-foreign-blockers.js exits 2:
// the deterministic fail-closed case.
test('a body-declared foreign blocker whose state cannot be read excludes its record, naming it (state unreadable) (#4793)', () => {
  const snippet = extractSnippet(BODY_START_ANCHOR, 'body-text partition snippet');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-body-foreign-blocker-'));
  const file = (name) => path.join(scratch, name);

  fs.writeFileSync(file('pre-dep.json'), JSON.stringify([
    { number: 21, body: 'Blocked by other/repo#5' },
    { number: 22, body: 'nothing' },
  ]));
  fs.writeFileSync(file('open.json'), '[]');
  fs.writeFileSync(file('verified-open.txt'), '');

  const res = spawnSync('bash', ['-c', snippet], {
    encoding: 'utf8',
    env: {
      PATH: pathWithOnly(['node', 'bash'], { exclude: ['gh'] }),
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
  assert.match(res.stderr, /foreign blocker state lookup failed \(exit 2: resolve-foreign-blockers\.js: `gh` is required\)/);
});

// The gh-absent MCP firing: the agent reads each foreign ref with issue_read and exports the states
// file as DISPATCH_FOREIGN_STATES. PATH still holds no gh, so only a supplied state can answer.
function runBodyPass(statesFile) {
  const snippet = extractSnippet(BODY_START_ANCHOR, 'body-text partition snippet');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-body-foreign-states-'));
  const file = (name) => path.join(scratch, name);
  fs.writeFileSync(file('pre-dep.json'), JSON.stringify([
    { number: 31, body: 'Blocked by other/repo#5' },
    { number: 32, body: 'Blocked by Other/Repo#6' },
    { number: 33, body: 'Blocked by other/repo#7' },
    { number: 34, body: 'nothing' },
  ]));
  fs.writeFileSync(file('open.json'), '[]');
  fs.writeFileSync(file('verified-open.txt'), '');
  const env = {
    PATH: pathWithOnly(['node', 'bash'], { exclude: ['gh'] }),
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    DISPATCH_ELIGIBLE_PRE_DEP: file('pre-dep.json'),
    DISPATCH_OPEN_NUMBERS: file('open.json'),
    DISPATCH_VERIFIED_OPEN_DEPS: file('verified-open.txt'),
    DISPATCH_ELIGIBLE: file('eligible.json'),
    DISPATCH_BLOCKED_EXCLUDED_BODY: file('excluded.json'),
  };
  if (statesFile) env.DISPATCH_FOREIGN_STATES = statesFile(file);
  const res = spawnSync('bash', ['-c', snippet], { encoding: 'utf8', env });
  assert.strictEqual(res.status, 0, res.stderr);
  return {
    res,
    excluded: JSON.parse(fs.readFileSync(file('excluded.json'), 'utf8')),
    eligible: JSON.parse(fs.readFileSync(file('eligible.json'), 'utf8')).map((r) => r.number),
  };
}

test('a supplied DISPATCH_FOREIGN_STATES file lets a CLOSED foreign blocker group, excludes an OPEN one by name, and leaves an absent key unreadable (#4793)', () => {
  const { res, excluded, eligible } = runBodyPass((file) => {
    fs.writeFileSync(file('states.json'), JSON.stringify({ 'other/repo#5': 'CLOSED', 'OTHER/REPO#6': 'OPEN' }));
    return file('states.json');
  });
  assert.deepEqual(excluded, [
    { number: 32, blockedBy: ['Other/Repo#6'] },
    { number: 33, blockedBy: ['other/repo#7 (state unreadable)'] },
  ]);
  assert.deepEqual(eligible, [31, 34]);
  assert.match(res.stderr, /foreign blocker state lookup failed \(exit 2: resolve-foreign-blockers\.js: `gh` is required\)/, 'the left-out ref still takes the gh-absent path');
});

test('a DISPATCH_FOREIGN_STATES that is unset behaves as before, and one that names an unreadable file warns once and fails closed (#4793)', () => {
  const unset = runBodyPass(null);
  assert.deepEqual(unset.eligible, [34]);
  assert.deepEqual(unset.excluded.map((e) => e.blockedBy), [
    ['other/repo#5 (state unreadable)'], ['Other/Repo#6 (state unreadable)'], ['other/repo#7 (state unreadable)'],
  ]);

  const missing = runBodyPass((file) => file('no-such-states.json'));
  assert.deepEqual(missing.eligible, [34]);
  assert.strictEqual(missing.excluded.length, 3);
  const warnings = missing.res.stderr.split('\n').filter((l) => /^Warning: foreign blocker states file /.test(l));
  assert.strictEqual(warnings.length, 1, missing.res.stderr);
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
  [/suffixed ` \(state unreadable\)` when `issue_read` cannot read its state/, 'an unreadable foreign state is suffixed (state unreadable)'],  [/read each with `issue_read` \(`get` method; its `owner`, `repo` and `issue_number`\)/, 'the MCP agent reads each body-declared foreign ref with issue_read'],
  [/write the states as one JSON object keyed by `owner\/name#N`, each value `"OPEN"`, `"CLOSED"` or `null`/, 'the MCP agent writes the states as a JSON object keyed by owner/name#N'],
  [/Export its path as `DISPATCH_FOREIGN_STATES` for the pass/i, 'the MCP agent exports the states file path as DISPATCH_FOREIGN_STATES'],
  [/A ref left out of the file, or `null`, still excludes the record as `owner\/name#N \(state unreadable\)` \(fail closed\)/i, 'a ref left out or null still excludes the record (state unreadable)'],
];
const NOTES_FACTS = [
  [/suffixed ` \(state unreadable\)` when its state could not be read/, 'the queue notes name an unreadable foreign state with the suffix'],
  [/`bodyForeignBlockers` \(`bin\/lib\/issues\/cross-repo-states\.js`\) looks up every such ref in one batched call/, 'the body-text pass looks up every Blocked by owner/name#N ref in one batched call'],
  [/`partitionByOpenBodyBlockers` drops the candidate while that blocker is open or its state is unreadable/, 'the body-text pass drops a candidate whose body-declared foreign blocker is open or unreadable'],
  [/a failed lookup reads unreadable \(fail closed, one `Warning:` line\)/, 'a failed body-text lookup fails closed with one Warning line'],
  [/naming it `owner\/name#N` or `owner\/name#N \(state unreadable\)`/, 'the body-text pass names a blocker owner/name#N or owner/name#N (state unreadable)'],
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
