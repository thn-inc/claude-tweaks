'use strict';
// plugin/workflows/review-lens-fanout.js (#5599) — the opt-in workflow path for /claude-tweaks:review Step 3's
// lens reviewers. Every case runs the script through tests/helpers/workflow-script.js with stubbed globals, so
// these tests cover the script's own contract only (validation, the agent calls it makes, the value it returns
// and that settle-lens-replies reads that value); they say nothing about how the real Workflow tool behaves.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWorkflowScript } = require('./helpers/workflow-script');
const { runCliSync } = require('./helpers/run-cli');
const { readText } = require('./helpers/read-skill');

const SCRIPT = path.join(__dirname, '..', 'plugin', 'workflows', 'review-lens-fanout.js');
const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'review-coordination.js');

// Runs the script with stubbed globals. `reply(prompt, opts)` is the agent stub; every call is recorded.
async function runScript(args, reply = (prompt, opts) => `reply for ${opts.label}`, parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))) {
  const { run } = loadWorkflowScript(SCRIPT);
  const calls = [];
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts });
    return reply(prompt, opts);
  };
  const result = await run({ agent, parallel, phase: () => {}, log: () => {}, args });
  return { result, calls };
}

const lens = (name, brief, model, reviewers = 2) => ({ lens: name, brief, model, reviewers });

test('meta names review-lens-fanout, a one-line description, and whenToUse naming /claude-tweaks:review and args', () => {
  const { meta } = loadWorkflowScript(SCRIPT);
  assert.strictEqual(meta.name, 'review-lens-fanout');
  assert.strictEqual(typeof meta.description, 'string');
  assert.ok(meta.description.trim() !== '' && !/\n/.test(meta.description), meta.description);
  assert.ok(meta.whenToUse.includes('/claude-tweaks:review'), meta.whenToUse);
  assert.ok(meta.whenToUse.includes('args'), meta.whenToUse);
});

test('meta reads the same from a CRLF checkout of the script', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-fanout-crlf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const crlf = path.join(dir, 'review-lens-fanout.js');
  fs.writeFileSync(crlf, readText(SCRIPT).replace(/\n/g, '\r\n'));
  assert.deepStrictEqual(loadWorkflowScript(crlf).meta, loadWorkflowScript(SCRIPT).meta);
});

test('two lenses with two reviewers each start four agents with the brief, model and label (AC2)', async () => {
  const lenses = [lens('3b', 'B3b', 'sonnet'), lens('3a', 'B3a', 'haiku')];
  const { result, calls } = await runScript({ lenses });
  assert.strictEqual(calls.length, 4);
  const byLens = { '3b': lenses[0], '3a': lenses[1] };
  for (const { prompt, opts } of calls) {
    const owner = byLens[opts.label.split(' ')[1]];
    assert.strictEqual(prompt, owner.brief, opts.label);
    assert.strictEqual(opts.model, owner.model, opts.label);
    assert.ok(!('schema' in opts), opts.label);
  }
  assert.deepStrictEqual(new Set(calls.map((c) => c.opts.label)), new Set(['lens 3b A', 'lens 3b B', 'lens 3a A', 'lens 3a B']));
  assert.deepStrictEqual(result, {
    started: true,
    lenses: [{ lens: '3b', reviewers: 2 }, { lens: '3a', reviewers: 2 }],
    reviewers: [
      { lens: '3b', side: 'A', text: 'reply for lens 3b A', failed: false },
      { lens: '3b', side: 'B', text: 'reply for lens 3b B', failed: false },
      { lens: '3a', side: 'A', text: 'reply for lens 3a A', failed: false },
      { lens: '3a', side: 'B', text: 'reply for lens 3a B', failed: false },
    ],
  });
});

test('one reviewer per lens starts side A only', async () => {
  const { result, calls } = await runScript({ lenses: [lens('3b', 'B3b', 'sonnet', 1)] });
  assert.deepStrictEqual(calls.map((c) => c.opts.label), ['lens 3b A']);
  assert.deepStrictEqual(result, {
    started: true,
    lenses: [{ lens: '3b', reviewers: 1 }],
    reviewers: [{ lens: '3b', side: 'A', text: 'reply for lens 3b A', failed: false }],
  });
});

