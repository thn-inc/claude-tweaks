'use strict';
// #4620: `hooks.js ledger-row` accepts a Resolution claiming `carried to the acceptance packet as decision:{id}`
// only when {runDir}/packet-facts/decisions.json holds that fact. Fixture helpers copied from
// hooks-ledger-row.test.js, which stays byte-unmodified (AC5).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanGitEnv, fixtureGit, writeIdentity } = require('./helpers/git-fixtures');
const { runCli } = require('./helpers/run-cli');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'plugin', 'bin', 'hooks.js');
const { run: consoleResolve, writeDecisionFacts } = require(path.join(ROOT, 'plugin', 'bin', 'console-resolve.js'));
const SESSION = 'ledger-row-carried-test';
const HEAD = '# Open Items — x\n\n| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n';
const FACT = 'decision:console:ledger-record-1.md';
const CARRIED = `carried to the acceptance packet as ${FACT}`;

const tmpDirs = [];
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}
after(() => { for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true }); });

const git = (args, cwd) => fixtureGit(args, { cwd, encoding: 'utf8', env: cleanGitEnv() });
const hookEnv = (env = {}) => ({ ...cleanGitEnv(), PIPELINE_RUN_DIR: '', CLAUDE_CODE_SESSION_ID: SESSION, ...env });
const runHook = (args, { cwd, env } = {}) => runCli(HOOKS, args, { cwd, env: hookEnv(env) });

async function fixture() {
  const root = tmp('ct-ledgerrow-carried-');
  git(['init', '-q', '--initial-branch=main'], root);
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  const wt = path.join(tmp('ct-ledgerrow-carried-wt-'), 'wt');
  git(['worktree', 'add', '-q', wt, '-b', 'feat'], root);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-11-03T000000-record-1');
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.writeFileSync(path.join(runDir, 'work', '1-spec.md'), '---\nrecord: 1\n---\n');
  const stamp = await runHook(['record-worktree', '--run', runDir, wt], { cwd: root });
  assert.equal(stamp.code, 0, stamp.stderr + stamp.stdout);
  const ledger = path.join(wt, 'docs', 'plans', '2026-11-03-x-ledger.md');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  const rows = '| 1 | build | a finding | open | — |\n';
  fs.writeFileSync(ledger, HEAD + rows);
  return { wt, runDir, ledger, snapshot: HEAD + rows };
}

const settle = (f) => runHook(['ledger-row', '--run', f.runDir, '--ledger', f.ledger, '--row', '1', '--status', 'deferred', '--resolution', CARRIED], { cwd: f.wt });

test('ledger-row refuses a carried Resolution when the run has no packet-facts file', async () => {
  const f = await fixture();
  const r = await settle(f);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, new RegExp(`names the carried decision fact ${FACT}, but .*decisions\\.json does not exist`));
  assert.match(r.stderr, / — nothing written\n$/);
  assert.equal(fs.readFileSync(f.ledger, 'utf8'), f.snapshot, 'the ledger is byte-identical');
});

test('ledger-row refuses a carried Resolution naming a fact that is not in the file, or a file it cannot read', async () => {
  const f = await fixture();
  writeDecisionFacts(f.runDir, [{ id: 'decision:console:something-else.md', text: 'x' }]);
  const r = await settle(f);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /holds no fact with the id "decision:console:ledger-record-1\.md"/);
  assert.doesNotMatch(r.stderr, /trailing punctuation/, 'a plain missing id carries no punctuation hint');
  const file = path.join(f.runDir, 'packet-facts', 'decisions.json');
  fs.writeFileSync(file, 'not json');
  const bad = await settle(f);
  assert.equal(bad.code, 1, bad.stderr);
  assert.match(bad.stderr, /does not parse as JSON/);
  fs.writeFileSync(file, '{"facts":[]}');
  const notArray = await settle(f);
  assert.equal(notArray.code, 1, notArray.stderr);
  assert.match(notArray.stderr, /is not a JSON array/);
  assert.equal(fs.readFileSync(f.ledger, 'utf8'), f.snapshot);
});

test('a hand-written carried Resolution with trailing punctuation is refused naming the exact id and the file it read', async () => {
  const f = await fixture();
  writeDecisionFacts(f.runDir, [{ id: FACT, text: 'x' }]);
  const r = await runHook(['ledger-row', '--run', f.runDir, '--ledger', f.ledger, '--row', '1', '--status', 'deferred', '--resolution', `${CARRIED}.`], { cwd: f.wt });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stderr.includes(`"${FACT}."`), `names the id looked up: ${r.stderr}`);
  assert.ok(r.stderr.includes(path.join(f.runDir, 'packet-facts', 'decisions.json')), 'names the file it read');
  assert.match(r.stderr, /looked up exactly as written, trailing punctuation included/);
  assert.equal(fs.readFileSync(f.ledger, 'utf8'), f.snapshot);
});

test('ledger-row accepts a carried Resolution once the real writer has recorded the fact', async () => {
  const f = await fixture();
  writeDecisionFacts(f.runDir, [{ id: FACT, text: 'x' }]);
  const r = await settle(f);
  assert.equal(r.code, 0, r.stderr);
  assert.match(fs.readFileSync(f.ledger, 'utf8'), /\| 1 \| build \| a finding \| deferred \| carried to the acceptance packet as decision:console:ledger-record-1\.md \|/);
});

test('the fact console-resolve.js --set-item writes satisfies the ledger-row check', async () => {
  const f = await fixture();
  // The real console-resolve writer path: an apply item carried with --set-item writes the fact the check reads.
  fs.writeFileSync(path.join(f.runDir, 'console.json'), `${JSON.stringify({ resolved: true, mode: 'auto-resolve', items: [{ id: 'ledger-record-1.md', section: 'Queue writes', resolution: 'apply', reason: 'q' }] })}\n`);
  const root = path.dirname(path.dirname(path.dirname(f.runDir)));
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'control-mode: on\n');
  const out = [];
  const err = [];
  const code = await consoleResolve(['--run', f.runDir, '--set-item', 'ledger-record-1.md', '--resolution', 'carried', '--reason', 'r'], {
    cwd: () => root, mainRoot: root, stdout: (s) => out.push(s), stderr: (s) => err.push(s), now: () => Date.now(),
  });
  assert.equal(code, 0, err.join(''));
  const r = await settle(f);
  assert.equal(r.code, 0, r.stderr);
});
