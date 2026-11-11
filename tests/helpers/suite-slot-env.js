'use strict';
// #5119: the env for a verify.js child whose test exercises the machine-wide suite slot. This
// suite runs under tools/run-tests.js, which sets CT_TEST_SUITE_SLOT_HELD=1 (and may set
// CT_TEST_WORKERS) for everything it spawns — inherited, a child takes no slot and the test proves
// nothing. Both are stripped, the slot-count knobs and NODE_TEST_CONTEXT with them (a nested
// `node --test` would otherwise run its files bare), and CT_TEST_SUITE_SLOT_DIR points at the
// test's own `dir`, never the real machine-wide one. `extra` is applied last.
function slotEnv(dir, extra = {}, base = process.env) {
  const env = { ...base, CT_TEST_SUITE_SLOT_DIR: dir };
  for (const key of ['CT_TEST_SUITE_SLOT_HELD', 'CT_TEST_WORKERS', 'CT_TEST_SUITE_SLOTS', 'CT_TEST_SUBSET_SLOTS', 'NODE_TEST_CONTEXT']) {
    delete env[key];
  }
  return { ...env, ...extra };
}

module.exports = { slotEnv };
