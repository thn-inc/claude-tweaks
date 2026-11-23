'use strict';
// #6143: the PreToolUse in-flight PR gate on Bash `gh pr ready|merge` (bin/lib/hooks/inflight-pr-gate.js).
// Fixtures use the real writers: run-state.json comes from `hooks.js record-worktree` (and `close-run`),
// the PR body from pr-body.js's composePrEarlyBody, and every phase-exit line from log-decision's
// formatEntry + appendEntry under PHASE_SECTIONS[phase]. Every case goes through pre-tool-use.js's
// run(), so runInner's wiring and denyResult are the path under test. `deps.readPrBody` stands in
// for `gh pr view` except in the default-runner cases, which put a stub `gh` on the passed env's PATH.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { cleanGitEnv } = require('./helpers/git-fixtures');
const { runCli } = require('./helpers/run-cli');
const { composePrEarlyBody, composeExpressBody } = require('../plugin/bin/lib/flow/pr-body');
const { setPhaseRow } = require('../plugin/bin/lib/flow/pr-checklist');
const { formatEntry, appendEntry } = require('../plugin/bin/lib/log-decision/append');
const { PHASE_SECTIONS } = require('../plugin/bin/pr-merge-state');
const { PHASE_EXIT_STEP, phaseExitText } = require('../plugin/bin/lib/phase-exit/exit-record');
const ptu = require('../plugin/bin/lib/hooks/pre-tool-use');

process.env.CT_HOOKS_TEST_MODE = '1';

const REPO = path.join(__dirname, '..');
const HOOKS = path.join(REPO, 'plugin', 'bin', 'hooks.js');
const R = '2026-11-23T162803-record-6143';
const GATE = 'inflight-pr';
const NOW = '2026-11-23T17:00:00.000Z';

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

async function hooksVerb(project, args, session) {
  const res = await runCli(HOOKS, args, {
    cwd: project,
    env: { ...cleanGitEnv(), CLAUDE_CODE_SESSION_ID: session, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' },
  });
  assert.strictEqual(res.code, 0, res.stderr);
  return res;
}

const recordWorktree = (project, runDir, { session = 'S', dispatch = false } = {}) =>
  hooksVerb(project, ['record-worktree', '--run', runDir, '/tmp/wt-6143', ...(dispatch ? ['--dispatch'] : [])], session);

function logLine(runDir, { section, step, text, spec }) {
  const dir = spec ? path.join(runDir, `spec-${spec}`) : runDir;
  fs.mkdirSync(dir, { recursive: true });
  appendEntry({ runDir: dir, section, entry: formatEntry({ status: 'AUTO', now: NOW, step, text }) });
}

function logPhaseExit(runDir, phase, spec) {
  logLine(runDir, { section: PHASE_SECTIONS[phase], step: PHASE_EXIT_STEP, text: phaseExitText(phase, 'abc1234'), spec });
}

// A temp main checkout with pipelines/R recorded by the real writer from session S, and a
// decisions.md holding one unrelated entry (readRunDecisions throws on a missing parent file).
async function fixture({ record = true } = {}) {
  const project = mkTmp('ct-ipg-');
  git(['-C', project, 'init', '-q']);
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', R);
  fs.mkdirSync(runDir, { recursive: true });
  if (record) await recordWorktree(project, runDir);
  logLine(runDir, { section: '/flow', step: 'Claim', text: 'claimed #6143' });
  return { project, runDir };
}

const bodyFor = (fx, { check = [], runId = R } = {}) => {
  let body = composePrEarlyBody({
    runId, specSummary: 'in-flight gate', target: '#6143', nextStep: 'build',
    fixesLines: ['Fixes #6143'], runDir: path.join(path.dirname(fx.runDir), runId),
  });
  for (const phase of check) body = setPhaseRow({ body, phase }).body;
  return body;
};

const ctxFor = (fx, command, over = {}, env = process.env) => ({
  env,
  cwd: fx.project,
  input: { tool_name: 'Bash', session_id: 'OTHER', tool_input: { command }, ...over },
});

// A readPrBody seam that records every call it is handed.
function reader(body, number = 123) {
  const calls = [];
  const fn = (call) => { calls.push({ call, cwd: call.cwd }); return body === null ? null : { body, number }; };
  fn.calls = calls;
  return fn;
}

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
const assertAllowedNoEvent = (out, fx) => {
  assert.deepStrictEqual(out, {});
  assert.deepStrictEqual(gateEvents(fx.runDir), []);
};
const MERGE = 'gh pr merge 123 --squash';
const READY = 'gh pr ready 123';

// ---- AC1 / AC2: the merge and ready verbs ----

for (const [label, command] of [['AC1.1: gh pr merge 123 --squash', MERGE], ['AC2.1: gh pr ready 123', READY]]) {
  test(`${label} on an active run with build unchecked is denied`, async () => {
    const fx = await fixture();
    const read = reader(bodyFor(fx));
    const out = gate(ctxFor(fx, command), { readPrBody: read });
    const reason = denyReason(out);
    assert.ok(reason, 'expected a deny');
    assert.strictEqual(out.exit, 0);
    assert.ok(reason.includes(`PR #123 is the draft PR of pipeline run ${R}`), reason);
    assert.ok(reason.includes('(build phase not finished)'), reason);
    assert.ok(reason.includes('owned by session S.'), reason);
    assert.ok(reason.includes('/claude-tweaks:wrap-up #6143 cleanup-only'), reason);
    const ev = gateEvents(fx.runDir);
    assert.strictEqual(ev.length, 1);
    assert.strictEqual(ev[0].type, 'gate-denial');
    assert.strictEqual(ev[0].tool, 'Bash');
    assert.strictEqual(ev[0].pr, 123);
    assert.strictEqual(ev[0].phase, 'build');
    assert.strictEqual(ev[0].test, true);
    assert.deepStrictEqual(read.calls.map((c) => c.call.selector), ['123']);
  });

  test(`${label} from the owning session is allowed`, async () => {
    const fx = await fixture();
    const read = reader(bodyFor(fx));
    assertAllowedNoEvent(gate(ctxFor(fx, command, { session_id: 'S' }), { readPrBody: read }), fx);
  });

  test(`${label} on an unreadable PR is allowed`, async () => {
    const fx = await fixture();
    const read = reader(null);
    assertAllowedNoEvent(gate(ctxFor(fx, command), { readPrBody: read }), fx);
    assert.strictEqual(read.calls.length, 1);
  });
}

test('AC1.2: a caller matching only dispatchSessionId is denied', async () => {
  // Dispatched by D, then re-recorded by S (a resumer): sessionId S, dispatchSessionId D.
  const fx = await fixture({ record: false });
  await recordWorktree(fx.project, fx.runDir, { session: 'D', dispatch: true });
  await recordWorktree(fx.project, fx.runDir, { session: 'S' });
  const state = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'run-state.json'), 'utf8'));
  assert.strictEqual(state.sessionId, 'S');
  assert.strictEqual(state.dispatchSessionId, 'D');
  const reason = denyReason(gate(ctxFor(fx, MERGE, { session_id: 'D' }), { readPrBody: reader(bodyFor(fx)) }));
  assert.ok(reason, 'dispatchSessionId is not an owner');
  assert.ok(reason.includes('owned by session S.'), reason);
});

