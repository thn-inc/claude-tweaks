// tests/hooks-resolve-console.test.js — #2568: hooks.js's `resolve-console`
// CLI dispatch (the --run-required discipline, USAGE/KNOWN_FLAGS wiring).
// The gh-calling happy path is covered directly against
// resolveConsoleExecution in tests/resolve-console.test.js with a fake
// runner — this file only exercises the CLI-level gates that fire before
// any gh call would ever be made.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { runCli, spawnCli } = require('./helpers/run-cli');
const { hookEnv } = require('./helpers/git-fixtures');
const { writeStubDir, STUB_SKIP } = require('./helpers/path-stub');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

// The stub `gh` first on PATH: the verb's gh child must find it through the injected env.
function ghStubEnv(stub) {
  return { PATH: stub.envPath };
}

// Runs the verb in-process (#5376); the script entry has its own tests below.
function runHook(args, { cwd, env } = {}) {
  return runCli(HOOKS, args, {
    cwd: cwd || scratchDir('ct-resolve-console-cli-'),
    env: hookEnv(env),
  });
}

test('resolve-console --help prints usage and exits 0, no --run required', async () => {
  const result = await runHook(['resolve-console', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /resolve-console --run <dir>/);
  assert.match(result.stdout, /\[--reverse-failed <id,id,\.\.\.>\]/);
  assert.match(result.stdout, /\[--filing-failed <id,id,\.\.\.>\]/);
  assert.match(result.stdout, /\[--digested <id,id,\.\.\.>\]/);
});

test('resolve-console accepts --filing-failed as a declared flag', async () => {
  const result = await runHook(['resolve-console', '--run', '/definitely/not/a/real/path/xyz', '--filing-failed', 'f1']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run path rejected/);
});

// #3949: --filing-failed names only a finding row (console.json's findingItem); the CLI renders the refusal.
test('resolve-console --filing-failed on a non-finding item is refused by the CLI with the not-finding-items message', { skip: STUB_SKIP }, async (t) => {
  const repo = fs.realpathSync(scratchDir('ct-resolve-console-ff-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-10-24T000000-ff');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_primary'], prNumber: 42, items: [{ id: '1', kind: 'batch', summary: 'fix A' }],
  }));
  const comment = { id: 'IC_primary', body: '<!-- console-item: resolve -->\n- [ ] **Resolve console**\n<!-- console-item: 1 -->\n- [ ] item 1' };
  const stub = writeStubDir('gh', `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ comments: [comment], body: 'Fixes #42' }))});\n`);
  t.after(stub.remove);
  const result = await runHook(['resolve-console', '--run', runDir, '--filing-failed', '1'], { cwd: repo, env: ghStubEnv(stub) });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--filing-failed id\(s\) 1 are neither finding rows nor sdd-ruling rows \(no findingItem, no isRulingRow flag\)/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8')).executedAt, undefined, 'a refused call writes nothing');
});

// #4679: --digested refusals name --digested, never --filing-failed.
function runRefusal(slug, items, flags) {
  const repo = fs.realpathSync(scratchDir(`ct-resolve-console-${slug}-`));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', `2026-11-16T000000-${slug}`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_primary'], prNumber: 42, items }));
  const rows = items.map((i) => `<!-- console-item: ${i.id} -->\n- [ ] item ${i.id}`).join('\n');
  const comment = { id: 'IC_primary', body: `<!-- console-item: resolve -->\n- [ ] **Resolve console**\n${rows}` };
  const stub = writeStubDir('gh', `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ comments: [comment], body: 'Fixes #42' }))});\n`);
  let result;
  try {
    const stdout = execFileSync('node', [HOOKS, 'resolve-console', '--run', runDir, ...flags], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', PATH: stub.envPath },
    });
    result = { code: 0, stdout };
  } catch (e) {
    result = { code: e.status, stdout: e.stdout || '' };
  } finally {
    stub.remove();
  }
  result.executedAt = JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8')).executedAt;
  return result;
}

test('resolve-console --digested on a non-finding item is refused naming --digested (#4679)', { skip: STUB_SKIP }, () => {
  const result = runRefusal('dg1', [{ id: '1', kind: 'batch', summary: 'fix A' }], ['--digested', '1']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--digested id\(s\) 1 are not finding rows \(no findingItem\), console not resolved/);
  assert.doesNotMatch(result.stdout, /--filing-failed/);
  assert.equal(result.executedAt, undefined, 'a refused call writes nothing');
});

test('resolve-console naming a ruling in both --digested and --filing-failed is refused naming --digested (#4679)', { skip: STUB_SKIP }, () => {
  const result = runRefusal('dg2', [{ id: 'r1', kind: 'batch', summary: 'ruling', isRulingRow: true }], ['--digested', 'r1', '--filing-failed', 'r1']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--digested id\(s\) r1 are not finding rows/);
  assert.doesNotMatch(result.stdout, /--filing-failed/);
  assert.equal(result.executedAt, undefined, 'a refused call writes nothing');
});

