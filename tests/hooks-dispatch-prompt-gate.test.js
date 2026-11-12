'use strict';
// #4589: the PreToolUse prompt-fidelity gate on Agent/Task (bin/lib/hooks/dispatch-prompt-gate.js).
// Fixtures use the real writers: run-state.json comes from `hooks.js record-worktree` (with and
// without --dispatch), and every rendered prompt plus its registry line comes from
// bin/dispatch-prompt.js's run() with fake resolvers and the real writeFile/appendFile/removeFile.
// Most cases go through pre-tool-use.js's run(), so runInner's early return and denyResult are the
// path under test; the tool-name case calls the gate directly, since runInner routes only Agent/Task.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { run: renderPrompt } = require('../plugin/bin/dispatch-prompt');
const { REGISTRY_FILE } = require('../plugin/bin/lib/dispatch/task-prompt');
const ptu = require('../plugin/bin/lib/hooks/pre-tool-use');
const { checkDispatchPromptGate } = require('../plugin/bin/lib/hooks/dispatch-prompt-gate');

process.env.CT_HOOKS_TEST_MODE = '1';

const REPO = path.join(__dirname, '..');
const HOOKS = path.join(REPO, 'plugin', 'bin', 'hooks.js');
const R = '2026-11-01T181353-record-4589';
const GATE = 'dispatch-prompt-fidelity';

const tmpRoots = [];
after(() => { tmpRoots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

function mkTmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpRoots.push(d);
  return d;
}

function git(args) {
  return execFileSync('git', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function recordWorktree(project, runDir, { dispatch = true, session = 'S' } = {}) {
  const args = [HOOKS, 'record-worktree', '--run', runDir, '/tmp/wt-4589'];
  if (dispatch) args.push('--dispatch');
  const res = spawnSync(process.execPath, args, {
    cwd: project, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: session, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' },
  });
  assert.strictEqual(res.status, 0, res.stderr);
}

// A temp main checkout with pipelines/R bound by the real writer (dispatch: --dispatch from session S).
function fixture({ dispatch = true, session = 'S' } = {}) {
  const project = mkTmp('ct-dpg-');
  git(['-C', project, 'init', '-q']);
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', R);
  fs.mkdirSync(runDir, { recursive: true });
  recordWorktree(project, runDir, { dispatch, session });
  return { project, runDir, outDir: mkTmp('ct-dpg-out-') };
}

function render(fx, call, { extra = [], out } = {}) {
  const o = out || path.join(fx.outDir, `${call}.md`);
  let stdout = '';
  let stderr = '';
  const code = renderPrompt(['--call', call, '--run', fx.runDir, '--issues', '4589', '--out', o, ...extra], {
    cwd: () => fx.project,
    env: {},
    resolvePolicyValues: () => 'autonomy=unattended, integration-model=pr-first, merge-verification=(unset), risk-floor=(unset), size-floor=(unset)',
    resolveProfile: () => ({ model: 'opus', effort: 'high', source: 'default', effortLine: '[Effort: high — apply high-level reasoning depth to this task.]' }),
    selectedAt: () => '2026-11-12T10:00:00.000Z',
    now: () => '2026-11-12T10:00:01.000Z',
    defaultOut: () => null,
    stdout: (s) => { stdout += s; },
    stderr: (s) => { stderr += s; },
  });
  assert.strictEqual(code, 0, stderr);
  return { out: o, prompt: fs.readFileSync(o, 'utf8'), envelope: JSON.parse(stdout) };
}

const ctxFor = (fx, prompt, over = {}) => ({
  cwd: fx.cwd || fx.project,
  input: { tool_name: 'Agent', session_id: 'S', tool_input: { subagent_type: 'general-purpose', prompt }, ...over },
});
const gate = (ctx, deps = {}) => ptu.run(ctx, deps);
const denyReason = (out) => {
  const h = out && out.json && out.json.hookSpecificOutput;
  return h && h.permissionDecision === 'deny' ? h.permissionDecisionReason : null;
};
const gateEvents = (runDir) => {
  let text = '';
  try { text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.gate === GATE);
};
const editWord = (prompt) => {
  const changed = prompt.replace(/\bExecute\b/, 'Run');
  assert.notStrictEqual(changed, prompt, 'fixture: the edit must change the prompt');
  return changed;
};
const stripMarker = (prompt) => {
  const changed = prompt.replace(/^\[dispatch-prompt: [^\]\n]+\]\n+/, '');
  assert.notStrictEqual(changed, prompt, 'fixture: the marker line must be removed');
  return changed;
};
const assertAllowedNoEvent = (out, fx) => {
  assert.deepStrictEqual(out, {});
  assert.deepStrictEqual(gateEvents(fx.runDir), []);
};
const fsWith = (over) => ({ ...fs, ...over });
const eacces = (p) => { const e = new Error(`EACCES: permission denied, open '${p}'`); e.code = 'EACCES'; throw e; };

for (const toolName of ['Agent', 'Task']) {
  test(`AC5.1: the rendered prompt is allowed (${toolName})`, () => {
    const fx = fixture();
    const first = render(fx, 'first');
    assert.deepStrictEqual(gate(ctxFor(fx, first.prompt, { tool_name: toolName })), {});
    const second = render(fx, 'second');
    assert.deepStrictEqual(gate(ctxFor(fx, second.prompt, { tool_name: toolName })), {});
    assert.deepStrictEqual(gateEvents(fx.runDir), []);
  });

  test(`AC5.1: a prompt that differs from the rendered file is denied before the agent starts (${toolName})`, () => {
    const fx = fixture();
    const first = render(fx, 'first');
    const out = gate(ctxFor(fx, editWord(first.prompt), { tool_name: toolName }));
    const reason = denyReason(out);
    assert.ok(reason, 'expected a deny');
    assert.strictEqual(out.exit, 0);
    assert.match(reason, /byte-for-byte/);
    assert.ok(reason.includes(`"${first.out}.part1"`), reason);
    assert.ok(reason.includes(`run ${R}`), reason);
    const ev = gateEvents(fx.runDir);
    assert.strictEqual(ev.length, 1);
    assert.strictEqual(ev[0].type, 'gate-denial');
    assert.strictEqual(ev[0].reason, 'mismatch');
    assert.strictEqual(ev[0].tool, toolName);
    assert.strictEqual(ev[0].test, true);
  });
}

test('AC5.1: the rendered prompt plus a trailing newline is denied', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  assert.ok(denyReason(gate(ctxFor(fx, `${first.prompt}\n`))));
});

test('AC5.1: a marker-bearing prompt with no registry is denied', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  fs.rmSync(path.join(fx.runDir, REGISTRY_FILE));
  const reason = denyReason(gate(ctxFor(fx, first.prompt)));
  assert.ok(reason, 'ENOENT registry: no prompt was ever rendered for this run');
  assert.match(reason, /cat each of the files dispatch-prompt\.js wrote and pass them/);

  // A registry holding only a second-call line, for a first marker.
  const fx2 = fixture();
  const first2 = render(fx2, 'first');
  fs.rmSync(path.join(fx2.runDir, REGISTRY_FILE));
  render(fx2, 'second');
  assert.ok(denyReason(gate(ctxFor(fx2, first2.prompt))));
});

