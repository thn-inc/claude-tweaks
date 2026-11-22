const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { committedRepo } = require('../../helpers/git-fixtures');

const RESIDUE = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'residue.js');
const SHARED = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'shared-primitives.js');

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
  const { dir: root } = committedRepo({ prefix: 'residue-gh-timeout-', branch: 'main' });
  try {
    const fresh = require(RESIDUE);
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
    fs.rmSync(root, { recursive: true, force: true });
  }
});
