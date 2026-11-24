'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/context-gauge');
const { gitRepo, harnessWorktreeOf } = require('../../helpers/git-fixtures');

delete process.env.CLAUDE_CONFIG_DIR;

const RUN_ID = '2026-10-25T162129-record-4027';
const NOW = Date.parse('2026-10-25T18:00:00.000Z');
const created = [];
test.after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true }); });
function tmp(prefix) { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); created.push(d); return d; }
const userLine = (content) => JSON.stringify({ type: 'user', timestamp: '2026-10-25T17:00:00.000Z', message: { role: 'user', content } });
function turnLines(id, { input = 2, cacheRead = 0, cacheCreate = 0 }) {
  const usage = (out) => ({ input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate, output_tokens: out });
  const ts = '2026-10-25T17:01:00.000Z';
  return [
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }], stop_reason: null, usage: usage(8) } }),
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: usage(400) } }),
  ];
}
const configYml = (mode) => `mode: ${mode}\nscope-creep: add-to-plan\noverlap: companion\nmerge-authorization: ask\nspec: 4027\ncreated: 2026-10-25T162129\n`;
function runFixture() {
  const root = gitRepo();
  created.push(root);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), configYml('auto'));
  const wt = harnessWorktreeOf(root);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ worktree: wt, status: 'active' }));
  fs.mkdirSync(path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'work'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'work', '4027-spec.md'), '# spec\n');
  return { root, runDir };
}
function transcriptAt(dir, tokens) {
  const p = path.join(dir, 'agent-t.jsonl');
  fs.writeFileSync(p, [userLine('x ' + RUN_ID), ...turnLines('m1', { cacheRead: 1000 }), ...turnLines('m2', { input: 2, cacheRead: tokens - 2 - 500, cacheCreate: 500 })].join('\n') + '\n');
  return p;
}
function cli(fx) {
  const out = []; const err = [];
  return { out, err, deps: { cwd: () => fx.root, mainRoot: fx.root, env: {}, now: () => NOW, stdout: (s) => out.push(s), stderr: (s) => err.push(s) }, json: () => JSON.parse(out.join('')) };
}

test('--stories-owed: a list putting stories after test must not hand off', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-order-'), 250000);
  const c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test,review,stories', '--stories-owed'], c.deps), 0, c.err.join(''));
  assert.strictEqual(c.json().over, true);
  assert.strictEqual(c.json().handoff, null, 'a handoff that runs test before the owed stories step was written');
  assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'handoff.json')), false);
});