test('AC5.1: an older render for the same call is denied', () => {
  const fx = fixture();
  const older = render(fx, 'first', { out: path.join(fx.outDir, 'first-a.md') });
  const newer = render(fx, 'first', { extra: ['--headless'], out: path.join(fx.outDir, 'first-b.md') });
  assert.notStrictEqual(older.prompt, newer.prompt);
  const check = () => {
    assert.deepStrictEqual(gate(ctxFor(fx, newer.prompt)), {});
    const reason = denyReason(gate(ctxFor(fx, older.prompt)));
    assert.ok(reason, 'the older render is no longer current');
    assert.ok(reason.includes(`"${newer.out}.part1"`), reason);
    assert.ok(!reason.includes(older.out), reason);
  };
  check();
  fs.appendFileSync(path.join(fx.runDir, REGISTRY_FILE), '{not json\n');
  check();
  // A later second-call render: only the call filter keeps the newer first-call line current.
  render(fx, 'second');
  assert.deepStrictEqual(gate(ctxFor(fx, newer.prompt)), {});
});

test('AC5.1: a marker-less prompt naming a bound run is denied in every form', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const out = gate(ctxFor(fx, stripMarker(first.prompt)));
  const reason = denyReason(out);
  assert.ok(reason);
  assert.match(reason, /no dispatch-prompt\.js marker/);
  assert.ok(reason.includes(`names run ${R}`), reason);
  const ev = gateEvents(fx.runDir);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].reason, 'missing-marker');
  const cut = fx.runDir.lastIndexOf('/');
  const forms = [
    `PIPELINE_RUN_DIR="${fx.runDir}" x`,
    `PIPELINE_RUN_DIR=${fx.runDir} x`,
    `export PIPELINE_RUN_DIR=${fx.runDir}`,
    `${fx.runDir.slice(0, cut + 1)}\n${fx.runDir.slice(cut + 1)}`,
    `resume run ${R}`,
  ];
  for (const prompt of forms) {
    assert.ok(denyReason(gate(ctxFor(fx, prompt))), `expected a deny for ${JSON.stringify(prompt)}`);
  }
});

