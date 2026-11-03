// tests/dispatch-unlanded-blocker-exclusion-fixture.test.js — #4792.
//
// Extract-and-run of queue-pull-script.md's unlanded-blocker pass block (the one call to
// bin/dispatch-unlanded-blockers.js) against a stub CLI under bash and zsh, plus the pins for the two
// new reason bullets and for the three passes' rationale moved to queue-pull-notes.md. The pass's own
// logic is pinned by tests/bin-lib/dispatch/unlanded-blockers*.test.js; this suite pins how the
// script calls it.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
const { parseArgs } = require('../plugin/bin/dispatch-unlanded-blockers');

const ROOT = path.join(__dirname, '..');
const QUEUE_PULL_PATH = path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md');
const QUEUE_PULL = readText(QUEUE_PULL_PATH);
const NOTES = path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-notes.md');
const SKILL_PATH = path.join(ROOT, 'plugin', 'skills', 'dispatch', 'SKILL.md');

const PASS_ANCHOR = '# #4792: unlanded-blocker and malformed-blocker exclusions.';
const SHIPPED_STAGE = '--id "shipped-close-$NUM"';
const NEIGHBOUR = '# #3278: neighbour-in-flight pass.';

function extractPassBlock(text) {
  const start = text.indexOf(PASS_ANCHOR);
  assert.notEqual(start, -1, `extraction start anchor not found: ${PASS_ANCHOR}`);
  const fi = text.indexOf('\nfi', start);
  assert.notEqual(fi, -1, 'closing fi not found after the #4792 anchor');
  return text.slice(start, fi + '\nfi'.length);
}

// Each marker must exist before the order is checked, so a reworded marker fails as missing, not as
// a vacuous pass.
function requireOrder(text, markers) {
  const at = markers.map((m) => text.indexOf(m));
  at.forEach((idx, i) => assert.notEqual(idx, -1, `marker missing: ${markers[i]}`));
  for (let i = 1; i < markers.length; i++) {
    assert.ok(at[i] > at[i - 1], `${markers[i]} must come after ${markers[i - 1]}`);
  }
}

const SHELLS = [
  ['bash', ['--noprofile', '--norc']],
  ['zsh', ['-f']],
];
const zshMissing = () => Boolean(spawnSync('zsh', ['-f', '-c', 'true']).error);

const STUB_CLI = [
  "'use strict';",
  "require('node:fs').writeFileSync(process.env.STUB_ARGV, JSON.stringify(process.argv.slice(2)));",
  'process.stdout.write(process.env.STUB_OUT);',
  'process.exitCode = Number(process.env.STUB_EXIT);',
].join('\n');

const INPUT_GROUPS = '[[{"number":1}],[{"number":2}]]';

