'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { structurallyStuckBody } = require(path.join(__dirname, '../../../plugin/bin/lib/reconcile/escalate-residue.js'));
const { STRUCTURALLY_STUCK_REASONS } = require(path.join(__dirname, '../../../plugin/bin/lib/reconcile/archive-merged.js'));

test('every escalated structurally-stuck reason is named and has a remedy paragraph', () => {
  const lines = structurallyStuckBody(['/x/run-a']).split('\n');
  const remedies = lines.slice(1).filter((l) => /^For an? /.test(l));
  const missing = [];
  for (const reason of STRUCTURALLY_STUCK_REASONS) {
    const tick = '`' + reason + '`';
    if (!lines[0].includes(tick) || !remedies.some((l) => l.includes(tick))) missing.push(reason);
  }
  assert.deepStrictEqual(missing, []);
});
