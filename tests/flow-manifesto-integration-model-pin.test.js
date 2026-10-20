'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../plugin/bin/set-config');
const { MANIFESTO_LEVERS, RUN_PINS } = require('../plugin/bin/lib/set-config/write');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const MANIFESTO = path.join(REPO_ROOT, 'plugin', 'skills', 'flow', 'manifesto.md');
const STEPS = path.join(REPO_ROOT, 'plugin', 'skills', 'flow', 'steps-and-gates.md');

// One concrete valid value per Manifesto lever, plus the run pin. Keyed by
// name so a lever added to the Write mechanism batch without a value here
// fails the AC1.1 test below rather than passing silently.
const VALUES = {
  mode: 'auto',
  'scope-creep': 'add-to-plan',
  overlap: 'companion',
  'design-intent': 'none',
  'leftover-default': 'defer',
  'auto-fix-threshold': 'lint+type',
  'review-auto-apply-ceiling': 'medium',
  'tidy-aggressiveness': 'moderate',
  'ceremony-profile': 'standard',
  'model-stance': 'default',
  'merge-verification': 'merge-when-green',
  'design-critique': 'auto',
  'merge-authorization': 'ask',
  'integration-model': 'pr-first',
};

function writeMechanismParagraph(manifesto) {
  const start = manifesto.indexOf('**Write mechanism');
  assert.notEqual(start, -1, 'manifesto.md: "**Write mechanism" paragraph not found — anchor may have moved');
  const end = manifesto.indexOf('\n\n', start);
  return manifesto.slice(start, end === -1 ? manifesto.length : end);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impin-'));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-19T090000-spec-3350');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  return { main, runDir };
}

function fakeDeps(cwd) {
  const out = []; const err = [];
  return {
    deps: { cwd: () => cwd, stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out, err,
  };
}

test('AC1.1: the Manifesto batch command, run as written, leaves integration-model: pr-first in config.yml with no hand edit', () => {
  const manifesto = readText(MANIFESTO);
  const para = writeMechanismParagraph(manifesto);
  const setMatch = /--set "([^"]*)"/.exec(para);
  assert.ok(setMatch, 'Write mechanism paragraph has no --set "..." argument');

  const pairs = setMatch[1].split(',').map((pair) => {
    const eq = pair.indexOf('=');
    const key = pair.slice(0, eq);
    const placeholder = pair.slice(eq + 1);
    assert.equal(placeholder, '{v}', `Write mechanism pair "${pair}" is not a {v} placeholder`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(VALUES, key),
      `Write mechanism batch names "${key}" but this test has no value for it — add it to VALUES`,
    );
    return `${key}=${VALUES[key]}`;
  });
  const keys = pairs.map((p) => p.split('=')[0]);
  assert.ok(keys.includes('integration-model'), 'Write mechanism batch must carry integration-model={v}');
  // Both directions: every prose key is known to the CLI (the run() below refuses an unknown key), and the
  // prose carries every canonical lever in canonical order, so a lever dropped from the batch fails here.
  assert.deepEqual(keys.filter((k) => !RUN_PINS.includes(k)), [...MANIFESTO_LEVERS],
    'Write mechanism batch must list the 13 canonical levers in order (run pins excluded)');

  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', pairs.join(',')], deps);
  assert.equal(code, 0, `set-config.js refused the Manifesto batch: ${err.join('')}`);
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.match(body, /^integration-model: pr-first$/m);
});

test('manifesto.md names how the pin value is resolved and cites the integration-model fragment', () => {
  const manifesto = readText(MANIFESTO);
  const para = writeMechanismParagraph(manifesto);
  assert.ok(para.includes('resolve-policy.js'), 'Write mechanism paragraph must resolve the pin via resolve-policy.js');
  assert.ok(para.includes('--values integration-model'), 'Write mechanism paragraph must resolve with --values integration-model');
  assert.ok(manifesto.includes('_shared/integration-model.md'), 'manifesto.md must cite _shared/integration-model.md');
});