test('AC5.1: a prompt carrying agent_id is allowed by both rules', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  assert.deepStrictEqual(gate(ctxFor(fx, editWord(first.prompt), { agent_id: 'a1' })), {});
  assert.deepStrictEqual(gate(ctxFor(fx, stripMarker(first.prompt), { agent_id: 'a1' })), {});
  assert.deepStrictEqual(gateEvents(fx.runDir), []);
});

test('an empty or null agent_id is a main-thread call: both rules still deny', () => {
  for (const agentId of ['', null]) {
    const fx = fixture();
    const first = render(fx, 'first');
    assert.ok(denyReason(gate(ctxFor(fx, editWord(first.prompt), { agent_id: agentId }))), `rule A, agent_id ${JSON.stringify(agentId)}`);
    assert.ok(denyReason(gate(ctxFor(fx, stripMarker(first.prompt), { agent_id: agentId }))), `rule B, agent_id ${JSON.stringify(agentId)}`);
    assert.deepStrictEqual(gateEvents(fx.runDir).map((e) => e.reason), ['mismatch', 'missing-marker']);
  }
});

test('a marker on a later line is not a marker: the dispatcher gets rule B, another session is allowed', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const quoted = `Review this rendered prompt:\n\n${first.prompt}`;
  // The dispatching session S: no first-line marker, and the prompt names its bound run.
  const reason = denyReason(gate(ctxFor(fx, quoted)));
  assert.ok(reason, 'expected rule B to deny');
  assert.match(reason, /no dispatch-prompt\.js marker/);
  assert.deepStrictEqual(gateEvents(fx.runDir).map((e) => e.reason), ['missing-marker']);
  // A session that did not dispatch the run quotes the rendered prompt: allowed, no event.
  const fx2 = fixture();
  const first2 = render(fx2, 'first');
  assertAllowedNoEvent(gate(ctxFor(fx2, `Review this rendered prompt:\n\n${first2.prompt}`, { session_id: 'T' })), fx2);
  // Control: the same session T sending an edited prompt with the marker on line 1 is denied by rule A.
  assert.ok(denyReason(gate(ctxFor(fx2, editWord(first2.prompt), { session_id: 'T' }))));
});