// ---- AC1.3: the default gh runner ----

function stubGh({ exit, json }) {
  const bin = mkTmp('ct-ipg-bin-');
  const argvFile = path.join(bin, 'argv.txt');
  const jsonFile = path.join(bin, 'out.json');
  if (json) fs.writeFileSync(jsonFile, JSON.stringify(json));
  fs.writeFileSync(path.join(bin, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvFile}"\n${json ? `cat "${jsonFile}"\n` : ''}exit ${exit}\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  delete env.GH_HOST;
  return { env, argv: () => fs.readFileSync(argvFile, 'utf8').split('\n').filter(Boolean) };
}

const skipWin = process.platform === 'win32' ? 'stub gh is a POSIX shell script' : false;

test('AC1.3: the default runner, a gh that exits 1, is allowed', { skip: skipWin }, async () => {
  const fx = await fixture();
  const gh = stubGh({ exit: 1 });
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE, {}, gh.env)), fx);
  assert.deepStrictEqual(gh.argv(), ['pr', 'view', '--json', 'body,number', '--', '123']);
});

test('AC1.3: the default runner reads the body and number gh prints', { skip: skipWin }, async () => {
  const fx = await fixture();
  const gh = stubGh({ exit: 0, json: { body: bodyFor(fx), number: 77 } });
  const reason = denyReason(gate(ctxFor(fx, 'gh pr merge -R o/r 77', {}, gh.env)));
  assert.ok(reason && reason.includes('PR #77 is the draft PR'), reason);
  assert.deepStrictEqual(gh.argv(), ['pr', 'view', '--json', 'body,number', '--repo', 'o/r', '--', '77']);
});

test('AC1.3: the default runner passes no --repo for an empty -R= and no selector when none is given', { skip: skipWin }, async () => {
  const fx = await fixture();
  const gh = stubGh({ exit: 1 });
  assertAllowedNoEvent(gate(ctxFor(fx, 'gh pr merge -R= --squash', {}, gh.env)), fx);
  assert.deepStrictEqual(gh.argv(), ['pr', 'view', '--json', 'body,number']);
});

// ---- AC3: no owner, and the phase-exit record ----

