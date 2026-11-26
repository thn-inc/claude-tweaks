'use strict';
// #6010: a run's model and effort per role, derived per lane.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { readUsage } = require('../../../plugin/bin/lib/timing/transcript');
const { roleOf } = require('../../../plugin/bin/lib/timing/derive');
const { ROLES } = require('../../../plugin/bin/lib/driver/roles');
const { deriveRoles, validRoles, DRIVER_STEP_ROLES } = require('../../../plugin/bin/lib/run-manifest/roles');

function api(effort) {
  return JSON.stringify({ type: 'api-request', params: { output_config: { effort } } });
}
function asst(id, model) {
  return JSON.stringify({ timestamp: '2026-11-26T10:00:00Z', message: { role: 'assistant', id, model, usage: { input_tokens: 1, output_tokens: 1 }, content: [] } });
}
// One assistant turn per effort entry, each preceded by its api-request line.
async function rowsFor(name, model, efforts) {
  const dir = scratchDir('roles-');
  const p = path.join(dir, name);
  const lines = [];
  efforts.forEach((e, i) => { if (e) lines.push(api(e)); lines.push(asst('m' + i, model)); });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return readUsage(p);
}
// A collectDispatches-shaped item: no role, no rawModel.
const item = (description, transcriptModel, usageRows) => ({ description, transcriptModel, tokens: { input: 1 }, usageRows });

test('#6010 AC2.1: three implementers (two sonnet medium, one opus high) and one lens 3a dispatch', async () => {
  const s1 = await rowsFor('a.jsonl', 'claude-sonnet-5-5', ['medium', 'medium']);
  const s2 = await rowsFor('b.jsonl', 'claude-sonnet-5-5', ['medium', 'medium']);
  const o1 = await rowsFor('c.jsonl', 'claude-opus-5-5', ['high']);
  const items = [
    item('implement task 1', 'claude-sonnet-5-5', s1),
    item('implement task 2', 'claude-sonnet-5-5', s2),
    item('implement task 3', 'claude-opus-5-5', o1),
    item('lens 3a', 'claude-sonnet-5-5', []),
  ];
  const roles = deriveRoles({ manifest: { lane: 'standard' }, rows: [], items });
  assert.deepEqual(roles.implementer, { agents: 3, models: { 'claude-sonnet-5-5': 2, 'claude-opus-5-5': 1 }, efforts: { medium: 4, high: 1 } });
  assert.equal(roles['lens reviewer'].agents, 1);
});

test('#6010: the transcript model id wins over the dispatch alias', () => {
  const items = [
    { description: 'implement task 1', metaModel: 'sonnet', transcriptModel: 'claude-sonnet-5-5', rawModel: 'sonnet', tokens: { input: 1 }, usageRows: [] },
    { description: 'implement task 2', transcriptModel: 'claude-sonnet-5-5', tokens: { input: 1 }, usageRows: [] },
  ];
  const roles = deriveRoles({ manifest: { lane: 'standard' }, items });
  assert.deepEqual(roles.implementer.models, { 'claude-sonnet-5-5': 2 });
});

test('#6010 AC3.1: a description no roleOf pattern matches counts under unlabelled', () => {
  const roles = deriveRoles({ manifest: { lane: 'standard' }, items: [{ description: 'ponder things', rawModel: 'sonnet', tokens: { input: 1 }, usageRows: [] }] });
  assert.equal(roles.unlabelled.agents, 1);
});

test('#6010 AC4.1: driver lane, implementer launch on sonnet and reviewer on opus, no effort -> unknown', () => {
  const events = [{ step: 'worker', status: 'ok', model: 'sonnet', usage: { input_tokens: 1 } }, { step: 'review', status: 'ok', model: 'opus', usage: { input_tokens: 1 } }, { step: 'claim', status: 'ok' }];
  assert.deepEqual(deriveRoles({ manifest: { lane: 'driver' }, events }), {
    implementer: { agents: 1, models: { sonnet: 1 }, efforts: { unknown: 1 } },
    reviewer: { agents: 1, models: { opus: 1 }, efforts: { unknown: 1 } },
  });
});