// The script cannot require the lens class, so it restates it; settle-lens-replies refuses any token outside it.
test("the script's lens token rule is settle-lens-replies' FINDING_LENS_CLASS", () => {
  const { FINDING_LENS_CLASS } = require('../plugin/bin/lib/console/finding-path');
  assert.ok(readText(SCRIPT).includes(`const LENS_TOKEN = /^[${FINDING_LENS_CLASS}]+$/`));
});

// AC3: every refusal comes before any agent call.
const VALID_FIRST_LENS = lens('3a', 'A', 'm');
const REFUSALS = [
  ['no args', undefined, 'args must be an object'],
  ['args given as a string', '{"lenses":[]}', 'args must be an object'],
  ['an empty lenses array', { lenses: [] }, 'lenses must be a non-empty array'],
  ['lenses missing', {}, 'lenses must be a non-empty array'],
  ['a lens named twice', { lenses: [lens('3b', 'B', 'm'), lens('3b', 'B', 'm')] }, 'lens 3b is named twice'],
  ['a lens with no brief', { lenses: [{ lens: '3b', model: 'm', reviewers: 2 }] }, 'lens 3b has no brief'],
  ['a lens with a blank brief', { lenses: [lens('3b', '  \n', 'm')] }, 'lens 3b has no brief'],
  ['a lens with no model', { lenses: [{ lens: '3b', brief: 'B', reviewers: 2 }] }, 'lens 3b has no model'],
  ['reviewers: 3', { lenses: [lens('3b', 'B', 'm', 3)] }, 'lens 3b reviewers must be 1 or 2'],
  ['reviewers: 0', { lenses: [lens('3b', 'B', 'm', 0)] }, 'lens 3b reviewers must be 1 or 2'],
  ['a lens that is not one plain token', { lenses: [lens('3b x', 'B', 'm')] }, 'lens must be one plain token of letters, digits, _ or -'],
  ['an empty lens name', { lenses: [lens('', 'B', 'm')] }, 'lens must be one plain token of letters, digits, _ or -'],
  ['args given as an array', [], 'args must be an object'],
  ['a null lens entry', { lenses: [null] }, 'lens must be one plain token of letters, digits, _ or -'],
  ['a numeric lens name', { lenses: [lens(3, 'B', 'm')] }, 'lens must be one plain token of letters, digits, _ or -'],
  ["reviewers: '2' as a string", { lenses: [lens('3b', 'B', 'm', '2')] }, 'lens 3b reviewers must be 1 or 2'],
  // A valid first lens before a broken second one: every check runs over all lenses before any agent starts.
  ['a later lens with a blank brief', { lenses: [VALID_FIRST_LENS, lens('3b', ' ', 'm')] }, 'lens 3b has no brief'],
  ['a later lens with no model', { lenses: [VALID_FIRST_LENS, { lens: '3b', brief: 'B', reviewers: 2 }] }, 'lens 3b has no model'],
  ['a later lens that is not one plain token', { lenses: [VALID_FIRST_LENS, lens('3b x', 'B', 'm')] }, 'lens must be one plain token of letters, digits, _ or -'],
  ['a later lens with reviewers: 3', { lenses: [VALID_FIRST_LENS, lens('3b', 'B', 'm', 3)] }, 'lens 3b reviewers must be 1 or 2'],
];
for (const [name, args, reason] of REFUSALS) {
  test(`refuses ${name} (AC3)`, async () => {
    const { result, calls } = await runScript(args);
    assert.deepStrictEqual(result, { started: false, reason });
    assert.strictEqual(calls.length, 0);
  });
}

