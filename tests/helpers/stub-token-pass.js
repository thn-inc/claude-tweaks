'use strict';
// #5555: archiveRunDir hands every non-clean close's token totals to a detached
// timing-at-close.js child. A suite that archives fixture runs for other reasons
// must not start a real child against its temp dirs: call installTokenPassStub()
// once at file level and spawnTokenPass records its calls instead of spawning.
const { before, after } = require('node:test');
const atClose = require('../../plugin/bin/lib/timing/at-close');

// The real function, captured at load — before any installed stub replaces it.
const realSpawnTokenPass = atClose.spawnTokenPass;

function installTokenPassStub() {
  const calls = [];
  let real = null;
  before(() => {
    real = atClose.spawnTokenPass;
    atClose.spawnTokenPass = (runDir) => { calls.push(runDir); return { spawned: true, reason: 'stubbed' }; };
  });
  after(() => { if (real) atClose.spawnTokenPass = real; });
  return calls;
}

module.exports = { installTokenPassStub, realSpawnTokenPass };