test('AC3.1: a run whose run-state has no sessionId is allowed', async () => {
  const fx = await fixture({ record: false });
  // The one hand-written run-state shape: every real writer stamps sessionId when the session has one.
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/tmp/wt-6143', status: 'active' }));
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx)) }), fx);
});

test('AC3.2: build and test unchecked but both phase exits recorded is allowed', async () => {
  const fx = await fixture();
  logPhaseExit(fx.runDir, 'build');
  logPhaseExit(fx.runDir, 'test');
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx)) }), fx);
});

test('test unchecked with build checked and no test exit is denied', async () => {
  const fx = await fixture();
  logPhaseExit(fx.runDir, 'build');
  const reason = denyReason(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx, { check: ['build'] })) }));
  assert.ok(reason && reason.includes('(test phase not finished)'), reason);
  assert.strictEqual(gateEvents(fx.runDir)[0].phase, 'test');
});

test('both rows checked is allowed', async () => {
  const fx = await fixture();
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx, { check: ['build', 'test'] })) }), fx);
});

test('an express body (no phases span) is allowed', async () => {
  const fx = await fixture();
  const body = composeExpressBody({ runId: R, specSummary: 'x', fixesLines: ['Fixes #6143'] });
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(body) }), fx);
});

test('a run-state closed clean by the real close-run writer is allowed', async () => {
  const fx = await fixture();
  await hooksVerb(fx.project, ['close-run', '--run', fx.runDir], 'S');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fx.runDir, 'run-state.json'), 'utf8')).status, 'clean');
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx)) }), fx);
});

test('an unreadable decisions.md with build unchecked is allowed', async () => {
  const fx = await fixture();
  const readDecisions = () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; };
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx)), readDecisions }), fx);
  // The default reader, on a run with no decisions.md at all.
  fs.rmSync(path.join(fx.runDir, 'decisions.md'));
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx)) }), fx);
});

test('a multi-spec run whose exits are recorded only in spec-1/decisions.md is allowed', async () => {
  const fx = await fixture();
  logPhaseExit(fx.runDir, 'build', 1);
  logPhaseExit(fx.runDir, 'test', 1);
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx)) }), fx);
});

// ---- the marker and the run it names ----

test('a marker on line 2 only is allowed', async () => {
  const fx = await fixture();
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(`intro\n${bodyFor(fx)}`) }), fx);
});

test('a marker naming a missing run, ../x, or a symlinked run dir is allowed', async () => {
  const fx = await fixture();
  const missing = '2026-11-23T162804-record-6143';
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx, { runId: missing })) }), fx);
  const dotdot = bodyFor(fx).split(R).join('../x');
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(dotdot) }), fx);
  // A real in-flight run outside the pipelines dir, reached through a symlinked entry.
  const linked = '2026-11-23T162805-record-6143';
  const outside = path.join(mkTmp('ct-ipg-outside-'), linked);
  fs.cpSync(fx.runDir, outside, { recursive: true });
  fs.symlinkSync(outside, path.join(path.dirname(fx.runDir), linked), 'dir');
  assertAllowedNoEvent(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx, { runId: linked })) }), fx);
  assert.deepStrictEqual(gateEvents(outside), []);
  // Control: the same body naming the real run dir is denied.
  assert.ok(denyReason(gate(ctxFor(fx, MERGE), { readPrBody: reader(bodyFor(fx)) })));
});

// ---- the calls the parser hands the gate ----

test('gh pr ready --undo 123 is allowed without reading the PR', async () => {
  const fx = await fixture();
  const read = reader(bodyFor(fx));
  assertAllowedNoEvent(gate(ctxFor(fx, 'gh pr ready --undo 123'), { readPrBody: read }), fx);
  assert.strictEqual(read.calls.length, 0);
});

test('a cd into the run\'s own checkout, spelled differently, is judged from that cwd and denied', async () => {
  const fx = await fixture();
  // The session sits outside any repo; the gh call runs from a symlinked spelling of the checkout.
  const away = mkTmp('ct-ipg-away-');
  const link = path.join(mkTmp('ct-ipg-link-'), 'checkout');
  fs.symlinkSync(fx.project, link, 'dir');
  const read = reader(bodyFor(fx));
  const ctx = { ...ctxFor(fx, `cd ${link} && gh pr merge 5`), cwd: away };
  const reason = denyReason(gate(ctx, { readPrBody: read }));
  assert.ok(reason && reason.includes(`pipeline run ${R}`), reason);
  assert.deepStrictEqual(read.calls.map((c) => c.cwd), [link]);
  assert.strictEqual(gateEvents(fx.runDir).length, 1);
});