test('rule B denies only a run-state carrying a string dispatchSessionId (pre-#3711 run-states fail open)', () => {
  const fx = fixture();
  const file = path.join(fx.runDir, 'run-state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(state.dispatched, true);
  assert.strictEqual(state.dispatchSessionId, 'S');
  assert.strictEqual(state.sessionId, 'S');
  // With dispatchSessionId: denied.
  assert.ok(denyReason(gate(ctxFor(fx, `resume run ${R}`))));
  // A pre-#3711 run-state: dispatched, sessionId S, no dispatchSessionId. isDispatchTaskCall alone
  // would fall back to sessionId and match S; this gate fails open instead.
  const fx2 = fixture();
  const file2 = path.join(fx2.runDir, 'run-state.json');
  const { dispatchSessionId, ...legacy } = JSON.parse(fs.readFileSync(file2, 'utf8'));
  assert.strictEqual(dispatchSessionId, 'S');
  fs.writeFileSync(file2, JSON.stringify(legacy));
  assertAllowedNoEvent(gate(ctxFor(fx2, `resume run ${R}`)), fx2);
  for (const value of [null, '', 7]) {
    fs.writeFileSync(file2, JSON.stringify({ ...legacy, dispatchSessionId: value }));
    assertAllowedNoEvent(gate(ctxFor(fx2, `resume run ${R}`)), fx2);
  }
  // Downstream isDispatchTaskCall still decides: dispatchSessionId S but `dispatched` not true.
  fs.writeFileSync(file2, JSON.stringify({ ...legacy, dispatchSessionId: 'S', dispatched: false }));
  assertAllowedNoEvent(gate(ctxFor(fx2, `resume run ${R}`)), fx2);
});

test('a load fault in dispatch-prompt-gate.js allows the Agent call and leaves the other gates working', () => {
  const Module = require('node:module');
  const fx = fixture();
  git(['-C', fx.project, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '--allow-empty', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(fx.project, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const first = render(fx, 'first');
  const editCtx = { cwd: fx.project, input: { tool_name: 'Edit', session_id: 'S', tool_input: { file_path: path.join(fx.project, 'a.txt') } } };
  // Controls with the real module: the Agent gate denies an edited prompt, the worktree gate denies the Edit.
  assert.ok(denyReason(ptu.run(ctxFor(fx, editWord(first.prompt)))));
  assert.match(denyReason(ptu.run(editCtx)) || '', /worktree-always/);

  const ptuPath = require.resolve('../plugin/bin/lib/hooks/pre-tool-use');
  const saved = require.cache[ptuPath];
  const origLoad = Module._load;
  let loads = 0;
  Module._load = function load(request, ...rest) {
    if (typeof request === 'string' && request.endsWith('dispatch-prompt-gate')) { loads += 1; throw new Error('load fault'); }
    return origLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[ptuPath];
    const fresh = require(ptuPath);
    const eventsBefore = gateEvents(fx.runDir).length;
    assert.deepStrictEqual(fresh.run(ctxFor(fx, editWord(first.prompt))), {});
    assert.ok(loads >= 1, 'the faulting require must have been attempted');
    assert.strictEqual(gateEvents(fx.runDir).length, eventsBefore);
    assert.match(denyReason(fresh.run(editCtx)) || '', /worktree-always/);
  } finally {
    Module._load = origLoad;
    require.cache[ptuPath] = saved;
  }
});

// ---- fail-open: every unprovable answer allows and writes no event ----

test('fail-open: a tool other than Agent/Task', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const deny = () => { throw new Error('deny must not be called'); };
  for (const toolName of ['Skill', 'Bash', 'SendMessage']) {
    assert.deepStrictEqual(checkDispatchPromptGate(ctxFor(fx, editWord(first.prompt), { tool_name: toolName }), {}, deny), {});
  }
  assert.deepStrictEqual(gateEvents(fx.runDir), []);
});

test('fail-open: tool_input.prompt is not a string', () => {
  const fx = fixture();
  for (const prompt of [undefined, null, 42, [`resume run ${R}`], { text: `resume run ${R}` }]) {
    assertAllowedNoEvent(gate(ctxFor(fx, prompt)), fx);
  }
  assertAllowedNoEvent(gate({ cwd: fx.project, input: { tool_name: 'Agent', session_id: 'S' } }), fx);
});

test('fail-open: a marker-less prompt with no session_id', () => {
  const fx = fixture();
  for (const sid of [undefined, '', null]) {
    assertAllowedNoEvent(gate(ctxFor(fx, `resume run ${R}`, { session_id: sid })), fx);
  }
});

test('fail-open: a marker-less prompt from another session (T, not the dispatcher S)', () => {
  const fx = fixture();
  assertAllowedNoEvent(gate(ctxFor(fx, `resume run ${R}`, { session_id: 'T' })), fx);
});

test('fail-open: a marker-less prompt naming a run whose run-state has no dispatched marker', () => {
  const fx = fixture({ dispatch: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fx.runDir, 'run-state.json'), 'utf8')).dispatched, undefined);
  assertAllowedNoEvent(gate(ctxFor(fx, `resume run ${R}`)), fx);
});

test('fail-open: a marker-less prompt naming a clean run', () => {
  const fx = fixture();
  const file = path.join(fx.runDir, 'run-state.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), status: 'clean' }));
  assertAllowedNoEvent(gate(ctxFor(fx, `resume run ${R}`)), fx);
});

test('fail-open: a marker-less prompt naming a run that exists only under pipelines/archive/', () => {
  const fx = fixture();
  const archived = path.join(fx.project, '.claude-tweaks', 'pipelines', 'archive', R);
  fs.mkdirSync(path.dirname(archived), { recursive: true });
  fs.renameSync(fx.runDir, archived);
  assert.deepStrictEqual(gate(ctxFor(fx, `resume run ${R}`)), {});
  assert.deepStrictEqual(gateEvents(archived), []);
});

test('fail-open: a marker-less prompt naming a run that exists only as a worktree-local shadow', () => {
  const fx = fixture();
  git(['-C', fx.project, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '--allow-empty', '-q', '-m', 'init']);
  const wt = path.join(mkTmp('ct-dpg-wt-'), 'wt');
  git(['-C', fx.project, 'worktree', 'add', '-q', wt, '-b', `wt-dpg-${path.basename(path.dirname(wt))}`]);
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', R);
  fs.mkdirSync(path.dirname(shadow), { recursive: true });
  fs.renameSync(fx.runDir, shadow);
  assert.deepStrictEqual(gate(ctxFor({ ...fx, cwd: wt }, `resume run ${R}`)), {});
  assert.deepStrictEqual(gateEvents(shadow), []);
});

test('fail-open: a marker-less prompt naming no run', () => {
  const fx = fixture();
  assertAllowedNoEvent(gate(ctxFor(fx, 'Summarize the open review comments on PR #12.')), fx);
});

test('fail-open: mainCheckoutRoot returns null (both rules)', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const deps = { mainCheckoutRoot: () => null };
  assertAllowedNoEvent(gate(ctxFor(fx, editWord(first.prompt)), deps), fx);
  assertAllowedNoEvent(gate(ctxFor(fx, stripMarker(first.prompt)), deps), fx);
});

test('fail-open: mainCheckoutRoot throws (both rules)', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const deps = { mainCheckoutRoot: () => { throw new Error('git unavailable'); } };
  assertAllowedNoEvent(gate(ctxFor(fx, editWord(first.prompt)), deps), fx);
  assertAllowedNoEvent(gate(ctxFor(fx, stripMarker(first.prompt)), deps), fx);
});

