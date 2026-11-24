'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agentIdentity } = require('../../tools/review-replay/score');
const { armLabel, parseArmLabel, validateManifest } = require('../../tools/review-replay/schema');
const { workflowSource, runWorkflow } = require('./helpers');

const META_RE = /export const meta = \{[\s\S]*?\n\}\n/;
const bodyOf = () => {
  const src = workflowSource();
  assert.match(src, META_RE, 'the workflow declares its meta as an export const block');
  return src.replace(META_RE, '');
};

// Evaluates a template literal taken from the workflow's source, with the names it interpolates bound.
const fillTemplate = (template, scope) => new Function(...Object.keys(scope), `return \`${template}\`;`)(...Object.values(scope));

test('AC7.1: replay.workflow.js holds no Verdict: rule, no model name outside meta, and one agent call', () => {
  const body = bodyOf();
  assert.ok(!/Verdict:/.test(body), 'no Verdict: rule');
  assert.ok(!/\b(opus|sonnet|haiku|fable)\b/i.test(body), 'no model name outside meta');
  assert.equal((body.match(/\bagent\(/g) || []).length, 1, 'exactly one agent call in source');
});

test('the workflow\'s meta names the review-replay workflow and its one Judges phase', () => {
  const src = workflowSource();
  const phases = /phases: \[\{ title: 'Judges', detail: 'one agent per prompt file per repeat' \}\]/;
  assert.match(src, /name: 'review-replay'/);
  assert.match(src, phases);
});

test('the workflow\'s label template matches armLabel', () => {
  const template = /const label = `([^`]*)`/.exec(bodyOf());
  assert.ok(template, 'the workflow builds its label from one template literal');
  const label = fillTemplate(template[1], { arm: { name: 'A' }, r: 1, p: { name: 'N' } });
  assert.equal(label, armLabel('A', 1, 'N'));
  assert.deepEqual(parseArmLabel(label), { arm: 'A', repeat: 1, name: 'N' });
});

test('the workflow\'s identity line round-trips through agentIdentity', () => {
  const template = /agent\(`([^`]*)`/.exec(bodyOf());
  assert.ok(template, 'the agent prompt is one template literal');
  const label = armLabel('A', 1, 'N');
  const prompt = fillTemplate(template[1], { label, p: { file: '/abs/prompts/N.md' } });
  const transcript = JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } });
  assert.equal(agentIdentity(transcript), label);
  assert.equal(prompt.split('\n')[0], `Replay judge ${label}.`, 'the identity line is the first line');
  assert.match(prompt, /\/abs\/prompts\/N\.md/, 'the prompt points at the prompt file');
});

test('an arm whose profile has no effort passes no effort option to agent()', async () => {
  const manifest = {
    schemaVersion: 1,
    template: {},
    arms: [{ name: 'f', chunk: 1, profile: 'fast', model: 'm-f', effort: null, repeat: 1, prompts: [{ file: '/p/a.md', name: 'a', run: 'r', findingIds: [] }] }],
  };
  const { calls } = await runWorkflow(manifest);
  assert.deepEqual(calls.map((c) => c.opts), [{ label: 'f|1|a', phase: 'Judges', model: 'm-f' }]);
});

test('run with a manifest: one agent per arm x repeat x prompt, with the arm\'s model and effort, returning their replies', async () => {
  const manifest = {
    schemaVersion: 1,
    template: {},
    arms: [
      { name: 'one', chunk: 1, profile: 'fast', model: 'm-one', effort: 'e-one', repeat: 2, prompts: [{ file: '/p/a.md', name: 'a', run: 'r', findingIds: [] }, { file: '/p/b.md', name: 'b', run: 'r', findingIds: [] }] },
      { name: 'two', chunk: 8, profile: 'fast', model: 'm-two', effort: 'e-two', repeat: 1, prompts: [{ file: '/p/c.md', name: 'c', run: 'r', findingIds: [] }] },
    ],
  };
  assert.deepEqual(validateManifest(manifest), [], 'the hand-built manifest is a valid manifest');
  const { calls, result } = await runWorkflow(manifest);
  assert.deepEqual(calls.map((c) => c.opts), [
    { label: 'one|1|a', phase: 'Judges', model: 'm-one', effort: 'e-one' },
    { label: 'one|1|b', phase: 'Judges', model: 'm-one', effort: 'e-one' },
    { label: 'one|2|a', phase: 'Judges', model: 'm-one', effort: 'e-one' },
    { label: 'one|2|b', phase: 'Judges', model: 'm-one', effort: 'e-one' },
    { label: 'two|1|c', phase: 'Judges', model: 'm-two', effort: 'e-two' },
  ]);
  assert.equal(calls[0].prompt, 'Replay judge one|1|a.\nRead /p/a.md and follow it exactly; it is your whole task.');
  assert.deepEqual(result.map((x) => [x.arm, x.repeat, x.name, x.reply]), [
    ['one', 1, 'a', 'reply for one|1|a'], ['one', 1, 'b', 'reply for one|1|b'],
    ['one', 2, 'a', 'reply for one|2|a'], ['one', 2, 'b', 'reply for one|2|b'],
    ['two', 1, 'c', 'reply for two|1|c'],
  ]);
});