test('null, blank and throwing replies are failed and leave the others alone (AC4)', async () => {
  const real = '| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n\nSTATUS: DONE\n';
  const replies = {
    'lens 3a A': () => null,
    'lens 3a B': () => '   \n',
    'lens 3b A': () => { throw new Error('agent died'); },
    'lens 3b B': () => real,
  };
  const { result } = await runScript({ lenses: [lens('3a', 'B3a', 'm'), lens('3b', 'B3b', 'm')] }, (p, opts) => replies[opts.label]());
  assert.deepStrictEqual(result.reviewers, [
    { lens: '3a', side: 'A', text: null, failed: true },
    { lens: '3a', side: 'B', text: null, failed: true },
    { lens: '3b', side: 'A', text: null, failed: true },
    { lens: '3b', side: 'B', text: real, failed: false },
  ]);
});

test('a non-string reply is failed', async () => {
  const { result } = await runScript({ lenses: [lens('3b', 'B3b', 'm', 1)] }, () => ({ x: 1 }));
  assert.deepStrictEqual(result.reviewers, [{ lens: '3b', side: 'A', text: null, failed: true }]);
});

// A parallel() that does not catch: only the script's own per-call wrap keeps one throw from failing the run.
test('each agent call is wrapped on its own: a throw under a non-catching parallel() fails only that reviewer', async () => {
  const nonCatching = (thunks) => Promise.all(thunks.map((t) => t()));
  const reply = (p, opts) => {
    if (opts.label === 'lens 3a B') throw new Error('agent died');
    return `reply for ${opts.label}`;
  };
  const { result } = await runScript({ lenses: [lens('3a', 'B3a', 'm'), lens('3b', 'B3b', 'm')] }, reply, nonCatching);
  assert.deepStrictEqual(result.reviewers, [
    { lens: '3a', side: 'A', text: 'reply for lens 3a A', failed: false },
    { lens: '3a', side: 'B', text: null, failed: true },
    { lens: '3b', side: 'A', text: 'reply for lens 3b A', failed: false },
    { lens: '3b', side: 'B', text: 'reply for lens 3b B', failed: false },
  ]);
});

test('a slot parallel() leaves null is failed', async () => {
  const nullSecond = async (thunks) => (await Promise.all(thunks.map((t) => t()))).map((r, i) => (i === 1 ? null : r));
  const { result } = await runScript({ lenses: [lens('3b', 'B3b', 'm')] }, undefined, nullSecond);
  assert.deepStrictEqual(result.reviewers, [
    { lens: '3b', side: 'A', text: 'reply for lens 3b A', failed: false },
    { lens: '3b', side: 'B', text: null, failed: true },
  ]);
});

test('the returned value round-trips through settle-lens-replies unchanged (AC5)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-fanout-settle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const reply = '| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n| high | src/a.js:10 | missing expiry check on token | evidence |\n\nSTATUS: DONE';
  const { result } = await runScript({ lenses: [lens('3a', 'B3a', 'm'), lens('3b', 'B3b', 'm')] }, () => reply);
  const env = { CLAUDE_CODE_SESSION_ID: 't5599-session', TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  for (const [name, value] of [['bare.json', result], ['run-file.json', { status: 'completed', result }]]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value));
    const res = runCliSync(CLI, ['settle-lens-replies', file, '--ctx-id', 't5599'], { env, cwd: dir });
    assert.strictEqual(res.code, 0, `${name}: ${res.stderr}`);
    const printed = JSON.parse(res.stdout);
    assert.deepStrictEqual(printed.settled.map((s) => s.lens), ['3a', '3b'], name);
    for (const s of printed.settled) assert.strictEqual(s.confirmed.length, 1, `${name} lens ${s.lens}`);
    assert.deepStrictEqual(printed.needsSession, [], name);
  }
});