test('a cd into a directory that is not a git checkout is allowed without reading the PR', async () => {
  const fx = await fixture();
  const read = reader(bodyFor(fx));
  assertAllowedNoEvent(gate(ctxFor(fx, `cd ${mkTmp('ct-ipg-norepo-')} && gh pr merge 5`), { readPrBody: read }), fx);
  assert.strictEqual(read.calls.length, 0);
});

test('a lost cwd is skipped without reading the PR', async () => {
  const fx = await fixture();
  const read = reader(bodyFor(fx));
  // The parser's stand-in for `cd $X` is the session's own cwd, the run's checkout: only `lost` skips it.
  assertAllowedNoEvent(gate(ctxFor(fx, 'cd $X && gh pr merge 5'), { readPrBody: read }), fx);
  assert.strictEqual(read.calls.length, 0);
});

test('a Bash call with no gh pr ready/merge loads none of the PR, run or gh modules', async () => {
  const fx = await fixture();
  const lazyMods = [
    '../plugin/bin/lib/hooks/inflight-pr-gate', '../plugin/bin/lib/hooks/named-run',
    '../plugin/bin/lib/flow/pr-checklist', '../plugin/bin/lib/flow/pr-body', '../plugin/bin/lib/flow/inflight-run',
    '../plugin/bin/lib/phase-exit/exit-record', '../plugin/bin/pr-merge-state',
  ].map((m) => require.resolve(m));
  const saved = new Map(lazyMods.map((f) => [f, require.cache[f]]));
  try {
    for (const f of lazyMods) delete require.cache[f];
    assert.deepStrictEqual(gate(ctxFor(fx, 'git status && echo gh pr view 5')), {});
    assert.ok(require.cache[lazyMods[0]], 'the gate module itself must have loaded');
    assert.deepStrictEqual(lazyMods.slice(1).filter((f) => require.cache[f]), []);
    // Control: a gh pr merge call loads them.
    gate(ctxFor(fx, 'gh pr merge 5'), { readPrBody: reader(null) });
    assert.deepStrictEqual(lazyMods.filter((f) => !require.cache[f]), []);
  } finally {
    for (const [f, mod] of saved) {
      if (mod) require.cache[f] = mod; else delete require.cache[f];
    }
  }
});

test('a selector-less gh pr merge --squash reads the PR with selector null', async () => {
  const fx = await fixture();
  const read = reader(bodyFor(fx));
  assert.ok(denyReason(gate(ctxFor(fx, 'gh pr merge --squash'), { readPrBody: read })));
  assert.strictEqual(read.calls.length, 1);
  assert.strictEqual(read.calls[0].call.selector, null);
  assert.strictEqual(read.calls[0].cwd, fx.project);
});

test('-R o/r 5 reads the PR with repo o/r; an empty -R= reads it with repo null', async () => {
  const fx = await fixture();
  const read = reader(bodyFor(fx));
  gate(ctxFor(fx, 'gh pr merge -R o/r 5'), { readPrBody: read });
  gate(ctxFor(fx, 'gh pr merge -R= 5'), { readPrBody: read });
  assert.deepStrictEqual(read.calls.map((c) => [c.call.repo, c.call.selector]), [['o/r', '5'], [null, '5']]);
});

test('a load fault in inflight-pr-gate.js allows the Bash call and leaves the other gates working', async () => {
  const Module = require('node:module');
  const fx = await fixture();
  git(['-C', fx.project, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '--allow-empty', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(fx.project, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const editCtx = { env: process.env, cwd: fx.project, input: { tool_name: 'Edit', session_id: 'S', tool_input: { file_path: path.join(fx.project, 'a.txt') } } };
  const read = reader(bodyFor(fx));
  // Controls with the real module: the gate denies the merge, the worktree gate denies the Edit.
  assert.ok(denyReason(ptu.run(ctxFor(fx, MERGE), { readPrBody: read })));
  assert.match(denyReason(ptu.run(editCtx)) || '', /worktree-always/);

  const ptuPath = require.resolve('../plugin/bin/lib/hooks/pre-tool-use');
  const saved = require.cache[ptuPath];
  const origLoad = Module._load;
  let loads = 0;
  Module._load = function load(request, ...rest) {
    if (typeof request === 'string' && request.endsWith('inflight-pr-gate')) { loads += 1; throw new Error('load fault'); }
    return origLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[ptuPath];
    const fresh = require(ptuPath);
    const eventsBefore = gateEvents(fx.runDir).length;
    assert.deepStrictEqual(fresh.run(ctxFor(fx, MERGE), { readPrBody: read }), {});
    assert.ok(loads >= 1, 'the faulting require must have been attempted');
    assert.strictEqual(gateEvents(fx.runDir).length, eventsBefore);
    assert.match(denyReason(fresh.run(editCtx)) || '', /worktree-always/);
  } finally {
    Module._load = origLoad;
    require.cache[ptuPath] = saved;
  }
});
