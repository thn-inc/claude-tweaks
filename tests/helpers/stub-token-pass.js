'use strict';
// #5555: archiveRunDir hands every non-clean close's token totals to a detached
// timing-at-close.js child. A suite that archives fixture runs for other reasons
// must not start a real child against its temp dirs: call installTokenPassStub()
// once at file level and spawnTokenPass records its calls instead of spawning.
const { before, beforeEach, after } = require('node:test');
const AT_CLOSE = require.resolve('../../plugin/bin/lib/timing/at-close');

// The real function, captured at load — before any installed stub replaces it.
const realSpawnTokenPass = require(AT_CLOSE).spawnTokenPass;

function installTokenPassStub() {
  const calls = [];
  const stub = (runDir) => { calls.push(runDir); return { spawned: true, reason: 'stubbed' }; };
  const reals = new Map();
  // Stubs the at-close module the cache holds now, not the one this helper loaded:
  // a `fresh: true` CLI run (tests/helpers/run-cli.js) drops every plugin/bin module,
  // and the next archive loads a new, unstubbed copy. Its real child starts in
  // pipelines/archive, which Windows then refuses to remove (#5694). So each test
  // starts with the cached copy stubbed; a purge and an archive inside one test body
  // still reach the real function. A copy already stubbed is left alone, so a test's
  // own temporary replacement survives its subtests.
  const install = () => {
    const atClose = require(AT_CLOSE);
    if (reals.has(atClose)) return;
    reals.set(atClose, atClose.spawnTokenPass);
    atClose.spawnTokenPass = stub;
  };
  before(install);
  beforeEach(install);
  after(() => { for (const [atClose, real] of reals) atClose.spawnTokenPass = real; });
  return calls;
}

module.exports = { installTokenPassStub, realSpawnTokenPass };
