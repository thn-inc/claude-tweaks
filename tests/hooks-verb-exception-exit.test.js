'use strict';
// #4932: hooks.js splits two exit contracts. A directly invoked VERBS command's
// unexpected exception exits 1 with `claude-tweaks: {verb}: {message}` on
// stderr (main() catches it); a harness-dispatched EVENTS module's exception
// still exits 0 through the entry catch (never break a session). Both halves
// are pinned here against real processes, with a Module._load preload standing
// in for the fault.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const { main, VERBS } = require(HOOKS);

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verb-exc-')));
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// A realpath'd git repo with one commit and an active run dir, so
// `check-staged-inventory --run <runDir>` anchors and reaches its handler.
function runDirFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX, 'repo-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
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

test('AC1.1: a throwing VERBS handler exits 1 with empty stdout and the claude-tweaks: {verb}: stderr line', () => {
  const { root, runDir } = runDirFixture();
  const preload = preloadFor('inventory-error', STAGED_INVENTORY,
    "{ checkStagedInventory() { throw new Error('injected staged-inventory fault'); } }");
  const r = runWithPreload(preload, ['check-staged-inventory', '--run', runDir], { cwd: root });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^claude-tweaks: check-staged-inventory: injected staged-inventory fault$/m);
});

test('AC1.1: a non-Error throw value is printed with String()', () => {
  const { root, runDir } = runDirFixture();
  const preload = preloadFor('inventory-string', STAGED_INVENTORY,
    "{ checkStagedInventory() { throw 'raw string fault'; } }");
  const r = runWithPreload(preload, ['check-staged-inventory', '--run', runDir], { cwd: root });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^claude-tweaks: check-staged-inventory: raw string fault$/m);
});

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