test('fail-open: a main checkout with no .claude-tweaks/pipelines (both rules)', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const bare = mkTmp('ct-dpg-bare-');
  assert.strictEqual(fs.readdirSync(bare).length, 0);
  const deps = { mainCheckoutRoot: () => bare };
  assertAllowedNoEvent(gate(ctxFor(fx, editWord(first.prompt)), deps), fx);
  assertAllowedNoEvent(gate(ctxFor(fx, stripMarker(first.prompt)), deps), fx);
});

test('fail-open: a marker run entry that is a file, not a directory', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const fileRun = '2026-11-01T181355-record-4589';
  fs.writeFileSync(path.join(fx.project, '.claude-tweaks', 'pipelines', fileRun), 'not a dir');
  const body = editWord(first.prompt).replace(/^\[dispatch-prompt: \S+ first\]/, `[dispatch-prompt: ${fileRun} first]`);
  assertAllowedNoEvent(gate(ctxFor(fx, body)), fx);
});

test('fail-open: deny is not a function', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  for (const deny of [undefined, null, 'deny', {}]) {
    assert.deepStrictEqual(checkDispatchPromptGate(ctxFor(fx, editWord(first.prompt)), {}, deny), {});
    assert.deepStrictEqual(checkDispatchPromptGate(ctxFor(fx, stripMarker(first.prompt)), {}, deny), {});
  }
  assert.deepStrictEqual(gateEvents(fx.runDir), []);
});

test('fail-open: rule B never follows a symlinked or file run entry', () => {
  const fx = fixture();
  const pipes = path.join(fx.project, '.claude-tweaks', 'pipelines');
  // A real bound run outside the pipelines dir, reached through a symlinked entry.
  const linked = '2026-11-01T181356-record-4589';
  const outside = path.join(mkTmp('ct-dpg-linkrun-'), linked);
  fs.mkdirSync(outside);
  fs.copyFileSync(path.join(fx.runDir, 'run-state.json'), path.join(outside, 'run-state.json'));
  // Control: the copied run-state, read in place under pipelines/, is a bound run rule B denies.
  const direct = path.join(pipes, '2026-11-01T181357-record-4589');
  fs.mkdirSync(direct);
  fs.copyFileSync(path.join(fx.runDir, 'run-state.json'), path.join(direct, 'run-state.json'));
  assert.ok(denyReason(gate(ctxFor(fx, `resume run ${path.basename(direct)}`))));
  fs.symlinkSync(outside, path.join(pipes, linked), 'dir');
  assert.deepStrictEqual(gate(ctxFor(fx, `resume run ${linked}`)), {});
  assert.deepStrictEqual(gateEvents(outside), []);
  // A file entry named in the prompt.
  const fileRun = '2026-11-01T181358-record-4589';
  fs.writeFileSync(path.join(pipes, fileRun), '{}');
  assert.deepStrictEqual(gate(ctxFor(fx, `resume run ${fileRun}`)), {});
  // A real directory entry with no run-state.json: the lstat check passes it, readRunState reads nothing.
  const noState = '2026-11-01T181359-record-4589';
  fs.mkdirSync(path.join(pipes, noState));
  assert.deepStrictEqual(gate(ctxFor(fx, `resume run ${noState}`)), {});
  assert.deepStrictEqual(gateEvents(path.join(pipes, noState)), []);
});

