'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { readText } = require('./helpers/read-skill');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

test('AC1.1: review console classifies CI from pack.pr.value.ci (pr-checks.js), not the rollup alone', () => {
  const t = read('plugin/skills/wrap-up/review-console-interactive.md');
  const start = t.indexOf('**`integration-model: pr-first`** — read the PR\'s live CI status');
  const end = t.indexOf('Exactly one of options 1 and 2');
  assert.ok(start >= 0 && end > start, 'the pr-first paragraph and its Exactly-one trailer are both found');
  const slice = t.slice(start, end);
  for (const needle of ['pack.pr.value.ci', 'pr-checks.js" --pr', 'pending', 'read-failed', '`CI: {ci.state}`', 'reads `CI: pending`']) {
    assert.ok(slice.includes(needle), `slice names ${needle}`);
  }
  assert.ok(!slice.includes('pr-checks.js" --run'), 'the pack-absent fallback reads the PR head (--pr), not --run, which reads stale off a differing local HEAD');
  assert.ok(!slice.includes('--json state,mergeStateStatus,headRefOid,statusCheckRollup'), 'the inline rollup read is retired');
  const opt1 = slice.slice(slice.indexOf('- Option 1'), slice.indexOf('- Option 2'));
  const opt2 = slice.slice(slice.indexOf('- Option 2'), slice.indexOf('- Option 3'));
  assert.match(opt1, /Recommended[^\n]*green[^\n]*pending[^\n]*stale/, 'option 1 names stale alongside green/pending');
  assert.ok(opt2.includes('inherited-red'), 'option 2 names inherited-red');
});

test('AC1.1: settle-parked reads CI through pr-checks.js --pr and maps its states', () => {
  const t = read('plugin/skills/dispatch/settle-parked.md');
  const start = t.indexOf('## Step 2:');
  const end = t.indexOf('## Step 4:');
  assert.ok(start >= 0 && end > start, 'Step 2 through Step 3 is found');
  const slice = t.slice(start, end);
  assert.ok(slice.includes('pr-checks.js" --pr {n}'), 'the CI read runs pr-checks.js --pr {n}');
  assert.ok(!slice.includes('statusCheckRollup'), 'the raw rollup read is retired');
  const bullet = slice.slice(slice.indexOf('- **CI status**'), slice.indexOf('- **Files changed**'));
  assert.ok(bullet.length > 0, 'the CI status bullet is found');
  for (const needle of ['pending', 'green', 'no-ci', 'passing', 'red', 'inherited-red', 'failing', 'read-failed', 'gh-absent', 'unavailable']) {
    assert.ok(bullet.includes(needle), `CI status bullet names ${needle}`);
  }
  assertCiPairings(bullet);
  // Negative control: the same assertions must throw when pending is mapped to passing.
  const doctored = bullet.replace('`pending` → `pending`', '`pending` → `passing`');
  assert.notStrictEqual(doctored, bullet, 'the doctoring changed the bullet');
  assert.throws(() => assertCiPairings(doctored), /pending/, 'a pending -> passing mapping is rejected');
});

// Pins each state-to-vocabulary pairing in the settle-parked CI status bullet, not just the tokens.
function assertCiPairings(bullet) {
  assert.match(bullet, /`pending` → `pending`/, 'pending maps to pending');
  assert.match(bullet, /`green`\/`no-ci` → `passing`/, 'green/no-ci map to passing');
  assert.match(bullet, /`red`\/`inherited-red` → `failing`/, 'red/inherited-red map to failing');
  assert.match(bullet, /`read-failed`\/`gh-absent` → `unavailable`/, 'read-failed/gh-absent map to unavailable');
}

const PR_SCAN = 'plugin/skills/_shared/github-pr-scan.md';

function item9Slice() {
  const t = read(PR_SCAN);
  const start = t.indexOf('9. **Unarmed ready PR**');
  const end = t.indexOf('10. **Unsettled run**', start);
  assert.ok(start >= 0 && end > start, 'item 9 slice is found');
  return t.slice(start, end);
}

