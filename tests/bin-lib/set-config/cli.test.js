'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/set-config');

// Same anchoring fixture shape as tests/bin-lib/stage-item/cli.test.js: a
// fake main checkout (.git directory) holding the real run dir, plus a
// worktree-local shadow copy (.git FILE) that must be refused.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sccli-'));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-20T090000-spec-12');
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.claude-tweaks', 'pipelines', '2026-08-20T090000-spec-12');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-12\n');
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\nceremony-profile: fast-lane\nspec: 12\n');
  fs.writeFileSync(path.join(shadow, 'config.yml'), 'mode: auto\nceremony-profile: fast-lane\nspec: 12\n');
  return { main, runDir, shadow };
}

function fakeDeps(cwd) {
  const out = []; const err = [];
  return {
    deps: { cwd: () => cwd, stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out, err,
  };
}

test('cli: success path writes the lever and prints the config.yml path', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--key', 'ceremony-profile', '--value', 'standard'], deps);
  assert.equal(code, 0);
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.ok(body.includes('ceremony-profile: standard'));
  assert.ok(!body.includes('fast-lane'));
  assert.ok(body.includes('mode: auto'));
  assert.ok(body.includes('spec: 12'));
  assert.ok(out.join('').includes(path.join(runDir, 'config.yml')));
  assert.ok(out.join('').includes('ceremony-profile: fast-lane -> standard'));
});

test('cli: missing --run/--key/--value is exit 2', () => {
  const { main, runDir } = fixture();
  assert.equal(run(['--key', 'mode', '--value', 'auto'], fakeDeps(main).deps), 2);
  assert.equal(run(['--run', runDir, '--value', 'auto'], fakeDeps(main).deps), 2);
  assert.equal(run(['--run', runDir, '--key', 'mode'], fakeDeps(main).deps), 2);
});

test('cli: a key outside the lever enum is exit 2 and names the enum source', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--key', 'spec', '--value', '13'], deps), 2);
  const msg = err.join('');
  assert.ok(/not a config\.yml policy lever/.test(msg), msg);
  assert.ok(msg.includes('ceremony-profile'), 'error should list the valid levers');
});

test('cli: a value outside the lever enum is exit 2 and lists allowed values', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--key', 'ceremony-profile', '--value', 'turbo'], deps), 2);
  assert.ok(err.join('').includes('fast-lane'));
  assert.ok(err.join('').includes('standard'));
});

test('cli: missing run dir is exit 3', () => {
  const { main } = fixture();
  const { deps } = fakeDeps(main);
  assert.equal(run(['--run', path.join(main, 'nope'), '--key', 'mode', '--value', 'auto'], deps), 3);
});

test('cli: a worktree-local shadow run dir is refused (exit 3), and its config.yml is untouched', () => {
  const { main, shadow } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', shadow, '--key', 'ceremony-profile', '--value', 'standard'], deps);
  assert.equal(code, 3);
  assert.ok(/not anchored/.test(err.join('')));
  assert.ok(fs.readFileSync(path.join(shadow, 'config.yml'), 'utf8').includes('fast-lane'));
});

test('cli: --help prints usage, exit 0', () => {
  const { main } = fixture();
  const { deps, out } = fakeDeps(main);
  assert.equal(run(['--help'], deps), 0);
  assert.ok(out.join('').includes('usage:'));
});

test('cli: --set writes multiple levers in one call, printing one line per lever', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', 'mode=hybrid,ceremony-profile=standard'], deps);
  assert.equal(code, 0);
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.ok(body.includes('mode: hybrid'));
  assert.ok(body.includes('ceremony-profile: standard'));
  assert.ok(body.includes('spec: 12'));
  const printed = out.join('');
  assert.ok(printed.includes('mode: auto -> hybrid'));
  assert.ok(printed.includes('ceremony-profile: fast-lane -> standard'));
});

test('cli: --set validates the full set before writing any — one invalid value blocks the whole batch', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', 'mode=hybrid,ceremony-profile=turbo'], deps);
  assert.equal(code, 2);
  assert.ok(err.join('').includes('fast-lane'));
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.ok(body.includes('mode: auto'), 'mode must NOT have been written — all-or-nothing');
  assert.ok(!body.includes('mode: hybrid'));
});

