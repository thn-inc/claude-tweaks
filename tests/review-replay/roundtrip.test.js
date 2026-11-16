'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MANIFEST_FILE, MANIFEST_KEYS, ARM_KEYS, PROMPT_KEYS, validateManifest, armLabel } = require('../../tools/review-replay/schema');
const { setup, fullSet, runWorkflow } = require('./helpers');

test('AC11.1: extract\'s manifest and a fixed reply set round-trip through score using schema.js constants', async () => {
  let prompts = new Map();
  const s = await setup({ promptFor: (label) => prompts.get(label) });
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(s.out, MANIFEST_FILE), 'utf8'));
    assert.deepEqual(validateManifest(manifest), []);
    for (const k of MANIFEST_KEYS) assert.ok(k in manifest, `manifest key ${k}`);
    for (const arm of manifest.arms) {
      for (const k of ARM_KEYS) assert.ok(k in arm, `arm key ${k}`);
      for (const p of arm.prompts) for (const k of PROMPT_KEYS) assert.ok(k in p, `prompt key ${k}`);
    }

    // Each agent's first user message is the prompt the workflow itself built for that slot.
    const { calls } = await runWorkflow(manifest);
    assert.equal(calls.length, 6, 'two arms: four single-finding prompts and two chunk prompts');
    prompts = new Map(calls.map((c) => [c.opts.label, c.prompt]));
    assert.ok(prompts.has(armLabel('one', 1, 'run-a--0')) && prompts.has(armLabel('eight', 1, 'run-b--0')), 'the workflow labels follow armLabel');

    fullSet(s);
    const r = await s.score();
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    assert.equal(r.json.unidentifiedAgents, 0, 'every agent\'s identity line maps back to its slot');
    for (const arm of ['one', 'eight']) {
      assert.equal(r.json.arms[arm].judged, 4, `arm ${arm}: every finding judged`);
      assert.equal(r.json.arms[arm].notJudged, 0);
    }
  } finally {
    s.cleanup();
  }
});
