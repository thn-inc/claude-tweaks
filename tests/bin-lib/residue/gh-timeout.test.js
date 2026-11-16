const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RESIDUE = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'residue.js');
const SHARED = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'shared-primitives.js');

// A fixture git call that ignores any repo-locating variable the test process inherited.
function git(cwd, ...args) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(prefix, branch = 'main') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(root, 'init', '-q', '-b', branch);
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'commit', '--allow-empty', '-q', '-m', 'init');
  return root;
}

function evict() {
  delete require.cache[RESIDUE];
  delete require.cache[SHARED];
}

// The CLI's gh timeout comes from the process env through the memoized shared getter, so the env var
// is set here and the two modules are required fresh; the recorded calls are the CLI's runner seam.
test('residue bounds a gh argv with GH_TIMEOUT_MS and leaves a git argv unbounded', () => {
  const key = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const saved = process.env[key];
  process.env[key] = '12000';
  evict();
  try {
    const fresh = require(RESIDUE);
    const root = initRepo('residue-gh-timeout-');
    const calls = [];
    const runner = (argv, opts) => {
      calls.push([argv, opts]);
      return argv[0] === 'gh' ? '[]' : fresh.realDeps.runner(argv, opts);
    };
    let out = '';
    const code = fresh.run(['--base', 'HEAD', '--no-suite'], {
      runner,
      cwd: () => root,
      stdout: (s) => { out += s; },
      stderr: () => {},
    });
    assert.strictEqual(code, 0);

    const ghPr = calls.find(([argv]) => argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'list');
    assert.ok(ghPr, 'expected a gh pr list call');
    assert.strictEqual(ghPr[1].timeout, 12000);

    const revParse = calls.find(([argv]) => argv[0] === 'git' && argv.includes('rev-parse'));
    assert.ok(revParse, 'expected a git rev-parse call');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(revParse[1], 'timeout'), false);
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
    evict();
  }
});