test('fail-open: the pipelines readdirSync throws EACCES', () => {
  const fx = fixture();
  const deps = { fsImpl: fsWith({ readdirSync: (p) => eacces(p) }) };
  assertAllowedNoEvent(gate(ctxFor(fx, `resume run ${R}`), deps), fx);
});

test('fail-open: a marker run id that fails RUN_ID_RE', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const body = editWord(first.prompt).replace(/^\[dispatch-prompt: \S+ first\]/, '[dispatch-prompt: ../x first]');
  // A sibling of pipelines/ holding a mismatching registry: RUN_ID_RE refuses it, and the dirname check behind it would too.
  const sibling = path.join(fx.project, '.claude-tweaks', 'x');
  fs.mkdirSync(sibling, { recursive: true });
  fs.copyFileSync(path.join(fx.runDir, REGISTRY_FILE), path.join(sibling, REGISTRY_FILE));
  assertAllowedNoEvent(gate(ctxFor(fx, body)), fx);
  // A direct child of pipelines/ whose name is not a run id: only RUN_ID_RE stops this one.
  const notRun = path.join(fx.project, '.claude-tweaks', 'pipelines', 'notarun');
  fs.mkdirSync(notRun);
  fs.copyFileSync(path.join(fx.runDir, REGISTRY_FILE), path.join(notRun, REGISTRY_FILE));
  const body2 = editWord(first.prompt).replace(/^\[dispatch-prompt: \S+ first\]/, '[dispatch-prompt: notarun first]');
  assertAllowedNoEvent(gate(ctxFor(fx, body2)), fx);
  assert.deepStrictEqual(gateEvents(notRun), []);
});

test('fail-open: a marker run id with no dir under main', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const body = first.prompt.replace(/^\[dispatch-prompt: \S+ first\]/, '[dispatch-prompt: 2026-11-01T000000-record-9999 first]');
  assertAllowedNoEvent(gate(ctxFor(fx, body)), fx);
});

test('fail-open: a marker run dir that is a symlink out of the pipelines dir', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const pipes = path.join(fx.project, '.claude-tweaks', 'pipelines');
  const linked = '2026-11-01T181354-record-4589';
  const body = editWord(first.prompt).replace(/^\[dispatch-prompt: \S+ first\]/, `[dispatch-prompt: ${linked} first]`);
  // Outside the checkout entirely.
  const outside = path.join(mkTmp('ct-dpg-outside-'), linked);
  fs.mkdirSync(outside);
  fs.copyFileSync(path.join(fx.runDir, REGISTRY_FILE), path.join(outside, REGISTRY_FILE));
  fs.symlinkSync(outside, path.join(pipes, linked), 'dir');
  assertAllowedNoEvent(gate(ctxFor(fx, body)), fx);
  assert.deepStrictEqual(gateEvents(outside), []);
  // Nested inside pipelines/ (archive/), so not a direct child: only the dirname check stops this one.
  fs.unlinkSync(path.join(pipes, linked));
  const nested = path.join(pipes, 'archive', linked);
  fs.mkdirSync(nested, { recursive: true });
  fs.copyFileSync(path.join(fx.runDir, REGISTRY_FILE), path.join(nested, REGISTRY_FILE));
  fs.symlinkSync(nested, path.join(pipes, linked), 'dir');
  assertAllowedNoEvent(gate(ctxFor(fx, body)), fx);
  assert.deepStrictEqual(gateEvents(nested), []);
});

test('fail-open: the registry read throws EACCES', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const deps = {
    fsImpl: fsWith({
      readFileSync: (p, ...rest) => (String(p).endsWith(REGISTRY_FILE) ? eacces(p) : fs.readFileSync(p, ...rest)),
    }),
  };
  assertAllowedNoEvent(gate(ctxFor(fx, editWord(first.prompt)), deps), fx);
});

