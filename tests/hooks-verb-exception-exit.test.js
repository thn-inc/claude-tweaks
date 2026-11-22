'use strict';
// #4932: hooks.js splits two exit contracts. A directly invoked VERBS command's
// unexpected exception exits 1 with `claude-tweaks: {verb}: {message}` on
// stderr (main() catches it); a harness-dispatched EVENTS module's exception
// still exits 0 through the entry catch (never break a session). Both halves
// are pinned here against real processes, with a Module._load preload standing
// in for the fault (record-pr's too); the rest run in-process (runCli, #5376).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hookEnv, gitRepo } = require('./helpers/git-fixtures');
const { runCli } = require('./helpers/run-cli');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const { main, VERBS } = require(HOOKS);

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verb-exc-')));
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

// A realpath'd git repo with one commit and an active run dir, so
// `--run <runDir>` anchors and the verb reaches its handler.
function runDirFixture() {
  const root = gitRepo({ parent: SANDBOX, branch: 'main' });
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-11-02T000000-spec-999');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  return { root, runDir };
}

// Writes a Module._load preload that swaps one hooks lib module for `body`.
function preloadFor(name, pattern, body) {
  const file = path.join(SANDBOX, `${name}-preload.js`);
  fs.writeFileSync(file, [
    "const Module = require('module');",
    'const load = Module._load;',
    `Module._load = function (request, ...rest) { if (${pattern}.test(request)) return ${body}; return load.call(this, request, ...rest); };`,
    '',
  ].join('\n'));
  return file;
}

function runWithPreload(preload, args, { cwd, input = '' } = {}) {
  return spawnSync('node', ['--require', preload, HOOKS, ...args], {
    cwd, input, encoding: 'utf8',
    env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' },
  });
}

const STAGED_INVENTORY = '/lib\\/hooks\\/staged-inventory(\\.js)?$/';

// real process: proves the script entry turns a VERBS exception into exit 1
test('AC1.1: a throwing VERBS handler exits 1 with empty stdout and the claude-tweaks: {verb}: stderr line', () => {
  const { root, runDir } = runDirFixture();
  const preload = preloadFor('inventory-error', STAGED_INVENTORY,
    "{ checkStagedInventory() { throw new Error('injected staged-inventory fault'); } }");
  const r = runWithPreload(preload, ['check-staged-inventory', '--run', runDir], { cwd: root });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^claude-tweaks: check-staged-inventory: injected staged-inventory fault$/m);
});

// #5376 injected-value proof: fails when the verb reads process.cwd() instead of the injected cwd.
// `--run` is absolute, yet resolveRunArg still judges it against the cwd it is handed: with process.cwd()
// the run dir is not anchored there, the verb prints its `--run path rejected` line and returns 0
// without reaching the throwing stub, so the exit-code assertion fails.
// In-process: the fault replaces checkStagedInventory on the loaded module object hooks.js calls through.
test('AC1.1: a non-Error throw value is printed with String()', async () => {
  const { root, runDir } = runDirFixture();
  const inventory = require('../plugin/bin/lib/hooks/staged-inventory');
  const realCheck = inventory.checkStagedInventory;
  inventory.checkStagedInventory = () => { throw 'raw string fault'; }; // eslint-disable-line no-throw-literal
  let r;
  try {
    r = await runCli(HOOKS, ['check-staged-inventory', '--run', runDir], {
      cwd: root, env: hookEnv({ CT_HOOKS_TEST_MODE: '1' }),
    });
  } finally {
    inventory.checkStagedInventory = realCheck;
  }
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^claude-tweaks: check-staged-inventory: raw string fault$/m);
});

// real process: proves the entry catch turns an event exception into exit 0
test('AC2.1: a throwing EVENTS module still exits 0', () => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX, 'plain-')));
  // The marker proves the injected run() actually ran: if the preload regex
  // stopped matching, the real session-end would exit 0 and this test would
  // otherwise pass vacuously.
  const marker = path.join(SANDBOX, 'session-end-fault-fired');
  const preload = preloadFor('session-end-error', '/lib\\/hooks\\/session-end(\\.js)?$/',
    `{ run() { require('fs').writeFileSync(${JSON.stringify(marker)}, 'fired'); throw new Error('injected session-end fault'); } }`);
  const r = runWithPreload(preload, ['session-end'], { cwd, input: '{}' });
  assert.ok(fs.existsSync(marker), 'the injected session-end fault fired');
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /claude-tweaks: session-end:/);
});

// real process: the fault is injected at module load, which only a preload can do
// (hooks.js destructures deriveBranch from run-integrity at load, so a module-object replacement cannot reach it)
test('record-pr still records {number, url} when deriving the branch throws', () => {
  const { root, runDir } = runDirFixture();
  // The marker proves the injected deriveBranch ran: with no recorded worktree
  // the real one returns null, which records the same {number, url}.
  const marker = path.join(SANDBOX, 'derive-branch-fault-fired');
  const preload = preloadFor('derive-branch-error', '/lib\\/hooks\\/run-integrity(\\.js)?$/',
    `Object.assign({}, load.call(this, request, ...rest), { deriveBranch() { require('fs').writeFileSync(${JSON.stringify(marker)}, 'fired'); throw new Error('injected deriveBranch fault'); } })`);
  const r = runWithPreload(preload, ['record-pr', '--run', runDir, '7', 'https://github.com/o/r/pull/7'], { cwd: root });
  assert.ok(fs.existsSync(marker), 'the injected deriveBranch fault fired');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /PR #7 recorded/);
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  assert.deepEqual(state.pr, { number: 7, url: 'https://github.com/o/r/pull/7' });
});

test('#4932: an unusable stderr still returns 1 for a throwing verb', async () => {
  const verb = VERBS['check-staged-inventory'];
  const realRun = verb.run;
  const realWriteSync = fs.writeSync;
  let stderrWrites = 0;
  // async, so it REJECTS: a sync-throwing stub is caught by the try even
  // without `await`, which would hide a missing `await` on verb.run().
  verb.run = async () => { throw new Error('injected in-process fault'); };
  fs.writeSync = (fd, ...rest) => {
    if (fd === 2) {
      stderrWrites += 1;
      throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
    }
    return realWriteSync.call(fs, fd, ...rest);
  };
  try {
    assert.equal(await main(['node', 'hooks.js', 'check-staged-inventory']), 1);
  } finally {
    verb.run = realRun;
    fs.writeSync = realWriteSync;
  }
  assert.ok(stderrWrites >= 1, 'the exception path reached the throwing fd-2 write');
});