// The extraction sweep-backstop.test.js uses: node -e bodies closing on a bare `"` line.
function item9Scripts() {
  const scripts = [];
  const re = /node -e "\n([\s\S]*?)\n\s*"/g;
  const section = item9Slice();
  let m;
  while ((m = re.exec(section)) !== null) scripts.push(m[1].replace(/\\"/g, '"').replace(/\\\$/g, '$'));
  return scripts;
}

// The candidates path is spliced into JS single-quoted literals, so a native win32 path
// must be forward-slashed first (#3699). The sep parameter lets a test pass path.win32.sep.
// Safe to open afterwards: Node accepts "/" on win32 and production's formatPrintedPath prints it so.
function substituteCandidates(script, candidatesFile, sep = path.sep) {
  // A function replacement keeps "$&" / "$'" / "$`" in a path from being expanded.
  return script.replace(/\$PR_SCAN_UNARMED_CANDIDATES/g, () => toPosix(candidatesFile, sep));
}

// Every require(/readFileSync(/writeFileSync( single-quoted argument in a script (#3699).
function spliceLiterals(script) {
  return [...script.matchAll(/(?:require|readFileSync|writeFileSync)\(\s*'([^']*)'/g)].map((m) => m[1]);
}

test('AC1.1: pr-scan item 9 gates candidates on a pr-checks.js --pr verdict', () => {
  const slice = item9Slice();
  assert.ok(slice.includes('pr-checks.js'), 'item 9 names pr-checks.js');
  assert.ok(slice.includes('--pr'), 'item 9 uses the --pr mode');
  assert.ok(slice.includes('PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node -e "'), 'the CI filter receives the plugin root through the environment');
  assert.ok(slice.includes("NON_BLOCKING = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])"), 'the NON_BLOCKING rollup pre-filter is still present');
});

test('AC1.1: item 9 CI filter keeps green/no-ci, drops pending, red and a failed read', () => {
  const scripts = item9Scripts();
  assert.ok(scripts.length >= 2, 'item 9 has the candidate filter plus the CI filter');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-display-ci-'));
  try {
    fs.mkdirSync(path.join(tmp, 'bin'));
    fs.writeFileSync(path.join(tmp, 'bin', 'pr-checks.js'), [
      'const a = process.argv;',
      "if (a[2] !== '--pr') process.exit(2);",
      'const n = a[3];',
      "if (n === '5') process.exit(1);",
      "const state = { 1: 'green', 2: 'no-ci', 3: 'pending', 4: 'red' }[n];",
      'console.log(JSON.stringify({ state }));',
    ].join('\n'));
    const candidatesFile = path.join(tmp, 'candidates.json');
    fs.writeFileSync(candidatesFile, JSON.stringify([1, 2, 3, 4, 5].map((number) => ({ number }))));
    // The plugin root reaches the script through the environment, as the shell prefix does.
    const script = substituteCandidates(scripts[1], candidatesFile);
    assert.ok(!script.includes('CLAUDE_PLUGIN_ROOT'), 'the CI filter body no longer interpolates CLAUDE_PLUGIN_ROOT into JS');
    const scriptFile = path.join(tmp, 'ci-filter.js');
    fs.writeFileSync(scriptFile, script);
    const res = spawnSync('node', [scriptFile], { encoding: 'utf8', env: { ...process.env, PLUGIN_ROOT: tmp } });
    assert.strictEqual(res.status, 0, `CI filter exits 0: ${res.stderr}`);
    const kept = JSON.parse(fs.readFileSync(candidatesFile, 'utf8')).map((p) => p.number);
    assert.deepStrictEqual(kept, [1, 2]);
    assert.match(res.stderr, /PR #3 not offered: CI pending/);
    assert.match(res.stderr, /PR #4 not offered: CI red/);
    assert.match(res.stderr, /PR #5 not offered: CI read-failed/);
    assert.ok(!/PR #[12] /.test(res.stderr), 'kept PRs are not reported');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#3699 AC1.1: the CI filter splices a win32 temp path with forward slashes', () => {
  const win = path.win32.join('D:\\a\\_temp', 'ct-display-ci-x', 'candidates.json');
  const s = substituteCandidates(item9Scripts()[1], win, path.win32.sep);
  const lits = spliceLiterals(s);
  assert.ok(lits.filter((l) => l === 'D:/a/_temp/ct-display-ci-x/candidates.json').length >= 2, 'the require and the writeFileSync both carry the forward-slashed path');
  assert.ok(lits.every((l) => !l.includes('\\')), 'no spliced literal keeps a backslash');
});