test('fail-open: deps.loadTaskPrompt throws', () => {
  const fx = fixture();
  const first = render(fx, 'first');
  const deps = { loadTaskPrompt: () => { throw new Error('load fault'); } };
  assertAllowedNoEvent(gate(ctxFor(fx, editWord(first.prompt)), deps), fx);
  assertAllowedNoEvent(gate(ctxFor(fx, stripMarker(first.prompt)), deps), fx);
});

// ---- routes: every prose route into an Agent prompt that names a run is ruled ----

const FLOW_ROUTE_RE = 'PIPELINE_RUN_DIR="[^"]*"[^`]{0,80}/claude-tweaks:flow';

test('routes: every skill line that runs /claude-tweaks:flow with a PIPELINE_RUN_DIR prefix is ruled', () => {
  const RULED = {
    // Rendered by bin/dispatch-prompt.js, which writes the marker line: rule (A) checks it.
    'plugin/skills/dispatch/task-prompt.md': 'rendered',
    // Step 5's illustrative lines; the text actually dispatched is the rendered file.
    'plugin/skills/dispatch/SKILL.md': 'illustrative',
    // Each runs as a slash/Skill invocation in the session itself, never as an Agent prompt.
    'plugin/skills/_shared/auto-mode-contract.md': 'skill-invocation',
    'plugin/skills/_shared/pr-early-run-lifecycle.md': 'skill-invocation',
    'plugin/skills/build/execution-mode-policy.md': 'skill-invocation',
    'plugin/skills/dispatch/resume-confirmation.md': 'skill-invocation',
    'plugin/skills/dispatch/settle-parked.md': 'skill-invocation',
    'plugin/skills/flow/SKILL.md': 'skill-invocation',
    'plugin/skills/flow/claim-targets.md': 'skill-invocation',
    'plugin/skills/flow/multi-spec.md': 'skill-invocation',
    'plugin/skills/flow/multispec-review-console.md': 'skill-invocation',
    'plugin/skills/flow/steps-and-gates.md': 'skill-invocation',
    'plugin/skills/flow/summary-template.md': 'skill-invocation',
    'plugin/skills/tidy/step-6-auto.md': 'skill-invocation',
    'plugin/skills/wrap-up/resume-halted-run.md': 'skill-invocation',
  };
  const out = execFileSync('git', ['-C', REPO, 'grep', '-n', '-E', FLOW_ROUTE_RE, '--', 'plugin/skills'], { windowsHide: true, encoding: 'utf8' });
  const found = [...new Set(out.split('\n').filter(Boolean).map((l) => l.slice(0, l.indexOf(':'))))].sort();
  assert.deepStrictEqual(found, Object.keys(RULED).sort(),
    're-rule the routes: a skill line that runs /claude-tweaks:flow with a PIPELINE_RUN_DIR prefix was added or removed');

  // Go-red control: the same matcher finds a planted line.
  const dir = mkTmp('ct-dpg-route-');
  fs.writeFileSync(path.join(dir, 'planted.md'), 'Run PIPELINE_RUN_DIR="x" /claude-tweaks:flow #1 now.\n');
  const planted = execFileSync('git', ['grep', '--no-index', '-n', '-E', FLOW_ROUTE_RE, '--', 'planted.md'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
  assert.strictEqual(planted.split('\n').filter(Boolean).length, 1);
});

test('routes: every fenced Agent template under dispatch/ is ruled', () => {
  // task-prompt.md: the first and second calls, rendered by the CLI with the marker.
  // express-prompt.md: the express call, whose run Step 5 binds WITHOUT --dispatch, and the
  // post-merge sample review call, whose sampling run dir is never bound with --dispatch — neither
  // is a bound run, so rule (B) never denies either marker-less prompt. An escalated express run is
  // re-bound with --dispatch and then sends the ordinary rendered first call.
  const RULED = { 'express-prompt.md': 2, 'task-prompt.md': 2 };
  const root = path.join(REPO, 'plugin', 'skills', 'dispatch');
  const found = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const lines = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n');
      let open = false;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('```')) continue;
        if (!open && (lines[i + 1] || '').startsWith('Task scope:')) {
          const rel = path.relative(root, p).split(path.sep).join('/');
          found[rel] = (found[rel] || 0) + 1;
        }
        open = !open;
      }
    }
  };
  walk(root);
  assert.deepStrictEqual(found, RULED, 're-rule the routes: a fenced Task scope template under dispatch/ was added or removed');
});
