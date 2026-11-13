const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'residue.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// assert.throws(/Command failed/) would pass for ANY nonzero exit code — this
// captures the error so status and stderr can both be checked directly
// (tests/bin-lib/record-graph/cli-render.test.js's own pattern).
function runExpectingFailure(args) {
  let error;
  try {
    execFileSync('node', [CLI, ...args], {
      cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (e) {
    error = e;
  }
  assert.ok(error, `expected a nonzero exit for: ${args.join(' ')}`);
  return error;
}

module.exports = { CLI, REPO_ROOT, runExpectingFailure };