test('resolve-console naming a finding row in both --digested and --filing-failed is refused as a conflict (#4679)', { skip: STUB_SKIP }, () => {
  const result = runRefusal('dg3', [{ id: 'f1', kind: 'staged', summary: 'finding', findingItem: 'tiebreak:3f2a9c1b7d04' }], ['--digested', 'f1', '--filing-failed', 'f1']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /id\(s\) f1 named in both --digested and --filing-failed, console not resolved/);
  assert.equal(result.executedAt, undefined, 'a refused call writes nothing');
});

// #3942: a ruling id named in both --reverse-failed and --filing-failed; the CLI renders the refusal.
test('resolve-console naming one ruling in both --reverse-failed and --filing-failed is refused by the CLI with the conflicting-failure-ids message', { skip: STUB_SKIP }, async (t) => {
  const repo = fs.realpathSync(scratchDir('ct-resolve-console-cf-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-11-03T000000-cf');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_primary'], prNumber: 42, items: [{ id: 'r1', kind: 'batch', summary: 'ruling', isRulingRow: true }],
  }));
  const comment = { id: 'IC_primary', body: '<!-- console-item: resolve -->\n- [ ] **Resolve console**\n<!-- console-item: r1 -->\n- [ ] ruling r1' };
  const stub = writeStubDir('gh', `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ comments: [comment], body: 'Fixes #42' }))});\n`);
  t.after(stub.remove);
  const result = await runHook(['resolve-console', '--run', runDir, '--reverse-failed', 'r1', '--filing-failed', 'r1'], { cwd: repo, env: ghStubEnv(stub) });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /id\(s\) r1 named in both --reverse-failed and --filing-failed, console not resolved/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8')).executedAt, undefined, 'a refused call writes nothing');
});

// --reverse-failed is a declared flag: accepted rather than intercepted as unknown.
test('resolve-console accepts --reverse-failed as a declared flag', async () => {
  const result = await runHook(['resolve-console', '--run', '/definitely/not/a/real/path/xyz', '--reverse-failed', 'r1']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run path rejected/);
});

// The CLI forwards --reverse-failed into resolveConsoleExecution and renders its
// not-ruling-items refusal. A stub `gh` first on PATH answers the single `pr view`
// read; the refusal returns before any write, so no other gh call is ever made.
test('resolve-console --reverse-failed on an unflagged item is refused by the CLI with the not-ruling-items message', { skip: STUB_SKIP }, async (t) => {
  const repo = fs.realpathSync(scratchDir('ct-resolve-console-rf-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-10-20T000000-rf');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_primary'], prNumber: 42, items: [{ id: '1', kind: 'batch', summary: 'fix A' }],
  }));
  const comment = { id: 'IC_primary', body: '<!-- console-item: resolve -->\n- [ ] **Resolve console**\n<!-- console-item: 1 -->\n- [ ] item 1' };
  const stub = writeStubDir('gh', `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ comments: [comment], body: 'Fixes #42' }))});\n`);
  t.after(stub.remove);
  const result = await runHook(['resolve-console', '--run', runDir, '--reverse-failed', '1'], { cwd: repo, env: ghStubEnv(stub) });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--reverse-failed id\(s\) 1 are not sdd-ruling items/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8')).executedAt, undefined, 'a refused call writes nothing');
});

test('resolve-console without --run exits non-zero with a usage message, performs zero writes', async () => {
  const runDir = scratchDir('ct-resolve-console-norun-');
  const result = await runHook(['resolve-console', '--approve', '1'], { cwd: runDir });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run is required/);
  assert.equal(fs.readdirSync(runDir).length, 0, 'nothing should be written when --run is omitted');
});

// Unknown-flag refusal is verb-agnostic (#4834): stdout stays empty, the
// flag and the usage line go to stderr, and the exit is 1 — the same shape
// as an unknown verb (#1586). It is a caller mistake, not a hook event, so
// the never-break-a-session invariant does not cover it.
// real process: the script entry's refusal of an unknown flag (AC5.1) — exit code 1 and the stderr
// lines written by the spawned `node hooks.js`, with stdout empty.
test('AC5.1: resolve-console with an unknown flag exits 1 with the usage line on stderr through the script entry', () => {
  const result = spawnCli(HOOKS, ['resolve-console', '--run', '/tmp', '--bogus', 'x'], {
    cwd: scratchDir('ct-resolve-console-cli-'), env: hookEnv(),
  });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^claude-tweaks: resolve-console: unknown flag '--bogus'\nclaude-tweaks: usage: resolve-console --run <dir>/);
});

