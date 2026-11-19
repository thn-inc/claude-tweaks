const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { sweepCli } = require('../../helpers/health-sweep-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
function cli(argv, opts) {
  return sweepCli(CLI, argv, opts);
}

function tmp() { return scratchDir('docs-health-mark-'); }

test('mark writes a declined status to the cache', () => {
  const root = tmp();
  const res = cli(['mark', 'docshealth-xyz98765', 'declined', '--root', root]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'docs-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache['docshealth-xyz98765'].status, 'declined');
});

test('mark exits non-zero for an invalid status', () => {
  const root = tmp();
  const result = cli(['mark', 'docshealth-abc12345', 'bogus', '--root', root]);
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
    target: 'decisions/0007-foo', assetType: 'doc', category: 'staleness', section: 'Freshness',
    misleads: 'agent', classification: 'restructural', confidence: 'high', reversibility: 'med',
    description: 'x', oldString: 'a', newString: 'b', reason: 'y',
  };
  fs.writeFileSync(findingsFile, JSON.stringify([finding]));
  const firstRun = cli(['validate-findings', findingsFile, '--root', root, '--target', 'decisions/0007-foo']);
  assert.strictEqual(firstRun.status, 0, `stderr: ${firstRun.stderr}`);
  const first = JSON.parse(firstRun.stdout);
  assert.strictEqual(first.length, 1, 'first run must file the finding');
  const fp = first[0].id;
  const marked = cli(['mark', fp, 'declined', '--root', root]);
  assert.strictEqual(marked.status, 0, `stderr: ${marked.stderr}`);
  const secondRun = cli(['validate-findings', findingsFile, '--root', root, '--target', 'decisions/0007-foo']);
  assert.strictEqual(secondRun.status, 0, `stderr: ${secondRun.stderr}`);
  const second = JSON.parse(secondRun.stdout);
  assert.strictEqual(second.length, 0, 'declined finding must be suppressed on the next run');
});

// ── in-process entry (#5381) ────────────────────────────────────────────────

// No --root at all: the root is the injected cwd, so the cache lands under it.
test('AC8.1: mark without --root writes the cache under the injected cwd', () => {
  const root = tmp();
  const res = cli(['mark', 'docshealth-cwd54321', 'declined'], { cwd: root });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'docs-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache['docshealth-cwd54321'].status, 'declined');
});