// Runs `block` under one shell against a scratch dir holding the pull's two files and a stub plugin root.
function runBlock(shell, block, { exit, out }) {
  const flags = SHELLS.find(([name]) => name === shell)[1];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unlanded-pass-'));
  try {
    const pluginRoot = path.join(dir, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'bin', 'dispatch-unlanded-blockers.js'), STUB_CLI);
    const groups = path.join(dir, 'dispatch-groups.json');
    const exclusions = path.join(dir, 'dispatch-exclusions.json');
    const argvFile = path.join(dir, 'argv.json');
    fs.writeFileSync(groups, INPUT_GROUPS);
    fs.writeFileSync(exclusions, '[]');
    const r = spawnSync(shell, [...flags, '-c', block], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot.split(path.sep).join('/'),
        DISPATCH_GROUPS: groups,
        DISPATCH_EXCLUSIONS: exclusions,
        INTEGRATION_BRANCH: 'main',
        WORK_LINKS: 'body-text',
        STUB_ARGV: argvFile,
        STUB_EXIT: String(exit),
        STUB_OUT: out,
      },
    });
    return {
      status: r.status,
      stderr: r.stderr,
      groups: fs.readFileSync(groups, 'utf8'),
      tmpLeft: fs.existsSync(`${groups}.tmp`),
      argv: fs.existsSync(argvFile) ? JSON.parse(fs.readFileSync(argvFile, 'utf8')) : null,
      files: { groups, exclusions },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const [shell] of SHELLS) {
  test(`AC3.1: the pass block replaces dispatch-groups.json with the CLI's pool on exit 0, under ${shell}`, (t) => {
    if (shell === 'zsh' && zshMissing()) return t.skip('zsh not on PATH');
    const block = extractPassBlock(QUEUE_PULL);
    const r = runBlock(shell, block, { exit: 0, out: '[[{"number":1}]]' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.groups), [[{ number: 1 }]]);
    assert.equal(r.tmpLeft, false);
    assert.equal(r.argv[0], '--groups');
    assert.equal(r.argv[2], '--exclusions');
    assert.deepEqual(r.argv.filter((_, i) => i !== 1 && i !== 3),
      ['--groups', '--exclusions', '--integration-branch', 'main', '--work-links', 'body-text']);
    assert.equal(r.argv[1], r.files.groups);
    assert.equal(r.argv[3], r.files.exclusions);
    const parsed = parseArgs(r.argv);
    assert.equal(parsed.error, undefined, `the shipped CLI's own parseArgs rejects the block's argv: ${parsed.error}`);
  });

  test(`the pass block stops the queue pull on a non-zero CLI exit and leaves dispatch-groups.json untouched, under ${shell}`, (t) => {
    if (shell === 'zsh' && zshMissing()) return t.skip('zsh not on PATH');
    const block = extractPassBlock(QUEUE_PULL);
    const r = runBlock(shell, block, { exit: 1, out: '' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /queue-pull stopped -- unlanded-blocker exclusion pass failed/);
    assert.equal(r.groups, INPUT_GROUPS);
    assert.equal(r.tmpLeft, false);
  });
}

test('the pass sits after the shipped Close-proposal staging and before the neighbour-in-flight pass', () => {
  requireOrder(QUEUE_PULL, [SHIPPED_STAGE, PASS_ANCHOR, NEIGHBOUR]);

  // Permutation control: the block spliced above the shipped staging's own opening line.
  const block = extractPassBlock(QUEUE_PULL);
  const without = QUEUE_PULL.replace(block, '');
  assert.notEqual(without, QUEUE_PULL, 'splice-out matched nothing');
  const opener = 'DISPATCH_FIRING_RUN_DIR=$(node';
  const openerAt = without.indexOf(opener);
  assert.notEqual(openerAt, -1, `opener not found: ${opener}`);
  const permuted = `${without.slice(0, openerAt)}${block}\n${without.slice(openerAt)}`;
  assert.notEqual(permuted, QUEUE_PULL);
  assert.throws(() => requireOrder(permuted, [SHIPPED_STAGE, PASS_ANCHOR, NEIGHBOUR]), /must come after/);

  // Deletion control: the existence half goes red with its own message.
  const deleted = QUEUE_PULL.replace(PASS_ANCHOR, '');
  assert.notEqual(deleted, QUEUE_PULL);
  assert.throws(() => requireOrder(deleted, [SHIPPED_STAGE, PASS_ANCHOR, NEIGHBOUR]), /marker missing/);
});

test("AC3.1: the unlanded-blocker reason bullet states its posture", () => {
  const bullet = lineStartingWith(QUEUE_PULL, "- `reason: 'unlanded-blocker'`");
  assert.notEqual(bullet, '', "the `reason: 'unlanded-blocker'` bullet is missing");
  const facts = [
    [/`preflight-records\.js --blocker-landing` judges `unlanded`/, 'judged by preflight-records'],
    [/This one DOES remove excluded candidates from `dispatch-groups\.json`, with no `#N`\/`#N,#M,\.\.\.` bypass/, 'removing, no bypass'],
    [/eligible again on the first pull after its blocker lands/, 'AC3.1: eligible again once landed'],
    [/fails open: an `undetermined` verdict keeps the candidate,/, 'undetermined keeps the candidate'],
    [/and a failed `preflight-records\.js` call excludes no `unlanded-blocker` record/, 'a whole-call failure excludes no unlanded-blocker record'],
  ];
  const missing = missingFactsOf(facts);
  assert.deepEqual(missing(bullet), []);
  assertEachPatternGoesRed(bullet, facts, missing);
  assert.ok(!bullet.includes('stay IN `dispatch-groups.json`'), 'a removing reason must not carry the stay-IN marker');
});

test('AC4.2 AC4.3: the malformed-blocker reason bullet states its faults and that the rest are still checked', () => {
  const bullet = lineStartingWith(QUEUE_PULL, "- `reason: 'malformed-blocker'`");
  assert.notEqual(bullet, '', "the `reason: 'malformed-blocker'` bullet is missing");
  const lines = QUEUE_PULL.split('\n');
  const unlandedAt = lines.findIndex((l) => l.startsWith("- `reason: 'unlanded-blocker'`"));
  assert.notEqual(unlandedAt, -1);
  assert.equal(lines[unlandedAt + 1], bullet, 'the malformed-blocker bullet must sit directly after the unlanded-blocker bullet');
  const facts = [
    [/whose blocker declaration that pass cannot check, because it would fail the pass's `preflight-records\.js` call for the whole pull or names no issue that can exist/, 'AC4.3: why it is excluded'],
    [/a `Blocked by` line naming no valid issue number \(`#0`, or above 2147483647, under every `work-links` value\)/, 'AC4.3: the body fault and its bound'],
    [/no entry in the native dependency response/, 'AC4.3: the native fault'],
    [/Removed the same way, with no bypass/, 'AC4.3: not dispatched'],
    [/eligible again on the first pull after its blocker declaration can be checked/, 'AC4.3: eligible again once fixed'],
    [/every other candidate is still checked/, 'AC4.2: no other record loses the check'],
  ];
  const missing = missingFactsOf(facts);
  assert.deepEqual(missing(bullet), []);
  assertEachPatternGoesRed(bullet, facts, missing);
  assert.ok(!bullet.includes('stay IN `dispatch-groups.json`'), 'a removing reason must not carry the stay-IN marker');
});

test("three passes' rationale moved to queue-pull-notes.md, one pointer line each", () => {
  for (const prefix of ['# #2829: not-spec-shaped exclusion.', '# #1224: open-linked-PR exclusion.', '# #1983: named-target existence exclusion.']) {
    const line = lineStartingWith(QUEUE_PULL, prefix);
    assert.notEqual(line, '', `pointer line missing: ${prefix}`);
    assert.ok(line.endsWith('queue-pull-notes.md.'), `${prefix} must end with a pointer to queue-pull-notes.md: ${line}`);
  }

  const notes = readText(NOTES);
  const section = sectionOf(notes, '## Where four exclusion passes sit, and why');
  for (const label of ['**Not-spec-shaped pass (#2829).**', '**Open-linked-PR pass (#1224).**', '**Named-target existence pass (#1983).**', '**Unlanded-blocker pass (#4792).**']) {
    assert.ok(section.includes(label), `section lacks ${label}`);
  }
  const paragraphs = section.split(/\n\n/);
  const last = paragraphs[paragraphs.length - 1];
  assert.ok(last.startsWith('**Unlanded-blocker pass (#4792).**'), 'the last paragraph is the unlanded-blocker one');
  const facts = [
    [/is excluded as `malformed-blocker` instead/, 'excluded as malformed-blocker'],
    [/the call re-run once without it/, 'one re-run'],
    [/Every other candidate is still checked/, 'every other candidate is still checked'],
    [/Only a whole-call failure/, 'only a whole-call failure fails open'],
    [/the `malformed-blocker` exclusions stand/, 'malformed-blocker exclusions stand'],
  ];
  const missing = missingFactsOf(facts);
  assert.deepEqual(missing(last), []);
  assertEachPatternGoesRed(last, facts, missing);

  // Absence of the moved rationale, whitespace-collapsed so a respelling across a line wrap cannot hide it.
  const collapse = (s) => s.replace(/\s+/g, ' ');
  const movedLiterals = ["(#2786's evidence)", 'transient state the freshness signal', 'unsatisfiable by construction'];
  const stillPresent = (text) => movedLiterals.filter((lit) => collapse(text).includes(lit));
  assert.deepEqual(stillPresent(QUEUE_PULL), []);
  // Control: appending each literal makes the check report exactly that literal.
  for (const lit of movedLiterals) {
    assert.deepEqual(stillPresent(`${QUEUE_PULL}\n# ${lit}`), [lit], `the absence check cannot see ${lit}`);
  }
});

test('queue-pull-script.md and SKILL.md fit the Read rail after the pass and the move', () => {
  for (const file of [QUEUE_PULL_PATH, SKILL_PATH]) {
    const bytes = Buffer.byteLength(readText(file));
    assert.ok(bytes <= RAIL_BYTES, `${path.basename(file)} is ${bytes} B, over the ${RAIL_BYTES} B rail`);
  }
});