test('resolve-console with a --run path that is not a real directory is rejected', async () => {
  const result = await runHook(['resolve-console', '--run', '/definitely/not/a/real/path/xyz']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run path rejected/);
});

// #5376: the injected cwd resolves a relative --run, and the injected PATH is where the verb's gh child
// finds its stub. A verb reading process.cwd() would reject the relative path; one reading process.env
// would start the real gh, so the stub's canned comment would never be read and the refusal never reached.
test('AC6.1: resolve-console resolves a relative --run against the injected cwd and starts gh from the injected env PATH', { skip: STUB_SKIP }, async (t) => {
  const repo = fs.realpathSync(scratchDir('ct-resolve-console-inj-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const runRel = path.join('.claude-tweaks', 'pipelines', '2026-11-15T000000-inj');
  const runDir = path.join(repo, runRel);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_primary'], prNumber: 42, items: [{ id: '1', kind: 'batch', summary: 'fix A' }],
  }));
  const comment = { id: 'IC_primary', body: '<!-- console-item: resolve -->\n- [ ] **Resolve console**\n<!-- console-item: 1 -->\n- [ ] item 1' };
  const stub = writeStubDir('gh', `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ comments: [comment], body: 'Fixes #42' }))});\n`);
  t.after(stub.remove);
  assert.notEqual(fs.realpathSync(process.cwd()), repo, 'the injected cwd must differ from the runner\'s');
  const result = await runHook(['resolve-console', '--run', runRel, '--reverse-failed', '1'], { cwd: repo, env: ghStubEnv(stub) });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--reverse-failed id\(s\) 1 are not sdd-ruling items/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8')).executedAt, undefined, 'a refused call writes nothing');
});

// #5376 injected-value proof: fails when the verb's gh call stops handing ghOptions the injected env and
// stderr (dropping injectedGhDeps(...)). The fixture's origin is a GitHub Enterprise-style host that only the
// injected GH_CONFIG_DIR's hosts.yml names, and the injected GH_HOST is empty, so the stub gh sees
// GH_HOST=ghe.fixture.invalid only if the known-host lookup read the injected env; without it the runner's
// own gh config is read, the host is unknown, and the stub is started with no GH_HOST.
test('F2: resolve-console starts gh with the GH_HOST inferred from the injected env\'s gh config dir', { skip: STUB_SKIP }, async (t) => {
  const host = 'ghe.fixture.invalid';
  const repo = fs.realpathSync(scratchDir('ct-resolve-console-ghhost-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', `https://${host}/acme/widgets.git`], { cwd: repo });
  const configDir = path.join(repo, 'gh-config');
  fs.mkdirSync(configDir);
  fs.writeFileSync(path.join(configDir, 'hosts.yml'), `${host}:\n  user: fixture\n`);
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-11-16T000000-ghhost');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_primary'], prNumber: 42, items: [{ id: '1', kind: 'batch', summary: 'fix A' }],
  }));
  const hostFile = path.join(repo, 'gh-host-seen.txt');
  const comment = { id: 'IC_primary', body: '<!-- console-item: resolve -->\n- [ ] **Resolve console**\n<!-- console-item: 1 -->\n- [ ] item 1' };
  const stub = writeStubDir('gh', `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(hostFile)}, process.env.GH_HOST || '');\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ comments: [comment], body: 'Fixes #42' }))});\n`);
  t.after(stub.remove);
  const result = await runHook(['resolve-console', '--run', runDir, '--reverse-failed', '1'], {
    cwd: repo, env: { ...ghStubEnv(stub), GH_HOST: '', GH_CONFIG_DIR: configDir },
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--reverse-failed id\(s\) 1 are not sdd-ruling items/);
  assert.equal(fs.readFileSync(hostFile, 'utf8'), host, 'the stub gh was started with the host inferred from the injected gh config dir');
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8')).executedAt, undefined, 'a refused call writes nothing');
});

// real process: the script entry's help path (AC5.1) — the usage text and exit code of a spawned
// `node hooks.js resolve-console --help` equal the in-process call's, under the identical explicit env.
test('AC5.1: resolve-console --help through runCli and spawnCli prints the same usage, exit 0', async () => {
  const cwd = scratchDir('ct-resolve-console-cli-');
  const inProcess = await runHook(['resolve-console', '--help'], { cwd });
  const spawned = spawnCli(HOOKS, ['resolve-console', '--help'], { cwd, env: hookEnv() });
  assert.deepEqual({ code: spawned.code, stdout: spawned.stdout }, { code: inProcess.code, stdout: inProcess.stdout });
  assert.equal(inProcess.code, 0);
  assert.match(inProcess.stdout, /resolve-console --run <dir>/);
});
