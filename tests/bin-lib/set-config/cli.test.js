'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, renderManifestoFyi } = require('../../../plugin/bin/set-config');
const { readText } = require('../../helpers/read-skill');

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

test('cli: a 13-lever auto batch plus the integration-model pin writes the pin and still prints the FYI table', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--set', FULL_MANIFESTO_BATCH_AUTO + ',integration-model=pr-first'], deps);
  assert.equal(code, 0);
  assert.match(fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8'), /^integration-model: pr-first$/m);
  assert.ok(out.join('').includes('### Pipeline Config (auto)'));
});

test('cli: a 13-lever batch WITHOUT the integration-model pin still writes all 13 levers (the empty-resolve fallback)', () => {
  const { main, runDir } = fixture();
  const { deps } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--set', FULL_MANIFESTO_BATCH_AUTO], deps), 0);
  const body = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  for (const pair of FULL_MANIFESTO_BATCH_AUTO.split(',')) {
    const [k, v] = pair.split('=');
    assert.ok(body.split('\n').includes(`${k}: ${v}`), `config.yml missing ${k}: ${v}`);
  }
  assert.ok(!/^integration-model:/m.test(body));
});

test('cli: an empty integration-model value in the batch is exit 2 and writes no lever', () => {
  const { main, runDir } = fixture();
  const before = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  const { deps } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--set', FULL_MANIFESTO_BATCH_AUTO + ',integration-model='], deps), 2);
  assert.equal(fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8'), before);
});

test('cli: an invalid integration-model pin value is exit 2 and writes nothing', () => {
  const { main, runDir } = fixture();
  const before = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  const { deps, err } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--key', 'integration-model', '--value', 'github'], deps), 2);
  assert.ok(err.join('').includes('pr-first'));
  assert.equal(fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8'), before);
});

test('cli: a batch carrying an unknown non-pin extra key alongside the 13 levers is exit 2', () => {
  const { main, runDir } = fixture();
  const { deps } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--set', FULL_MANIFESTO_BATCH_AUTO + ',spec=12'], deps), 2);
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

test('cli: a 13-entry batch of 12 levers plus the integration-model pin (one lever missing) does NOT print the FYI table', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const batch = FULL_MANIFESTO_BATCH_AUTO.replace(',merge-authorization=ask', '') + ',integration-model=pr-first';
  assert.equal(batch.split(',').length, 13);
  assert.ok(!batch.includes('merge-authorization'));
  assert.equal(run(['--run', runDir, '--set', batch], deps), 0);
  assert.ok(!out.join('').includes('Pipeline Config'));
});

test('cli: the single-key form never prints the Manifesto FYI table, even for mode=auto', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--key', 'mode', '--value', 'auto'], deps);
  assert.equal(code, 0);
  assert.ok(!out.join('').includes('Pipeline Config'));
});

// #4026 characterization: stdout and the no-log paths, pinned byte-for-byte
// before set-config.js started appending its own decisions.md line.
test('characterization: --set prints exactly one per-lever line, byte-for-byte', () => {
  const { main, runDir } = fixture();
  const { deps, out, err } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--set', 'mode=hybrid,ceremony-profile=standard'], deps), 0);
  const file = path.join(fs.realpathSync(runDir), 'config.yml');
  assert.equal(out.join(''), `${file} (mode: auto -> hybrid)\n${file} (ceremony-profile: fast-lane -> standard)\n`);
  assert.equal(err.join(''), '');
});

test('characterization: the full 13-lever auto batch prints the per-lever lines then the FYI table, byte-for-byte', () => {
  const { main, runDir } = fixture();
  const { deps, out, err } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--set', FULL_MANIFESTO_BATCH_AUTO], deps), 0);
  const file = path.join(fs.realpathSync(runDir), 'config.yml');
  const previous = { mode: 'auto', 'ceremony-profile': 'fast-lane' };
  const pairs = FULL_MANIFESTO_BATCH_AUTO.split(',').map((p) => p.split('='));
  const lines = pairs.map(([k, v]) => `${file} (${k}: ${previous[k] || 'unset'} -> ${v})\n`).join('');
  const fyi = renderManifestoFyi(pairs.map(([key, value]) => ({ key, value })));
  assert.equal(out.join(''), lines + fyi);
  assert.equal(err.join(''), '');
});

test('characterization: --key/--value prints exactly one line, byte-for-byte, and writes no decisions.md', () => {
  const { main, runDir } = fixture();
  const { deps, out, err } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--key', 'ceremony-profile', '--value', 'standard'], deps), 0);
  const file = path.join(fs.realpathSync(runDir), 'config.yml');
  assert.equal(out.join(''), `${file} (ceremony-profile: fast-lane -> standard)\n`);
  assert.equal(err.join(''), '');
  assert.ok(!fs.existsSync(path.join(runDir, 'decisions.md')));
});

test('characterization: a refused --set (exit 2) and a shadow run dir (exit 3) write no decisions.md', () => {
  const { main, runDir, shadow } = fixture();
  assert.equal(run(['--run', runDir, '--set', 'mode=hybrid,ceremony-profile=turbo'], fakeDeps(main).deps), 2);
  assert.equal(run(['--run', shadow, '--set', 'mode=hybrid'], fakeDeps(main).deps), 3);
  assert.ok(!fs.existsSync(path.join(runDir, 'decisions.md')));
  assert.ok(!fs.existsSync(path.join(shadow, 'decisions.md')));
});

test('characterization: a config.yml write failure (exit 3) prints nothing to stdout and writes no decisions.md', () => {
  const { main, runDir } = fixture();
  fs.rmSync(path.join(runDir, 'config.yml'));
  fs.mkdirSync(path.join(runDir, 'config.yml'));
  const { deps, out, err } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--set', 'mode=hybrid,ceremony-profile=standard'], deps), 3);
  assert.equal(out.join(''), '');
  assert.match(err.join(''), /^set-config\.js: could not write config\.yml \(/);
  assert.ok(!fs.existsSync(path.join(runDir, 'decisions.md')));
});

// #4026 AC3.1: a successful --set batch appends the Manifesto write line the
// skill used to hand-log (flow/manifesto.md's Write mechanism,
// _shared/auto-decision-log.md's #1826/#1810 worked example).
const NOW = new Date(2026, 4, 15, 14, 31, 2).getTime();
const loggedDeps = (cwd, extra = {}) => {
  const f = fakeDeps(cwd);
  Object.assign(f.deps, { now: () => NOW }, extra);
  return f;
};

test('AC3.1: --set batch logs "levers written to {path}" under /flow', () => {
  const { main, runDir } = fixture();
  const { deps, out } = loggedDeps(main);
  assert.equal(run(['--run', runDir, '--set', FULL_MANIFESTO_BATCH_AUTO + ',integration-model=pr-first'], deps), 0);
  const file = path.join(fs.realpathSync(runDir), 'config.yml');
  assert.ok(out.join('').startsWith(`${file} (`), 'the logged path is the path printed on stdout');
  assert.equal(
    fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'),
    `## /flow\n- AUTO 14:31:02 — Manifesto: levers written to ${file}. Reversibility: n/a.\n`,
  );
});

test('AC3.1: the logged line matches auto-decision-log.md\'s worked example up to its commentary', () => {
  const doc = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'auto-decision-log.md'));
  const m = /^- AUTO (\d{2}:\d{2}:\d{2}) — Manifesto: levers written to (\S+\/config\.yml)\./m.exec(doc);
  assert.ok(m, 'auto-decision-log.md no longer carries the Manifesto worked example');
  const { main, runDir } = fixture();
  const { deps } = loggedDeps(main);
  assert.equal(run(['--run', runDir, '--set', 'mode=hybrid'], deps), 0);
  const file = path.join(fs.realpathSync(runDir), 'config.yml');
  const entry = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8').split('\n')[1];
  const example = m[0].replace(m[1], '14:31:02').replace(m[2], file);
  assert.ok(entry.startsWith(example), `entry ${JSON.stringify(entry)} does not start with ${JSON.stringify(example)}`);
});

test('AC3.1: the line lands as the last /flow entry of an existing decisions.md, prior bytes untouched', () => {
  const { main, runDir } = fixture();
  const prior = '# Auto-Decision Log — pipeline 2026-08-20T090000-spec-12\n\nPipeline config snapshot:\n- mode: auto\n\n' +
    '## /flow\n- AUTO 14:30:06 — Step 2.8: claimed #12. Reversibility: high.\n## /build\n- AUTO 14:40:00 — later. Reversibility: n/a.\n';
  fs.writeFileSync(path.join(runDir, 'decisions.md'), prior);
  const { deps } = loggedDeps(main);
  assert.equal(run(['--run', runDir, '--set', 'mode=hybrid,ceremony-profile=standard'], deps), 0);
  const file = path.join(fs.realpathSync(runDir), 'config.yml');
  assert.equal(
    fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'),
    prior.replace('## /build\n', `- AUTO 14:31:02 — Manifesto: levers written to ${file}. Reversibility: n/a.\n## /build\n`),
  );
});

test('AC3.1: --key/--value logs nothing — an existing decisions.md stays byte-identical', () => {
  const { main, runDir } = fixture();
  const prior = '## /flow\n- AUTO 14:30:06 — Step 2.8: claimed #12. Reversibility: high.\n';
  fs.writeFileSync(path.join(runDir, 'decisions.md'), prior);
  const { deps } = loggedDeps(main);
  assert.equal(run(['--run', runDir, '--key', 'merge-authorization', '--value', 'pre-authorized'], deps), 0);
  assert.equal(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), prior);
});

test('AC3.1: a failed append keeps exit 0 and stdout unchanged, adding one stderr line', () => {
  const { main, runDir } = fixture();
  const { deps, out, err } = loggedDeps(main, { appendDecision: () => { throw new Error('disk full'); } });
  assert.equal(run(['--run', runDir, '--set', 'mode=hybrid,ceremony-profile=standard'], deps), 0);
  const file = path.join(fs.realpathSync(runDir), 'config.yml');
  assert.equal(out.join(''), `${file} (mode: auto -> hybrid)\n${file} (ceremony-profile: fast-lane -> standard)\n`);
  assert.equal(err.length, 1);
  assert.match(err[0], /^set-config\.js: could not append the decisions\.md entry .*disk full\n$/);
  assert.ok(err[0].includes(`levers written to ${file}`), 'the stderr line names the entry to hand-log');
  assert.ok(!fs.existsSync(path.join(runDir, 'decisions.md')));
});