test('cli: --set with an unknown key blocks the whole batch and names the canonical lever set', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', 'mode=hybrid,spec=13'], deps);
  assert.equal(code, 2);
  const msg = err.join('');
  assert.ok(/not a config\.yml policy lever/.test(msg));
  assert.ok(msg.includes('ceremony-profile'));
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.ok(body.includes('mode: auto'), 'nothing should have been written');
});

test('cli: --set with a malformed entry (no "=") is exit 2 and nothing is written', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', 'mode=hybrid,ceremony-profile-standard'], deps);
  assert.equal(code, 2);
  assert.ok(err.join('').includes('is not in key=value form'));
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.ok(body.includes('mode: auto'), 'nothing should have been written');
});

test('cli: --set with a duplicate key in the batch is exit 2 and nothing is written', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', 'mode=auto,mode=hybrid'], deps);
  assert.equal(code, 2);
  const msg = err.join('');
  assert.ok(msg.includes('"mode"'), 'error should name the duplicated key');
  assert.ok(/more than once/.test(msg));
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.ok(body.includes('mode: auto'), 'nothing should have been written — original value intact');
});

test('cli: a dangling --set with no value is reported as a --set problem, not misattributed to --key', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', runDir, '--set'], deps);
  assert.equal(code, 2);
  assert.ok(err.join('').includes('--set requires at least one key=value pair'));
  assert.ok(!err.join('').includes('--key <lever> is required'), 'must not misreport a missing --key');
});

test('cli: batch validation errors name the offending --set entry, not bare --key/--value', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', 'mode=hybrid,spec=13'], deps);
  assert.equal(code, 2);
  const msg = err.join('');
  assert.ok(msg.includes('--set entry "spec=13"'), 'should name the offending --set entry');
  assert.ok(/not a config\.yml policy lever/.test(msg), 'single-key wording is still reused after the prefix');
});

test('cli: --set combined with --key/--value is exit 2', () => {
  const { main, runDir } = fixture();
  const { deps, err } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', 'mode=hybrid', '--key', 'ceremony-profile', '--value', 'standard'], deps);
  assert.equal(code, 2);
  assert.ok(err.join('').includes('cannot be combined'));
});

// #2735: the Manifesto's auto-mode batch write also prints the FYI table as
// a mechanical side effect, since a prose "render this table" instruction
// was observed being silently skipped by the orchestrating model.
const FULL_MANIFESTO_BATCH_AUTO = 'mode=auto,scope-creep=add-to-plan,overlap=companion,' +
  'design-intent=none,leftover-default=defer,auto-fix-threshold=lint+type,' +
  'review-auto-apply-ceiling=medium,tidy-aggressiveness=moderate,ceremony-profile=standard,' +
  'model-stance=default,merge-verification=merge-when-green,design-critique=auto,' +
  'merge-authorization=ask';

test('cli: a full 13-lever --set batch with mode=auto also prints the Manifesto FYI table', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', FULL_MANIFESTO_BATCH_AUTO], deps);
  assert.equal(code, 0);
  const printed = out.join('');
  assert.ok(printed.includes('### Pipeline Config (auto)'));
  assert.ok(printed.includes('| Ceremony profile | standard |'));
  assert.ok(printed.includes('→ proceeding (no approval needed)'));
  assert.ok(printed.includes('run with `confirm` to review/override'));
});

test('cli: a full 13-lever --set batch with mode=hybrid does NOT print the auto FYI table', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const batch = FULL_MANIFESTO_BATCH_AUTO.replace('mode=auto', 'mode=hybrid');
  const code = run(['--run', runDir, '--set', batch], deps);
  assert.equal(code, 0);
  assert.ok(!out.join('').includes('Pipeline Config'));
});

test('cli: a partial --set batch (even with mode=auto) does NOT print the Manifesto FYI table', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', 'mode=auto,ceremony-profile=standard'], deps);
  assert.equal(code, 0);
  assert.ok(!out.join('').includes('Pipeline Config'));
});

test('cli: the single-key form never prints the Manifesto FYI table, even for mode=auto', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--key', 'mode', '--value', 'auto'], deps);
  assert.equal(code, 0);
  assert.ok(!out.join('').includes('Pipeline Config'));
});