test('#6010 AC6.1: the main session appears as session with its own model ids and effort counts', async () => {
  const rows = await rowsFor('main.jsonl', 'claude-opus-5-5', ['high', 'high', 'medium']);
  assert.deepEqual(deriveRoles({ manifest: { lane: 'standard' }, rows, items: [] }), {
    session: { agents: 1, models: { 'claude-opus-5-5': 1 }, efforts: { high: 2, medium: 1 } },
  });
});

test('#6010: an unreadable-transcript item counts under model unknown and adds no efforts', () => {
  const roles = deriveRoles({ manifest: null, items: [{ description: 'implement task 1', role: 'implementer', rawModel: 'sonnet', tokens: null }] });
  assert.deepEqual(roles, { implementer: { agents: 1, models: { unknown: 1 }, efforts: {} } });
});

test('#6010: a headless lens worker item (no usageRows) counts one unknown effort', () => {
  const roles = deriveRoles({ manifest: { lane: 'standard' }, items: [{ kind: 'worker', description: 'lens 2', role: 'lens reviewer', metaModel: 'claude-sonnet-5-5', tokens: { input: 1 } }] });
  assert.deepEqual(roles, { 'lens reviewer': { agents: 1, models: { 'claude-sonnet-5-5': 1 }, efforts: { unknown: 1 } } });
});

test('#6010: a driver line effort is kept as seen, a fix relaunch counts as implementer, lane selects the source', () => {
  const events = [
    { step: 'worker', model: 'sonnet', effort: 'xhigh', usage: {} },
    { step: 'worker', model: 'sonnet', fix: true, usage: {} },
  ];
  const d = deriveRoles({ manifest: { lane: 'driver' }, events, rows: [{ role: 'assistant', turnStart: true, model: 'x' }], items: [item('implement x', 'x', [])] });
  assert.deepEqual(d, { implementer: { agents: 2, models: { sonnet: 2 }, efforts: { xhigh: 1, unknown: 1 } } });
  const s = deriveRoles({ manifest: { lane: 'standard' }, events, rows: [], items: [] });
  assert.equal(s, null);
});

test('#6010: __proto__ as a model id and as an effort is an own key', () => {
  const roles = deriveRoles({ manifest: { lane: 'driver' }, events: [{ step: 'worker', model: '__proto__', effort: '__proto__' }] });
  assert.ok(Object.hasOwn(roles.implementer.models, '__proto__'));
  assert.ok(Object.hasOwn(roles.implementer.efforts, '__proto__'));
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal({}.models, undefined);
});

test('#6010: no source -> null', () => {
  assert.equal(deriveRoles({ manifest: { lane: 'standard' }, rows: [], items: [] }), null);
  assert.equal(deriveRoles({ manifest: { lane: 'driver' }, events: [{ step: 'claim' }, { step: 'worker' }] }), null);
});

test('#6010: DRIVER_STEP_ROLES names only roles defined in driver/roles.js ROLES', () => {
  for (const r of Object.values(DRIVER_STEP_ROLES)) assert.ok(Object.hasOwn(ROLES, r), r);
});

test('#6010: validRoles accepts derived output and rejects bad shapes', () => {
  const good = deriveRoles({ manifest: { lane: 'driver' }, events: [{ step: 'review', model: 'opus' }] });
  assert.equal(validRoles(good), true);
  const ok = { agents: 1, models: {}, efforts: {} };
  for (const bad of [null, [], { x: null }, { x: { ...ok, agents: -1 } }, { x: { ...ok, agents: 1.5 } }, { x: { ...ok, models: { a: '1' } } }]) {
    assert.equal(validRoles(bad), false, JSON.stringify(bad));
  }
});