// AC6: the script carries no prompt text, lens rule or model choice of its own, and no API the Workflow tool
// refuses. The scan reads the raw text, comments included. Returns the names of the patterns that matched.
const BANNED = [
  ['severity literal', /['"`](critical|high|medium|low|info)['"`]/i],
  ['CALIBRATION', /CALIBRATION/],
  ['model name', /\b(haiku|sonnet|opus|fable)\b/i],
  ['require(', /require\(/],
  ['import', /^\s*import\s/m],
  ['Date.now', /Date\.now/],
  ['Math.random', /Math\.random/],
  ['schema option', /\bschema\s*:/],
];
function bannedTokens(text) {
  return BANNED.filter(([, re]) => re.test(text)).map(([name]) => name);
}

test('the script holds no prompt text, lens rule, model name or banned API (AC6)', () => {
  assert.deepStrictEqual(bannedTokens(readText(SCRIPT)), []);
});

test('the banned-token scan goes red on each token it names', () => {
  const text = readText(SCRIPT);
  const planted = [
    ['severity literal', "const s = 'high'"],
    ['severity literal', 'const s = "Critical"'],
    ['severity literal', 'const s = `info`'],
    ['CALIBRATION', '// CALIBRATION'],
    ['model name', "model: 'sonnet'"],
    ['model name', '// use Opus here'],
    ['require(', "require('fs')"],
    ['import', "import fs from 'fs'"],
    ['Date.now', 'Date.now()'],
    ['Math.random', 'Math.random()'],
    ['schema option', '{ schema: {} }'],
  ];
  for (const [name, line] of planted) assert.deepStrictEqual(bannedTokens(`${text}\n${line}\n`), [name], line);
  // Near misses the scan must leave alone.
  for (const line of ["const s = 'highlight'", '// a high bar', 'const important = 1', '{ schemas: [] }']) {
    assert.deepStrictEqual(bannedTokens(`${text}\n${line}\n`), [], line);
  }
});

// #6000: the headless-worker launcher (lib/driver/lens-workers.js) is the second producer of this reply shape.
// Both producers' output for the same two-lens input goes through settle-lens-replies, so neither drifts alone.
test("both producers' replies pass settle-lens-replies", async (t) => {
  const { runLensWorkers } = require('../plugin/bin/lib/driver/lens-workers');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lens-producers-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const sub of ['tmp', 'run', 'cwd', 'settings']) fs.mkdirSync(path.join(dir, sub));
  const reply = '| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n| high | src/a.js:10 | missing expiry check on token | evidence |\n\nSTATUS: DONE';
  const lenses = [lens('3a', 'B3a', 'haiku'), lens('3b', 'B3b', 'haiku')];
  const { result: workflow } = await runScript({ lenses }, () => reply);
  const runner = () => ({
    pid: 1,
    kill() {},
    exited: Promise.resolve({ code: 0, signal: null, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, usage: {}, permission_denials: [], structured_output: { text: reply } }) }),
  });
  const { reply: worker } = await runLensWorkers({
    lenses, runDir: path.join(dir, 'run'), cwd: path.join(dir, 'cwd'), bundleText: 'B', readPaths: [], attrSource: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    settingsDir: path.join(dir, 'settings'), platform: 'darwin', policy: {}, env: { PATH: '/nonexistent', HOME: '/h' }, gitHonoursAttrSource: true,
  }, { runner });
  const tmp = path.join(dir, 'tmp');
  const env = { CLAUDE_CODE_SESSION_ID: 't6000-session', TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  const settled = [];
  for (const [name, value] of [['workflow.json', workflow], ['worker.json', worker]]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value));
    const res = runCliSync(CLI, ['settle-lens-replies', file, '--ctx-id', 't6000'], { env, cwd: dir });
    assert.strictEqual(res.code, 0, `${name}: ${res.stderr}`);
    settled.push(JSON.parse(res.stdout).settled);
  }
  assert.deepStrictEqual(settled[0].map((s) => s.lens), ['3a', '3b']);
  assert.deepStrictEqual(settled[1], settled[0]);
});

// The launcher refuses exactly what the script refuses, with the same message.
test("the launcher's inputRefusal matches the script's refusal on every refused input", () => {
  const { inputRefusal } = require('../plugin/bin/lib/driver/lens-workers');
  for (const [name, args, reason] of REFUSALS) assert.strictEqual(inputRefusal(args), reason, name);
  assert.strictEqual(inputRefusal({ lenses: [lens('3b', 'B', 'm', 1)] }), null);
});
