const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sweepCli } = require('../../helpers/health-sweep-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'journey-health.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-cli-mark-')); }

// In-process (#5380), with the file-protocol-only git guard — see tests/helpers/health-sweep-cli.js.
const cli = (argv, opts) => sweepCli(CLI, argv, opts);

test('mark writes a declined status to the cache', () => {
  const root = tmp();
  const result = cli(['mark', 'journeyhealth-xyz98765', 'declined', '--root', root]);
  assert.strictEqual(result.status, 0, result.stderr);
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'journey-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache['journeyhealth-xyz98765'].status, 'declined');
});

// No --root: the root defaults to the cwd the call was given (the injected one, never the test process's).
test('mark without --root writes the declined status under the injected cwd', () => {
  const root = tmp();
  const result = cli(['mark', 'journeyhealth-cwd00001', 'declined'], { cwd: root });
  assert.strictEqual(result.status, 0, result.stderr);
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'journey-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache['journeyhealth-cwd00001'].status, 'declined');
});

test('mark exits non-zero for an invalid status (journey-health never had "applied")', () => {
  const root = tmp();
  const result = cli(['mark', 'journeyhealth-abc12345', 'applied', '--root', root]);
  assert.notStrictEqual(result.status, 0);
});

test('mark exits non-zero when the fingerprint arg is missing', () => {
  const root = tmp();
  const result = cli(['mark', '--root', root]);
  assert.notStrictEqual(result.status, 0);
});
