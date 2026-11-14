const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sweepCli } = require('../../helpers/health-sweep-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'harness-health.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-mark-')); }

// In-process (#5380), with the file-protocol-only git guard — see tests/helpers/health-sweep-cli.js.
const cli = (argv, opts) => sweepCli(CLI, argv, opts);

test('mark exits non-zero for "applied" now that harness-health is report-only', () => {
  const root = tmp();
  const result = cli(['mark', 'skillhealth-abc12345', 'applied', '--root', root]);
  assert.notStrictEqual(result.status, 0);
});

test('mark writes a declined status to the cache', () => {
  const root = tmp();
  const result = cli(['mark', 'skillhealth-xyz98765', 'declined', '--root', root]);
  assert.strictEqual(result.status, 0, result.stderr);
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'harness-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache['skillhealth-xyz98765'].status, 'declined');
});

// No --root: the root defaults to the cwd the call was given (the injected one, never the test process's).
test('mark without --root writes the declined status under the injected cwd', () => {
  const root = tmp();
  const result = cli(['mark', 'skillhealth-cwd00001', 'declined'], { cwd: root });
  assert.strictEqual(result.status, 0, result.stderr);
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'harness-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache['skillhealth-cwd00001'].status, 'declined');
});

test('mark exits non-zero for an invalid status', () => {
  const root = tmp();
  const result = cli(['mark', 'skillhealth-abc12345', 'bogus', '--root', root]);
  assert.notStrictEqual(result.status, 0);
});

test('mark exits non-zero when the fingerprint arg is missing', () => {
  const root = tmp();
  const result = cli(['mark', '--root', root]);
  assert.notStrictEqual(result.status, 0);
});

test('a finding marked declined is suppressed by a later validate-findings run on the same fingerprint', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  const finding = {
    kind: 'patch', target: 'auth', assetType: 'skill', category: 'drift', section: 'Auth', classification: 'restructural',
    confidence: 'high', reversibility: 'med', description: 'x', oldString: 'a', newString: 'b', reason: 'y',
  };
  fs.writeFileSync(findingsFile, JSON.stringify([finding]));
  const firstRun = cli(['validate-findings', findingsFile, '--root', root, '--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(firstRun.status, 0, firstRun.stderr);
  const first = JSON.parse(firstRun.stdout);
  assert.strictEqual(first.length, 1, 'first run must file the finding');
  const fp = first[0].id;
  const marked = cli(['mark', fp, 'declined', '--root', root]);
  assert.strictEqual(marked.status, 0, marked.stderr);
  const secondRun = cli(['validate-findings', findingsFile, '--root', root, '--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(secondRun.status, 0, secondRun.stderr);
  const second = JSON.parse(secondRun.stdout);
  assert.strictEqual(second.length, 0, 'declined finding must be suppressed on the next run');
});