test('#6010 F1: odd input shapes never throw and give null or a valid shape', () => {
  const odd = [undefined, null, {}, { manifest: null }, { manifest: 5, rows: 'x', items: 3, events: {} },
    { manifest: { lane: 'standard' }, rows: [null, 1, 'x', []], items: [null, 7, 'x', []] },
    { manifest: { lane: 'driver' }, events: [null, 1, 'x', [], { step: 5 }, { step: 'worker', usage: 'x' }] }];
  for (const a of odd) {
    const r = deriveRoles(a);
    assert.ok(r === null || validRoles(r), JSON.stringify(a));
  }
});

test('#6010 F6a: a driver launch line with usage but no model counts under unknown', () => {
  const roles = deriveRoles({ manifest: { lane: 'driver' }, events: [{ step: 'worker', usage: { input: 1 } }] });
  assert.deepEqual(roles, { implementer: { agents: 1, models: { unknown: 1 }, efforts: { unknown: 1 } } });
});

test('#6010 F6b: a <synthetic> session row is excluded from models and efforts', () => {
  const rows = [
    { role: 'assistant', turnStart: true, model: 'claude-opus-5-5', effort: 'high' },
    { role: 'assistant', turnStart: true, model: '<synthetic>', effort: 'low' },
  ];
  assert.deepEqual(deriveRoles({ manifest: { lane: 'standard' }, rows }), { session: { agents: 1, models: { 'claude-opus-5-5': 1 }, efforts: { high: 1 } } });
});

test('#6010 F6c: validRoles rejects a non-integer efforts value and a non-object models', () => {
  assert.equal(validRoles({ x: { agents: 1, models: {}, efforts: { high: 1.5 } } }), false);
  assert.equal(validRoles({ x: { agents: 1, models: 'a', efforts: {} } }), false);
  assert.equal(validRoles({ x: { agents: 1, models: [], efforts: {} } }), false);
});

test('#6010 F7: an empty-string role falls back to roleOf, an empty model id falls through to unknown', () => {
  const items = [
    { description: 'implement task 1', role: '', transcriptModel: '', rawModel: '', metaModel: 'sonnet', tokens: { input: 1 }, usageRows: [] },
    { description: 'implement task 2', transcriptModel: '', rawModel: '', metaModel: '', tokens: { input: 1 }, usageRows: [] },
  ];
  const roles = deriveRoles({ manifest: { lane: 'standard' }, items });
  assert.deepEqual(Object.keys(roles), ['implementer']);
  assert.deepEqual(roles.implementer.models, { sonnet: 1, unknown: 1 });
});

test('#6010 F1 exact: absent, non-array or unmapped driver events give exact outputs', () => {
  const d = { lane: 'driver' };
  assert.equal(deriveRoles({ manifest: d }), null);
  assert.equal(deriveRoles({ manifest: d, events: {} }), null);
  assert.equal(deriveRoles({ manifest: d, events: [{ step: 'plan', model: 'x' }] }), null);
  assert.equal(deriveRoles({ manifest: d, events: [{ step: 'worker', usage: 'x' }] }), null);
  assert.deepEqual(deriveRoles({ manifest: d, events: [{ step: 'plan', model: 'x' }, { step: 'worker', usage: 'x' }, { step: 'worker', model: 'm', effort: 'low' }] }),
    { implementer: { agents: 1, models: { m: 1 }, efforts: { low: 1 } } });
});

test('#6010 F1 exact: a null entry in an item usageRows is skipped', () => {
  const roles = deriveRoles({ manifest: { lane: 'standard' }, items: [{ description: 'implement x', transcriptModel: 'm', tokens: { input: 1 }, usageRows: [null, { role: 'assistant', turnStart: true, effort: 'high' }] }] });
  assert.deepEqual(roles, { implementer: { agents: 1, models: { m: 1 }, efforts: { high: 1 } } });
});

test('#6010: a session row with an empty-string model adds no model key', () => {
  const roles = deriveRoles({ manifest: { lane: 'standard' }, rows: [{ role: 'assistant', turnStart: true, model: '' }] });
  assert.deepEqual(roles, { session: { agents: 1, models: {}, efforts: { unknown: 1 } } });
});
