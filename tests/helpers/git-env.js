'use strict';
// Shared by git-fixture setup code and the health-sweep CLI test runner.

// The four variables that repoint git at another repository.
const AMBIENT_GIT_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

// A copy of `env` without them, so one the test runner inherited (e.g. from a git hook)
// cannot redirect a fixture call.
function withoutAmbientGitVars(env) {
  const out = { ...env };
  for (const k of AMBIENT_GIT_VARS) delete out[k];
  return out;
}

module.exports = { AMBIENT_GIT_VARS, withoutAmbientGitVars };
