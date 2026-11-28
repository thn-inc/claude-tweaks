// tests/skill-invocation.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { hookEnv, runHookCli } = require('./helpers/hook-event');

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory, and
// when npm test runs from a real checkout, hooks that walk
// .claude-tweaks/pipelines/ from there write fixture events into REAL run
// dirs (the #657 pollution incident). Calls that don't care about cwd get an
// isolated, non-git sandbox instead.
const HOOK_SANDBOX = scratchDir('ct-skillinv-sandbox-');

// #5377: runs hooks.js in-process through runHookCli. hookEnv blanks PIPELINE_RUN_DIR so an ambient
// value in the invoking shell can't redirect fixture writes into a real run's events.jsonl —
// resolveRun checks this env var before the cwd scan.
async function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  const { code, stdout } = await runHookCli(args, { input, cwd, env: hookEnv(env) });
  return { code, stdout };
}

// Project with one active run; sessionId optional (absent = unowned run).
function projectWithRun({ sessionId } = {}) {
  const dir = scratchDir('ct-skill-');
  const run = path.join(dir, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  const state = { status: 'active' };
  if (sessionId) state.sessionId = sessionId;
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return { dir, run };
}

// Synthetic payload matching the Task-0-pinned shape: tool_input.skill is a
// plain string (bare or "namespace:skill"-qualified); success responses carry
// tool_response.success === true / commandName (see task0-findings.md).
function skillPayload(overrides = {}) {
  return JSON.stringify({
    tool_name: 'Skill',
    tool_input: { skill: 'claude-tweaks:wrap-up' },
    tool_response: { success: true, commandName: 'claude-tweaks:wrap-up' },
    ...overrides,
  });
}

function readEvents(run) {
  const p = path.join(run, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('owned run: appends exactly one skill_invoked event with verbatim name and ISO ts', async () => {
  const { dir, run } = projectWithRun({ sessionId: 'owner' });
  const r = await runHook(['post-tool-use'], {
    input: skillPayload({ cwd: dir, session_id: 'owner' }), cwd: dir,
  });
  assert.strictEqual(r.code, 0);
  const events = readEvents(run);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'skill_invoked');
  assert.strictEqual(events[0].skill, 'claude-tweaks:wrap-up');
  assert.match(events[0].ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!('attribution' in events[0]), 'owned run must not be tagged fallback');
});

test('unowned run: appends one event tagged attribution fallback', async () => {
  const { dir, run } = projectWithRun();
  const r = await runHook(['post-tool-use'], {
    input: skillPayload({ cwd: dir, session_id: 'some-session' }), cwd: dir,
  });
  assert.strictEqual(r.code, 0);
  const events = readEvents(run);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'skill_invoked');
  assert.strictEqual(events[0].attribution, 'fallback');
});

test('no resolvable run: exits 0, creates no file and no directory (pipelines dir absent)', async () => {
  const bare = scratchDir('ct-skill-bare-');
  const r = await runHook(['post-tool-use'], { input: skillPayload({ cwd: bare }), cwd: bare });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(fs.existsSync(path.join(bare, '.claude-tweaks')), false,
    'no .claude-tweaks tree may be created');
});

test('no resolvable run: existing-but-unmatched pipelines dir is byte-identical before/after', async () => {
  const dir = scratchDir('ct-skill-');
  const pipelines = path.join(dir, '.claude-tweaks', 'pipelines');
  // Only a terminal (clean) run exists -> resolveRun finds no non-terminal run.
  const run = path.join(pipelines, '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  const before = JSON.stringify(fs.readdirSync(run).sort());
  const r = await runHook(['post-tool-use'], { input: skillPayload({ cwd: dir }), cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(JSON.stringify(fs.readdirSync(run).sort()), before);
  assert.strictEqual(fs.existsSync(path.join(run, 'events.jsonl')), false);
});

test('foreign-owned run: exits 0, appends nothing', async () => {
  const { dir, run } = projectWithRun({ sessionId: 'owner' });
  const r = await runHook(['post-tool-use'], {
    input: skillPayload({ cwd: dir, session_id: 'bystander' }), cwd: dir,
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(readEvents(run).length, 0);
});

// Task 0 measured that a failed ("unknown skill") call fires NO PostToolUse
// event at all — there is no error field in tool_response to pin. isFailedCall
// is kept only as a minimal defensive guard (success === false OR is_error ===
// true) against a future harness change; neither shape is known to occur
// today. Both synthetic shapes must still drop if ever encountered.
test('failed call (defensive guard, not observed to occur today): no write', async () => {
  for (const toolResponse of [{ success: false }, { is_error: true }]) {
    const { dir, run } = projectWithRun({ sessionId: 'owner' });
    const r = await runHook(['post-tool-use'], {
      input: skillPayload({ cwd: dir, session_id: 'owner', tool_response: toolResponse }),
      cwd: dir,
    });
    assert.strictEqual(r.code, 0, `tool_response ${JSON.stringify(toolResponse)} must exit 0`);
    assert.strictEqual(readEvents(run).length, 0, `tool_response ${JSON.stringify(toolResponse)} must not append`);
  }
});

test('missing, empty, and non-string skill field: no write, exit 0', async () => {
  for (const toolInput of [{}, { skill: '' }, { skill: 42 }, null]) {
    const { dir, run } = projectWithRun({ sessionId: 'owner' });
    const r = await runHook(['post-tool-use'], {
      input: skillPayload({ cwd: dir, session_id: 'owner', tool_input: toolInput }), cwd: dir,
    });
    assert.strictEqual(r.code, 0, `tool_input ${JSON.stringify(toolInput)} must exit 0`);
    assert.strictEqual(readEvents(run).length, 0);
  }
});

test('real captured payload from Task 0 appends against an owned run', async () => {
  // Scenario (a) raw JSON line from task0-findings.md, pasted verbatim, with
  // cwd/session_id overridden to point at the fixture project.
  const raw = JSON.parse('{"session_id":"35041dba-0268-4aa8-ad14-f2adde5770be","transcript_path":"/Users/thomasholknielsen/.claude-accounts/memenu/projects/-private-tmp-skill-capture-371/35041dba-0268-4aa8-ad14-f2adde5770be.jsonl","cwd":"/private/tmp/skill-capture-371","prompt_id":"c7a57d91-ee92-42f0-bde3-e221a478aec5","permission_mode":"bypassPermissions","effort":{"level":"high"},"hook_event_name":"PostToolUse","tool_name":"Skill","tool_input":{"skill":"claude-tweaks:help"},"tool_response":{"success":true,"commandName":"claude-tweaks:help"},"tool_use_id":"toolu_01VrDhrpt9vX3Fhi2Bs1RhdH","duration_ms":7}');
  const { dir, run } = projectWithRun({ sessionId: 'owner' });
  raw.cwd = dir;
  raw.session_id = 'owner';
  const r = await runHook(['post-tool-use'], { input: JSON.stringify(raw), cwd: dir });
  assert.strictEqual(r.code, 0);
  const events = readEvents(run);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'skill_invoked');
  assert.strictEqual(events[0].skill, 'claude-tweaks:help');
});

test('subagent-attributed payload (agent_id/agent_type) is logged like any other — no filtering', async () => {
  // Scenario (d) raw JSON line from task0-findings.md, pasted verbatim, with
  // cwd/session_id overridden to point at the fixture project. Carries
  // agent_id/agent_type — the spec's Non-Goals say these are NOT filtered.
  const raw = JSON.parse('{"session_id":"906fa528-8660-4526-b111-ef0b9bd03aba","transcript_path":"/Users/thomasholknielsen/.claude-accounts/memenu/projects/-private-tmp-skill-capture-371/906fa528-8660-4526-b111-ef0b9bd03aba.jsonl","cwd":"/private/tmp/skill-capture-371","prompt_id":"3a93798f-4aab-4c26-8738-32f2e672166e","permission_mode":"bypassPermissions","agent_id":"aecdf2eb0cc2a129b","agent_type":"general-purpose","effort":{"level":"high"},"hook_event_name":"PostToolUse","tool_name":"Skill","tool_input":{"skill":"claude-tweaks:help"},"tool_response":{"success":true,"commandName":"claude-tweaks:help"},"tool_use_id":"toolu_014QfZJzHJejH5BhpsDKuT8R","duration_ms":10}');
  const { dir, run } = projectWithRun({ sessionId: 'owner' });
  raw.cwd = dir;
  raw.session_id = 'owner';
  const r = await runHook(['post-tool-use'], { input: JSON.stringify(raw), cwd: dir });
  assert.strictEqual(r.code, 0);
  const events = readEvents(run);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'skill_invoked');
  assert.strictEqual(events[0].skill, 'claude-tweaks:help');
});

test('garbage Skill-shaped stdin exits 0', async () => {
  const r = await runHook(['post-tool-use'], { input: '{"tool_name":"Skill"' });
  assert.strictEqual(r.code, 0);
});

// #5377: AC9.1 — an event call takes its cwd and env from the injected values, not from the runner's
// own process. No payload carries a `cwd`. The injected cwd is a fixture project that is not
// process.cwd(): only it lets the cwd scan find the project's run. PIPELINE_RUN_DIR in the injected
// env names the OLDER of two runs: only the injected env can pick it (a cwd scan picks the newer).
test('AC9.1: skill-invocation — an event call uses the injected cwd or env', async () => {
  const { dir, run } = projectWithRun({ sessionId: 'owner' });
  assert.notStrictEqual(fs.realpathSync(dir), fs.realpathSync(process.cwd()), 'precondition: the fixture project is not the runner cwd');
  const scanned = await runHook(['post-tool-use'], { input: skillPayload({ session_id: 'owner' }), cwd: dir });
  assert.strictEqual(scanned.code, 0);
  assert.strictEqual(readEvents(run).length, 1, 'the injected cwd found the project run');

  const pinnedProject = projectWithRun();
  const newer = path.join(pinnedProject.dir, '.claude-tweaks', 'pipelines', '2026-07-02T090000-spec-2');
  fs.mkdirSync(newer, { recursive: true });
  fs.writeFileSync(path.join(newer, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const pinned = await runHook(['post-tool-use'], {
    input: skillPayload({ session_id: 'some-session' }), cwd: pinnedProject.dir,
    env: { PIPELINE_RUN_DIR: pinnedProject.run },
  });
  assert.strictEqual(pinned.code, 0);
  assert.strictEqual(readEvents(pinnedProject.run).length, 1, 'the injected env picked the older run');
  assert.strictEqual(fs.existsSync(path.join(newer, 'events.jsonl')), false, 'the newer run, which a cwd scan would pick, got no event');
});
