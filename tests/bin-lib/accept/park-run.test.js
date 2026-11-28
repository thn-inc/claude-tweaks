'use strict';
// tests/bin-lib/accept/park-run.test.js — runPark, the ordered park executor (#4615).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runPark } = require('../../../plugin/bin/lib/accept/park');

const NAMES = ['postPacket', 'writeDeployStatus', 'archiveRun', 'releaseClaim', 'removeWorktree'];

// Five recording steps; `override` replaces one by name.
function stepsRecording(order, override = {}) {
  const steps = {};
  NAMES.forEach((name, index) => {
    steps[name] = async () => {
      order.push(index + 1);
      if (override[name]) return override[name]();
      return { ok: true, detail: `${name} done` };
    };
  });
  return steps;
}

test('AC3.1: steps run in the pinned order', async () => {
  const order = [];
  const result = await runPark(stepsRecording(order));
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
  assert.equal(result.outcome, 'parked');
  assert.equal(result.reason, 'awaiting-local-acceptance');
  assert.deepEqual(result.steps.map(({ step, name, ok }) => ({ step, name, ok })),
    NAMES.map((name, index) => ({ step: index + 1, name, ok: true })));
  assert.equal(result.steps[0].detail, 'postPacket done');
});

test('AC3.5: a failure at step 1 or 2 stops before archive', async () => {
  for (const [name, fail] of [['postPacket', () => ({ ok: false, detail: 'no post' })], ['writeDeployStatus', () => ({ ok: false })],
    ['writeDeployStatus', () => { throw new Error('edit refused'); }]]) {
    const order = [];
    const result = await runPark(stepsRecording(order, { [name]: fail }));
    const stopAt = NAMES.indexOf(name) + 1;
    assert.deepEqual(order, [1, 2].slice(0, stopAt), name);
    assert.equal(result.outcome, 'park-failed');
    assert.equal(result.reason, 'awaiting-local-acceptance');
    assert.equal(result.steps.length, stopAt);
    assert.equal(result.steps.at(-1).ok, false);
  }
});

test('AC3.6: a forced failure at archive, release or worktree removal is reported and the rest still run', async () => {
  for (const name of ['archiveRun', 'releaseClaim', 'removeWorktree']) {
    const order = [];
    const result = await runPark(stepsRecording(order, { [name]: () => { throw new Error(`${name} exploded`); } }));
    assert.deepEqual(order, [1, 2, 3, 4, 5], name);
    assert.equal(result.outcome, 'parked', name);
    const failed = result.steps.filter((step) => !step.ok);
    assert.deepEqual(failed.map((step) => step.name), [name]);
    assert.match(failed[0].detail, new RegExp(`${name} exploded`));
  }
});

test('a step result that is not { ok: true } counts as a failure', async () => {
  const order = [];
  const result = await runPark(stepsRecording(order, { archiveRun: () => undefined }));
  assert.equal(result.outcome, 'parked');
  assert.equal(result.steps[2].ok, false);
});

test('a missing step function is a caller bug', async () => {
  const steps = stepsRecording([]);
  delete steps.releaseClaim;
  await assert.rejects(() => runPark(steps), { name: 'TypeError', message: /releaseClaim/ });
});