test('the On-approval yaml example carries the integration-model pin', () => {
  const manifesto = readText(MANIFESTO);
  const approvalIdx = manifesto.indexOf('On approval (option 1)');
  assert.notEqual(approvalIdx, -1, 'manifesto.md: "On approval (option 1)" section not found');
  const fenceStart = manifesto.indexOf('```yaml', approvalIdx);
  const fenceEnd = manifesto.indexOf('```', fenceStart + 7);
  const block = manifesto.slice(fenceStart + 7, fenceEnd);
  assert.match(block, /^integration-model: pr-first$/m);
});

test('manifesto.md says the config snapshot header lists the integration-model pin after the levers', () => {
  const manifesto = readText(MANIFESTO);
  const init = manifesto.split('\n').find((l) => l.startsWith('Initialize `decisions.md` in the same directory'));
  assert.ok(init, 'manifesto.md: "Initialize `decisions.md` in the same directory" paragraph not found');
  assert.match(init, /snapshot header[^\n]*`- integration-model: \{v\}`/, 'the snapshot header must list "- integration-model: {v}" after the levers');
});

test('steps-and-gates.md case 3 recovery batch carries the integration-model pin', () => {
  const steps = readText(STEPS);
  const start = steps.indexOf('### Adopting an inherited run directory');
  const end = steps.indexOf('### Partial step lists');
  assert.notEqual(start, -1, 'steps-and-gates.md: "Adopting an inherited run directory" heading not found');
  assert.notEqual(end, -1, 'steps-and-gates.md: "Partial step lists" heading not found');
  const region = steps.slice(start, end);
  assert.match(region, /integration-model=/, 'case 3 batch-write bullet must carry integration-model={v}');
});

test('manifesto.md Write mechanism: an empty integration-model resolve omits the pair and logs a SKIP, so the 13 levers still write', () => {
  const para = writeMechanismParagraph(readText(MANIFESTO));
  assert.match(para, /resolve prints an EMPTY value/, 'Write mechanism must say what to do when the pin resolve prints an empty value');
  assert.match(para, /omit that pair so the 13 levers still write/, 'Write mechanism must say the empty pin pair is omitted and the 13 levers still write');
  assert.match(para, /log-decision\.js --status SKIP/, 'Write mechanism must log the omission as a SKIP decision');
});

test('the degrade-line prefixes the readers print are the ones the skill prose tells callers to log as SKIP', () => {
  const read = (...p) => readText(path.join(REPO_ROOT, ...p));
  const sites = [
    ['plugin/bin/verify-run-bookends.js', 'verify-run-bookends: degraded —', ['plugin/skills/dispatch/task-prompt.md', 'plugin/skills/flow/claim-targets.md']],
    ['plugin/bin/lib/dispatch/first-call-artifact-check.js', 'first-call-artifact-check: degraded —', ['plugin/skills/dispatch/two-call-gate.md']],
  ];
  for (const [code, prefix, prose] of sites) {
    assert.ok(read(...code.split('/')).includes(prefix), `${code} no longer prints "${prefix}"`);
    for (const file of prose) {
      assert.ok(read(...file.split('/')).includes(prefix), `${file} does not name "${prefix}" — the SKIP-logging instruction lost its trigger`);
    }
  }
});

test('steps-and-gates.md case 3 fresh-resolve branch reaches the empty-resolve omit-and-SKIP rule', () => {
  const steps = readText(STEPS);
  const start = steps.indexOf('### Adopting an inherited run directory');
  const end = steps.indexOf('### Partial step lists');
  const region = steps.slice(start, end);
  assert.match(region, /resolved fresh as `manifesto\.md`'s Write mechanism section does, including its empty-resolve rule — omit the pair and log a `SKIP` decision/);
});

test('flow-manifesto integration-model pin: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const FILE = MANIFESTO;
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  assert.match(writeMechanismParagraph(text), /--set "/);
});
