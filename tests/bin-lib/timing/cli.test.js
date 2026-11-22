'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir, isolateTmpdir } = require('../../helpers/tmp-dir');
isolateTmpdir('ct-iso-cli-');
const os = require('os');
const { execFileSync } = require('child_process');
const path = require('path');
const { chmodDenialSkip } = require('../../helpers/root');
const { readText } = require('../../helpers/read-skill');
const { fixtureHomeEnv } = require('../../helpers/fixture-home');
const { runCli, spawnCli } = require('../../helpers/run-cli');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'phase-timing.js');
const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535');
// The complete environment each in-process call sees.
const cliEnv = () => ({ ...process.env });
// In-process: the CLI's run() under runCli, mapped onto { status, stdout, stderr }.
async function run(args, { env = cliEnv(), cwd, allowRealRunner } = {}) {
  const r = await runCli(CLI, args, { env, cwd, allowRealRunner });
  return { status: r.code, stdout: r.stdout, stderr: r.stderr };
}
function tmpRun(copyFixture) {
  const dir = scratchDir('ct-timing-');
  if (copyFixture) for (const f of ['events.jsonl', 'manifest.yml']) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  return dir;
}

test('#1928 AC4: --markdown prints the table and writes timing.json', async () => {
  const dir = tmpRun(true);
  const r = await run(['--run', dir, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split('\n')[0], '| Phase | Minutes | Verify |');
  assert.match(r.stdout, /^\| call-1 \| 25 \(own 1\) \|/m);
  assert.match(r.stdout, /^\| tasks \| 14 \| scoped ×1 \|/m);
  assert.match(r.stdout, /^\| build \| 22 \(own 2\) \|/m);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  assert.equal(json.runDir, dir);
  assert.equal(typeof json.generatedAt, 'string');
  assert.equal(json.totals.verifyRuns, 2);
});

// A real process, to prove stdout is flushed on exit 0.
test('AC8.1: --markdown on a fixture run prints the table and exits 0 (script entry)', () => {
  const dir = tmpRun(true);
  const r = spawnCli(CLI, ['--run', dir, '--markdown'], { env: { ...process.env } });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, [
    '| Phase | Minutes | Verify |',
    '|---|---|---|',
    '| call-1 | 25 (own 1) | — |',
    '| call-2 | 48 (own 24) | — |',
    '| build | 22 (own 2) | — |',
    '| plan | 6 | — |',
    '| tasks | 14 | scoped ×1 |',
    '| test | 2 | full ×1 |',
    '| review | 8 | — |',
    '| polish | 0 | unattributed |',
    '| wrap-up | 15 | — |',
    '| merge | 1 | — |',
    '| total | 73 | 2 run(s) (scoped, full) |',
    '',
  ].join('\n'));
});

// A real process, to prove the entry's .catch maps a rejection to exit 2.
test('AC8.1: a rejected run exits 2 with the phase-timing.js: line (script entry)', () => {
  const dir = tmpRun(true);
  fs.mkdirSync(path.join(dir, 'timing.json')); // the timing.json rename throws EISDIR (POSIX) or EPERM (win32)
  const r = spawnCli(CLI, ['--run', dir, '--markdown'], { env: { ...process.env } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, process.platform === 'win32' ? /^phase-timing\.js: EPERM/ : /^phase-timing\.js: EISDIR/);
});

test('#2550: an events file with only session-end collapses to a one-line summary instead of a 12-row all-unattributed table, and exits 0', async () => {
  const dir = tmpRun(false);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T14:13:00.000Z","type":"session-end"}\n');
  const r = await run(['--run', dir, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'no phase events; no tool-use data available\n');
});

test('#1928: a malformed line is skipped, not fatal; a missing events file is an empty run', async () => {
  const dir = tmpRun(true);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), 'not json\n');
  assert.equal((await run(['--run', dir, '--json'])).status, 0);
  const empty = tmpRun(false);
  const r = await run(['--run', empty, '--json']);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).totals.minutes, 0);
});

test('#1928: malformed invocation exits 2 — no --run, or a --run that is not a directory', async () => {
  assert.equal((await run([])).status, 2);
  assert.equal((await run(['--run', path.join(os.tmpdir(), 'ct-timing-does-not-exist')])).status, 2);
  assert.equal((await run(['--run'])).status, 2);
});

test('#1928 fix round 2: --run "" (present but empty — the unset-$PIPELINE_RUN_DIR idiom) exits 0 and writes nothing', async () => {
  const r = await run(['--run', '', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /no run directory/);
});

const TFIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'transcript-small.jsonl');

test('#1929 AC4: --transcript twice sums both, prints the three columns and the Guard footer, writes totals.guard', async () => {
  const dir = tmpRun(true);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T13:05:00.000Z","type":"gate-denial"}\n{"ts":"2026-09-05T13:06:00.000Z","type":"wd-deny"}\n{"ts":"2026-09-05T13:07:00.000Z","type":"wd-deny"}\n');
  const r = await run(['--run', dir, '--transcript', TFIX, '--transcript', TFIX, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split('\n')[0], '| Phase | Minutes | Verify | Tokens (in/out) | Proc. KB | Tool RTs |');
  // every fixture transcript row sits in 13:50-13:51 → review; two transcripts double it
  assert.match(r.stdout, /^\| review \| 8 \| — \| 232\/456 \| 0\.0 \| 6 \|$/m);
  assert.match(r.stdout, /^Guard denials: 1 gate · 0 wd-ambiguous · 2 wd-deny$/m);
  assert.match(r.stdout, /^Tokens \(in\/out\) sum the transcript's raw input_tokens\/output_tokens; cache reads and creation are separate fields in timing\.json\.$/m);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  assert.deepEqual(json.totals.guard, { gateDenial: 1, wdAmbiguous: 0, wdDeny: 2 });
  assert.deepEqual(json.totals.tokens, { input: 232, output: 456, cacheRead: 620, cacheCreate: 104 });
  assert.equal(json.totals.procedureBytes, 36);
  assert.equal(json.totals.toolRoundTrips, 6);
  assert.equal(json.transcripts.length, 2);
  assert.equal(json.transcripts[0].rows, 8);
});

test('#1929 AC4: a nonexistent --transcript prints the not-found note, blank columns, exit 0', async () => {
  const dir = tmpRun(true);
  const r = await run(['--run', dir, '--transcript', path.join(os.tmpdir(), 'ct-missing-transcript.jsonl'), '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^tokens: transcript not found \(ENOENT/m);
  assert.match(r.stdout, /^\| review \| 8 \| — \| — \| — \| — \|$/m);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  assert.equal(json.transcripts[0].rows, 0);
  assert.match(json.transcripts[0].note, /ENOENT/);
});

test('#1929 review fold-in: an empty transcript file prints the no-usage-rows note, exit 0, six-column header', async () => {
  const dir = tmpRun(true);
  const empty = path.join(os.tmpdir(), 'ct-empty-transcript.jsonl');
  fs.writeFileSync(empty, '');
  const r = await run(['--run', dir, '--transcript', empty, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^tokens: transcript had no usage rows \(/m);
  assert.match(r.stdout, /^\| Phase \| Minutes \| Verify \| Tokens \(in\/out\) \| Proc\. KB \| Tool RTs \|$/m);
});

test('#1929: without any --transcript the table keeps its #1928 three-column shape', async () => {
  const dir = tmpRun(true);
  const r = await run(['--run', dir, '--markdown']);
  assert.equal(r.stdout.split('\n')[0], '| Phase | Minutes | Verify |');
  assert.doesNotMatch(r.stdout, /Guard denials/);
});

test('#1929 AC4: --auto-transcript locates the run session transcript from run-state.json under a fixture home', async () => {
  const dir = tmpRun(true);
  const home = scratchDir('ct-timing-home-');
  const worktree = '/Users/x/Code/repo/.claude/worktrees/wt';
  const slugDir = path.join(home, '.claude', 'projects', '-Users-x-Code-repo--claude-worktrees-wt');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.copyFileSync(TFIX, path.join(slugDir, 'sess-9.jsonl'));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree, sessionId: 'sess-9', status: 'active' }));
  const r = await run(['--run', dir, '--markdown', '--auto-transcript'], { env: fixtureHomeEnv(home) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| review \| 8 \| — \| 116\/228 \| 0\.0 \| 3 \|$/m);
  const none = tmpRun(true);
  fs.writeFileSync(path.join(none, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const r2 = await run(['--run', none, '--markdown', '--auto-transcript'], { env: fixtureHomeEnv(home) });
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /^tokens: transcript not found \(no worktree or sessionId in run-state\.json\)$/m);
});

test('#1929 whole-branch review fix 3: a transcript row timestamped before every phase renders an unattributed row, and total sums visible + unattributed', async () => {
  const dir = tmpRun(true);
  const early = path.join(os.tmpdir(), 'ct-timing-early-transcript.jsonl');
  fs.writeFileSync(early, [
    '{"type":"assistant","timestamp":"2026-09-05T12:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"early"}],"usage":{"input_tokens":7,"output_tokens":9,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
    '{"type":"user","timestamp":"2026-09-05T12:00:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"none","content":"x"}]}}',
  ].join('\n') + '\n');
  const r = await run(['--run', dir, '--transcript', early, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| unattributed \| — \| — \| 7\/9 \| 0\.0 \| 1 \|$/m);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  const visible = json.phases.reduce((acc, p) => ({ input: acc.input + p.tokens.input, output: acc.output + p.tokens.output }), { input: 0, output: 0 });
  assert.equal(visible.input + json.unattributed.tokens.input, json.totals.tokens.input);
  assert.equal(visible.output + json.unattributed.tokens.output, json.totals.tokens.output);
});

test('#2550 (was #1929 whole-branch review fix 8): a run with no phase events but a transcript collapses to a one-line summary naming the token/round-trip counts, not a total row in an otherwise-empty table', async () => {
  const dir = tmpRun(false); // no events.jsonl copied — an empty run
  const early = path.join(os.tmpdir(), 'ct-timing-notimes-transcript.jsonl');
  fs.writeFileSync(early, '{"type":"assistant","timestamp":"2026-09-05T12:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n');
  const r = await run(['--run', dir, '--transcript', early, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  // #3375: a transcript-requested run also prints the dispatches not-found line (no subagents/ beside this transcript)
  const subDir = path.join(os.tmpdir(), 'ct-timing-notimes-transcript', 'subagents');
  assert.equal(r.stdout, `no phase events; 0 tool round-trips, 3/4 tokens\n\ndispatches: subagent transcripts not found (no subagents/ directory at ${subDir})\n`);
});

test('#2550 review fix: the collapsed one-line summary still carries a Guard-denials line when the run recorded real denials', async () => {
  const dir = tmpRun(false); // no phase events
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T12:00:00.000Z","type":"gate-denial"}\n{"ts":"2026-09-05T12:01:00.000Z","type":"wd-deny"}\n');
  const early = path.join(os.tmpdir(), 'ct-timing-guard-collapsed-transcript.jsonl');
  fs.writeFileSync(early, '{"type":"assistant","timestamp":"2026-09-05T12:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n');
  const r = await run(['--run', dir, '--transcript', early, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  // #3375: followed by the dispatches not-found line (no subagents/ beside this transcript)
  const subDir = path.join(os.tmpdir(), 'ct-timing-guard-collapsed-transcript', 'subagents');
  assert.equal(r.stdout, `no phase events; 0 tool round-trips, 3/4 tokens\nGuard denials: 1 gate · 0 wd-ambiguous · 1 wd-deny\n\ndispatches: subagent transcripts not found (no subagents/ directory at ${subDir})\n`);
});

test('#1929 whole-branch review fix 2: a --transcript file whose stat succeeds but whose read fails (mode 000) degrades to a note, exit 0', chmodDenialSkip('root ignores file permissions'), async () => {
  const dir = tmpRun(true);
  const unreadable = path.join(os.tmpdir(), 'ct-timing-unreadable-transcript.jsonl');
  fs.writeFileSync(unreadable, '{}\n');
  fs.chmodSync(unreadable, 0o000);
  try {
    const r = await run(['--run', dir, '--transcript', unreadable, '--markdown']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^tokens: transcript not found \(EACCES/m);
  } finally {
    fs.chmodSync(unreadable, 0o644);
    fs.rmSync(unreadable, { force: true });
  }
});

// --- #3375 per-dispatch cost attribution -------------------------------------
// The Task 1 fixture session (sess-1 + subagents/) is dated 2026-10-17, so
// these runs carry their own two-event events.jsonl covering it; record-1535's
// 2026-09 events sit outside every fixture dispatch (used once, on purpose).
const SUBFIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'subagents-session');
const SUB_EVENTS = readText(path.join(SUBFIX, '..', 'subagents-events.jsonl'));

// -> { dir, home, slugDir, transcript, env }: a run dir over the fixture's
// events, and a tmp HOME holding a copy of the fixture session at the slug of
// `worktree` (as the --auto-transcript test does).
function subagentRun({ events = SUB_EVENTS } = {}) {
  const dir = scratchDir('ct-timing-');
  if (events !== null) fs.writeFileSync(path.join(dir, 'events.jsonl'), events);
  const home = scratchDir('ct-timing-home-');
  const slugDir = path.join(home, '.claude', 'projects', '-Users-x-Code-repo--claude-worktrees-wt');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.cpSync(SUBFIX, slugDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: '/Users/x/Code/repo/.claude/worktrees/wt', sessionId: 'sess-1', status: 'active' }));
  return { dir, home, slugDir, transcript: path.join(slugDir, 'sess-1.jsonl'), env: fixtureHomeEnv(home) };
}
function runAuto(s, extra = []) {
  return run(['--run', s.dir, '--markdown', '--auto-transcript', ...extra], { env: s.env });
}
const readTiming = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));

test('#3375 AC3.1: with --auto-transcript the phase table is byte-identical to before, followed by the dispatch table', async () => {
  const s = subagentRun();
  const r = await runAuto(s);
  assert.equal(r.status, 0, r.stderr);
  const golden = readText(path.join(SUBFIX, '..', 'subagents-golden-auto.md'));
  assert.ok(r.stdout.startsWith(golden), 'the phase table and Guard footer must be unchanged');
  assert.ok(r.stdout.slice(golden.length).startsWith('\nDispatches (run window'), r.stdout.slice(golden.length));
  // a1 65s + a2 30s of standard (two separate minutes), a3 120s of capable
  assert.match(r.stdout, /^\| standard \| 2 \| 95 \| 2 \| 20\/32 \| 150\/5 \|$/m);
  assert.match(r.stdout, /^\| capable \| 1 \| 120 \| 2 \| 20\/30 \| 0\/10 \|$/m);
  assert.match(r.stdout, /^\| implementer \| 1 \| 65 \| 1 \| 13\/24 \| 100\/5 \|$/m);
  assert.match(r.stdout, /^\| task review \| 1 \| 30 \| 1 \| 7\/8 \| 50\/0 \|$/m);
  assert.match(r.stdout, /^\| whole-branch review \| 1 \| 120 \| 2 \| 20\/30 \| 0\/10 \|$/m);
  // R7: exactly one blank line separates the tier table from the role table
  assert.match(r.stdout, /\n\| capable \|[^\n]*\n\n\| Role \| Dispatches \|/);
  assert.doesNotMatch(r.stdout, /\n\n\n/);
  assert.ok(r.stdout.indexOf('| whole-branch review |') < r.stdout.indexOf('| task review |') && r.stdout.indexOf('| task review |') < r.stdout.indexOf('| implementer |'), 'roles render in ROLE_PATTERNS order');
  assert.doesNotMatch(r.stdout, /^\| (fast|frontier|unmapped|unlabelled) \|/m);
  const d = readTiming(s.dir).dispatches;
  assert.equal(d.scope, 'run-window');
  assert.equal(d.items.length, 3);
  assert.equal(d.excludedOutsideWindow, 0);
});

test('#3375 AC3.2: with no transcript flag, the whole output and timing.json are byte-identical to before', async () => {
  const s = subagentRun();
  const r = await run(['--run', s.dir, '--markdown'], { env: s.env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, readText(path.join(SUBFIX, '..', 'subagents-golden-plain.md')));
  assert.equal('dispatches' in readTiming(s.dir), false);
});

test('#3375 AC4: a not-found dispatch prints a not-found line and no numeric row for it', async () => {
  const s = subagentRun();
  fs.writeFileSync(path.join(s.slugDir, 'sess-1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ description: 'Implement Task 9', model: 'sonnet' }));
  const r = await runAuto(s);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^dispatch agent-x: transcript not found \(ENOENT\)$/m);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
  assert.match(r.stdout, /^\| implementer \| 1 \|/m);
  const x = readTiming(s.dir).dispatches.items.find((i) => i.agentId === 'x');
  assert.equal(x.tokens, null);
  assert.equal(x.wallClockMs, null);
});

test('#3375 AC4: an empty transcript, an orphan transcript, and a user-lines-only transcript each render per their own rule', async () => {
  const s = subagentRun();
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  fs.writeFileSync(path.join(sub, 'agent-empty.meta.json'), JSON.stringify({ description: 'Implement Task 7', model: 'sonnet' }));
  fs.writeFileSync(path.join(sub, 'agent-empty.jsonl'), '');
  // orphan: a transcript with usage but no meta -> counted (unlabelled, tier from transcript model)
  fs.writeFileSync(path.join(sub, 'agent-orphan.jsonl'), '{"type":"assistant","timestamp":"2026-10-17T10:03:00.000Z","message":{"id":"mo","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":2,"output_tokens":3,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n');
  // user-lines-only: timestamped, no assistant row -> notFound null, tokens 0, renders in its bucket
  fs.writeFileSync(path.join(sub, 'agent-user.meta.json'), JSON.stringify({ description: 'Review lens 3b security', model: 'fable' }));
  fs.writeFileSync(path.join(sub, 'agent-user.jsonl'), '{"type":"user","timestamp":"2026-10-17T10:04:00.000Z","message":{"role":"user","content":[{"type":"text","text":"x"}]}}\n');
  const r = await runAuto(s);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^dispatch agent-empty: transcript has no usage rows$/m);
  assert.match(r.stdout, /^dispatch agent-orphan: meta not found \(description null\)$/m);
  assert.doesNotMatch(r.stdout, /^dispatch agent-user:/m);
  assert.match(r.stdout, /^\| fast \| 1 \| /m);
  assert.match(r.stdout, /^\| frontier \| 1 \| 0 \| 0 \| 0\/0 \| 0\/0 \|$/m);
  assert.match(r.stdout, /^\| unlabelled \| 1 \| /m);
  assert.match(r.stdout, /^\| lens reviewer \| 1 \| /m);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
});

test('#3375 AC5.1: a transcript-requested run with no subagent data gains exactly the new keys dispatches and questions, with the not-found reason', async () => {
  const dir = tmpRun(true);
  const r = await run(['--run', dir, '--transcript', TFIX, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const json = readTiming(dir);
  // the #1929 key set for this run
  const before = ['runDir', 'generatedAt', 'phases', 'totals', 'unattributed', 'transcripts'];
  // #5556: questions ([] here: the transcript holds no AskUserQuestion) follows dispatches
  assert.deepEqual(Object.keys(json).filter((k) => k !== 'dispatches' && k !== 'questions').sort(), before.sort());
  assert.deepEqual(Object.keys(json).filter((k) => !before.includes(k)), ['dispatches', 'questions']);
  assert.deepEqual(json.questions, []);
  assert.match(json.dispatches.notFound, /^no subagents\/ directory at /);
  assert.deepEqual(Object.keys(json.dispatches), ['notFound']);
  assert.match(r.stdout, /^dispatches: subagent transcripts not found \(no subagents\/ directory at .+\)$/m);
  assert.doesNotMatch(r.stdout, /Dispatches \(/);
  assert.ok(r.stdout.endsWith('\n\ndispatches: subagent transcripts not found (' + json.dispatches.notFound + ')\n'));
});

test('#3375 AC5.2: no existing timing.json key changes', async () => {
  const dir = tmpRun(true);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T13:05:00.000Z","type":"gate-denial"}\n');
  assert.equal((await run(['--run', dir, '--transcript', TFIX, '--transcript', TFIX, '--markdown'])).status, 0);
  const json = readTiming(dir);
  assert.deepEqual(json.totals.tokens, { input: 232, output: 456, cacheRead: 620, cacheCreate: 104 });
  assert.equal(json.totals.procedureBytes, 36);
  assert.equal(json.totals.toolRoundTrips, 6);
  assert.deepEqual(json.totals.guard, { gateDenial: 1, wdAmbiguous: 0, wdDeny: 0 });
  assert.equal(json.transcripts.length, 2);
});

test('#3375 review focus 3: the same transcript passed twice does not double-count dispatches', async () => {
  const s = subagentRun();
  const r = await run(['--run', s.dir, '--markdown', '--transcript', s.transcript, '--transcript', s.transcript]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
  assert.equal(readTiming(s.dir).dispatches.items.length, 3);
});

test('#3375: with several transcripts, one whose subagents/ directory is missing is still named beside the tables', async () => {
  const s = subagentRun();
  const other = path.join(s.slugDir, 'sess-2.jsonl');
  fs.writeFileSync(other, '');
  const r = await run(['--run', s.dir, '--markdown', '--transcript', s.transcript, '--transcript', other]);
  assert.equal(r.status, 0, r.stderr);
  const d = readTiming(s.dir).dispatches;
  const expectedDir = path.join(s.slugDir, 'sess-2', 'subagents');
  assert.equal(d.items.length, 3);
  assert.equal(d.notFoundDirs.length, 1);
  assert.equal(d.notFoundDirs[0], `no subagents/ directory at ${expectedDir}`);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
  assert.ok(r.stdout.split('\n').includes(`dispatches: subagent transcripts not found (no subagents/ directory at ${expectedDir})`), r.stdout);
});

test('#3375 M2: the same transcript reached through a symlinked directory alias does not double-count dispatches', async () => {
  const s = subagentRun();
  const alias = path.join(scratchDir('ct-timing-alias-'), 'link');
  fs.symlinkSync(s.slugDir, alias, 'dir');
  const r = await run(['--run', s.dir, '--markdown', '--transcript', s.transcript, '--transcript', path.join(alias, 'sess-1.jsonl')]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readTiming(s.dir).dispatches.items.length, 3);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
});

test('#3375: the collapsed no-phase-events path still appends the dispatch table', async () => {
  const s = subagentRun({ events: null });
  const r = await run(['--run', s.dir, '--markdown', '--transcript', s.transcript]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^no phase events; [^\n]*\n\nDispatches \(whole session — no run events;/);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
  assert.equal(readTiming(s.dir).dispatches.scope, 'whole-session');
});

test('#3375 R1: a run whose events all sit outside the dispatches reports them excluded and renders no tier rows', async () => {
  const s = subagentRun({ events: null });
  for (const f of ['events.jsonl', 'manifest.yml']) fs.copyFileSync(path.join(FIX, f), path.join(s.dir, f));
  const r = await run(['--run', s.dir, '--markdown', '--transcript', s.transcript]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^dispatches: 3 outside the run window excluded$/m);
  assert.doesNotMatch(r.stdout, /^\| (fast|standard|capable|frontier|unmapped) \|/m);
  const d = readTiming(s.dir).dispatches;
  assert.equal(d.scope, 'run-window');
  assert.equal(d.excludedOutsideWindow, 3);
  assert.deepEqual(d.items, []);
});

test('#3375: a late worktree-reaped event does not stretch the run window over the idle gap', async () => {
  // the session ends at 10:03; a3 (10:05-10:07) ran after it, the reap fires at 12:00
  const s = subagentRun({ events: SUB_EVENTS.replace('10:10:00', '10:03:00') + '{"ts":"2026-10-17T12:00:00.000Z","type":"worktree-reaped"}\n' });
  const r = await run(['--run', s.dir, '--markdown', '--transcript', s.transcript]);
  assert.equal(r.status, 0, r.stderr);
  const d = readTiming(s.dir).dispatches;
  assert.equal(d.excludedOutsideWindow, 1);
  assert.deepEqual(d.items.map((i) => i.agentId), ['a1', 'a2']);
  assert.match(r.stdout, /^dispatches: 1 outside the run window excluded$/m);
});

// --- #4359 per-file procedure reads -------------------------------------------
// One assistant line whose Read tool_use names `file` (a skills/ path -> a key).
const readLine = (agentId, ts, id, file) => JSON.stringify({ type: 'assistant', agentId, isSidechain: true, timestamp: ts, message: { id, role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: `tu-${id}`, name: 'Read', input: { file_path: file } }], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n';
const SKILL_A = '/Users/x/.claude/plugins/cache/m/claude-tweaks/1.0.0/skills/review/SKILL.md';
const SKILL_B = '/Users/x/.claude/plugins/cache/m/claude-tweaks/1.0.0/skills/review/lenses.md';
// build [09:58, 10:02) inside call-1; review [10:02, 10:10).
const SPAN_EVENTS = '{"ts":"2026-10-17T09:58:00.000Z","type":"skill_invoked","skill":"claude-tweaks:flow"}\n{"ts":"2026-10-17T09:58:30.000Z","type":"skill_invoked","skill":"claude-tweaks:build"}\n{"ts":"2026-10-17T10:02:00.000Z","type":"skill_invoked","skill":"claude-tweaks:review"}\n{"ts":"2026-10-17T10:10:00.000Z","type":"session-end"}\n';

test('#4359: a dispatch spanning two phases books each read to its own phase', async () => {
  const s = subagentRun({ events: SPAN_EVENTS });
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ description: 'Implement Task 9', model: 'sonnet' }));
  fs.writeFileSync(path.join(sub, 'agent-x.jsonl'), readLine('x', '2026-10-17T10:00:00.000Z', 'mx1', SKILL_A) + readLine('x', '2026-10-17T10:05:00.000Z', 'mx2', SKILL_B));
  const r = await run(['--run', s.dir, '--json', '--transcript', s.transcript]);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(s.dir);
  const p = Object.fromEntries(t.phases.map((x) => [x.phase, x]));
  assert.deepEqual(p.build.procedureFiles, { 'skills/review/SKILL.md': 1 });
  assert.deepEqual(p.review.procedureFiles, { 'skills/review/lenses.md': 1 });
  assert.deepEqual(t.totals.procedureFiles, { 'skills/review/SKILL.md': 1, 'skills/review/lenses.md': 1 });
  assert.deepEqual(t.unattributed.procedureFiles, {});
  // the dispatch reads never become main rows: tokens and round trips equal a run without agent-x
  const base = subagentRun({ events: SPAN_EVENTS });
  const rb = await run(['--run', base.dir, '--json', '--transcript', base.transcript]);
  assert.equal(rb.status, 0, rb.stderr);
  const mainOnly = readTiming(base.dir).totals;
  assert.ok(mainOnly.tokens.input > 0, 'setup: the main transcript carries tokens');
  assert.deepEqual(t.totals.tokens, mainOnly.tokens);
  assert.equal(t.totals.toolRoundTrips, mainOnly.toolRoundTrips);
});

test('#4359: an agent transcript passed as --transcript is not counted again as a dispatch', async () => {
  const s = subagentRun({ events: SPAN_EVENTS });
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  const agent = path.join(sub, 'agent-x.jsonl');
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ description: 'Implement Task 9', model: 'sonnet' }));
  fs.writeFileSync(agent, readLine('x', '2026-10-17T10:05:00.000Z', 'mx1', SKILL_A));
  const r = await run(['--run', s.dir, '--json', '--transcript', agent]);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(s.dir);
  assert.ok(t.dispatches.items.some((i) => i.agentId === 'x'), 'agent-x is still listed as a dispatch');
  assert.deepEqual(t.totals.procedureFiles, { 'skills/review/SKILL.md': 1 });
  assert.deepEqual(t.phases.find((x) => x.phase === 'review').procedureFiles, { 'skills/review/SKILL.md': 1 });
});

test('#4359: an agent transcript passed through a symlinked alias of its directory is still not counted again', async () => {
  const s = subagentRun({ events: SPAN_EVENTS });
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ description: 'Implement Task 9', model: 'sonnet' }));
  fs.writeFileSync(path.join(sub, 'agent-x.jsonl'), readLine('x', '2026-10-17T10:05:00.000Z', 'mx1', SKILL_A));
  // An explicit alias, so the passed path differs from the dispatch's own path on every
  // platform (not only through macOS's /var -> /private/var tmpdir link): only realpath matches them.
  const alias = path.join(s.home, 'slug-alias');
  fs.symlinkSync(s.slugDir, alias, 'junction');
  const r = await run(['--run', s.dir, '--json', '--transcript', path.join(alias, 'sess-1', 'subagents', 'agent-x.jsonl')]);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(s.dir);
  assert.ok(t.dispatches.items.some((i) => i.agentId === 'x'), 'agent-x is still listed as a dispatch');
  assert.deepEqual(t.totals.procedureFiles, { 'skills/review/SKILL.md': 1 });
});

test('#4359 I1: a context-bundle Read by a dispatch reaches timing.json under its context/ key, apart from skill files', async () => {
  const s = subagentRun({ events: SPAN_EVENTS });
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  const bundle = '/Users/x/Code/repo/.claude-tweaks/pipelines/2026-10-17T095800-record-1/context/lens-child.md';
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ description: 'Review lens 3a', model: 'sonnet' }));
  fs.writeFileSync(path.join(sub, 'agent-x.jsonl'), readLine('x', '2026-10-17T10:05:00.000Z', 'mx1', bundle) + readLine('x', '2026-10-17T10:06:00.000Z', 'mx2', SKILL_A));
  const r = await run(['--run', s.dir, '--json', '--transcript', s.transcript]);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(s.dir);
  assert.deepEqual(t.phases.find((x) => x.phase === 'review').procedureFiles, { 'context/lens-child.md': 1, 'skills/review/SKILL.md': 1 });
});

test('#4359 M4: timing.json dispatch items carry neither procedureFileRows nor transcriptPath, and per-row attribution still holds', async () => {
  const s = subagentRun({ events: SPAN_EVENTS });
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ description: 'Implement Task 9', model: 'sonnet' }));
  fs.writeFileSync(path.join(sub, 'agent-x.jsonl'), readLine('x', '2026-10-17T10:00:00.000Z', 'mx1', SKILL_A) + readLine('x', '2026-10-17T10:05:00.000Z', 'mx2', SKILL_B));
  const r = await run(['--run', s.dir, '--json', '--transcript', s.transcript]);
  assert.equal(r.status, 0, r.stderr);
  for (const t of [readTiming(s.dir), JSON.parse(r.stdout)]) {
    assert.ok(t.dispatches.items.length > 0);
    for (const item of t.dispatches.items) {
      assert.ok(!Object.hasOwn(item, 'procedureFileRows'), `${item.agentId} carries procedureFileRows`);
      assert.ok(!Object.hasOwn(item, 'transcriptPath'), `${item.agentId} carries transcriptPath`);
    }
    assert.deepEqual(t.dispatches.items.find((i) => i.agentId === 'x').procedureFiles, { 'skills/review/SKILL.md': 1, 'skills/review/lenses.md': 1 });
    const p = Object.fromEntries(t.phases.map((x) => [x.phase, x]));
    assert.deepEqual(p.build.procedureFiles, { 'skills/review/SKILL.md': 1 });
    assert.deepEqual(p.review.procedureFiles, { 'skills/review/lenses.md': 1 });
  }
});

test('#4359 T2-2: a dispatch\'s reads key against the run\'s worktree, as the main rows do', async () => {
  const s = subagentRun({ events: SPAN_EVENTS });
  // a worktree under a skills/ directory: only the worktree-relative key is right
  const wt = '/Users/x/skills/wt';
  fs.writeFileSync(path.join(s.dir, 'run-state.json'), JSON.stringify({ worktree: wt, sessionId: 'sess-1', status: 'active' }));
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ description: 'Implement Task 9', model: 'sonnet' }));
  fs.writeFileSync(path.join(sub, 'agent-x.jsonl'), readLine('x', '2026-10-17T10:05:00.000Z', 'mx1', `${wt}/plugin/skills/review/x.md`));
  const r = await run(['--run', s.dir, '--json', '--transcript', s.transcript]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readTiming(s.dir).phases.find((x) => x.phase === 'review').procedureFiles, { 'skills/review/x.md': 1 });
});

test('#4359: buildTiming returns what run() writes, and writes nothing', async () => {
  const { buildTiming } = require(CLI);
  const src = path.join(__dirname, '..', '..', 'fixtures', 'efficiency-report', 'recount');
  const dir = tmpRun(false);
  for (const f of ['events.jsonl', 'run-state.json']) fs.copyFileSync(path.join(src, 'archive', '2027-02-01T090000-run-a', f), path.join(dir, f));
  const transcript = path.join(src, 'transcripts', 'a.jsonl');
  const built = await buildTiming({ runDir: dir, paths: [transcript], cwd: dir, worktree: '/w/run-a' });
  assert.ok(!fs.existsSync(path.join(dir, 'timing.json')), 'buildTiming wrote timing.json');
  const r = await run(['--run', dir, '--transcript', transcript, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  assert.deepEqual(built.phases, printed.phases);
  assert.deepEqual(built.unattributed, printed.unattributed);
  assert.deepEqual(built.phases.find((p) => p.phase === 'review').procedureFiles, { 'skills/review/code-mode-steps.md': 3 });
  assert.deepEqual(built.unattributed.procedureFiles, { 'skills/review/code-mode-steps.md': 1 });
});

test('#5647: buildTiming passes scopeDispatchesTo through, so a dispatched run\'s Task calls are not dispatches items', async () => {
  // Red without it: the option dropped in buildTiming's deriveTiming call -- t1 and x1 would stay in dispatches.
  const { buildTiming } = require(CLI);
  const src = path.join(__dirname, '..', '..', 'fixtures', 'efficiency-report', 'recount');
  const dir = tmpRun(false);
  for (const f of ['events.jsonl', 'run-state.json']) fs.copyFileSync(path.join(src, 'archive', '2027-02-01T090000-run-a', f), path.join(dir, f));
  const sub = path.join(scratchDir('ct-bt-scope-'), 's1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  for (const [id, parent] of [['t1', null], ['c1', 't1'], ['x1', null]]) {
    fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ spawnDepth: parent ? 2 : 1, description: id, ...(parent ? { parentAgentId: parent } : {}) }));
    fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), JSON.stringify({ timestamp: '2027-02-01T09:02:00.000Z', message: { role: 'assistant', id: `m-${id}`, model: 'claude-test', content: [], usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
  }
  const agents = ['t1', 'c1', 'x1'].map((id) => path.join(sub, `agent-${id}.jsonl`));
  const ids = async (paths, extra) => (await buildTiming({ runDir: dir, paths, cwd: dir, worktree: null, ...extra })).dispatches.items.map((d) => d.agentId).sort();
  assert.deepEqual(await ids(agents, {}), ['c1', 't1', 'x1']);
  // recountRuns passes the agent-shaped transcript paths as both `paths` and the scope.
  assert.deepEqual(await ids([agents[0]], { scopeDispatchesTo: [agents[0]] }), ['c1']);
});

test('#4359: buildTiming reads run-state.json worktree when none is given, and an explicit null wins', async () => {
  const { buildTiming } = require(CLI);
  const src = path.join(__dirname, '..', '..', 'fixtures', 'efficiency-report', 'recount');
  const dir = tmpRun(false);
  // run-b's worktree sits under a skills/ directory: only the worktree-relative key is right.
  for (const f of ['events.jsonl', 'run-state.json']) fs.copyFileSync(path.join(src, 'archive', '2027-02-03T090000-run-b', f), path.join(dir, f));
  const paths = [path.join(src, 'transcripts', 'b.jsonl')];
  const review = (t) => t.phases.find((p) => p.phase === 'review').procedureFiles;
  assert.deepEqual(review(await buildTiming({ runDir: dir, paths, cwd: dir })), { 'skills/review/code-mode-steps.md': 1, 'skills/review/step3-lens-dispatch.md': 2 });
  assert.deepEqual(Object.keys(review(await buildTiming({ runDir: dir, paths, cwd: dir, worktree: null }))), ['skills/run-b/plugin/skills/review/code-mode-steps.md', 'skills/run-b/plugin/skills/review/step3-lens-dispatch.md']);
});

test('#4359: buildTiming rejects an unreadable events.jsonl with code EVENTS_UNREADABLE', async () => {
  const { buildTiming, EVENTS_UNREADABLE } = require(CLI);
  const dir = tmpRun(false);
  fs.mkdirSync(path.join(dir, 'events.jsonl'));
  await assert.rejects(buildTiming({ runDir: dir, paths: [], cwd: dir }), (e) => e.code === EVENTS_UNREADABLE && /events\.jsonl unreadable/.test(e.message));
});

// --- #4029 turn-class telemetry -----------------------------------------------
const TC_FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'turn-classes');
const TC_HAND = { edit: 1, read: 1, explore: 1, procedure: 1, bookkeeping: 1, orientation: 2, verify: 1, 'guard-refusal': 1, dispatch: 1, other: 1 };
function tcRun() {
  const dir = scratchDir('ct-timing-');
  fs.copyFileSync(path.join(TC_FIX, 'events.jsonl'), path.join(dir, 'events.jsonl'));
  return dir;
}

test('#4029 AC1.1: timing.json for the turn-classes fixture carries the class breakdown matching the hand count', async () => {
  const dir = tcRun();
  const r = await run(['--run', dir, '--transcript', path.join(TC_FIX, 'session.jsonl'), '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(dir);
  assert.deepEqual(t.totals.turnClasses, TC_HAND);
  assert.deepEqual(t.phases.find((p) => p.phase === 'build').turnClasses, TC_HAND);
  assert.equal(t.totals.toolRoundTrips, 10);
  assert.deepEqual(t.totals.context, { turns: 10, p50: 5050, p90: 9090 });
  assert.deepEqual(t.totals.modelMix, { 'claude-opus-5-5': 9, 'claude-sonnet-5': 1 });
  assert.equal(t.totals.subagents, 1);
  assert.equal(t.totals.ceremonyShare, 0.455);
  assert.equal(t.totals.verifyMinutes, 2);
  assert.equal(t.totals.procedureBytes, 100);
  const lines = r.stdout.split('\n');
  // 5 ceremony calls of 11 is 45.45%: rendered from the counts (M2), not from the 0.455 float (which read 46%)
  assert.ok(lines.includes('Turn classes (tool calls): edit 1 · read 1 · explore 1 · procedure 1 · bookkeeping 1 · orientation 2 · verify 1 · guard-refusal 1 · dispatch 1 · other 1 — ceremony share 45%'), r.stdout);
  assert.ok(lines.includes('Context per turn: p50 5.0k · p90 9.1k tokens over 10 turns · models: claude-opus-5-5 ×9, claude-sonnet-5 ×1 · subagents: 1'), r.stdout);
});

test('#4029: without a transcript timing.json totals gain verifyMinutes only, and no class lines render', async () => {
  const dir = tcRun();
  const r = await run(['--run', dir, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(dir);
  assert.equal(t.totals.verifyMinutes, 2);
  for (const k of ['turnClasses', 'context', 'modelMix', 'subagents', 'ceremonyShare']) assert.equal(k in t.totals, false, k);
  assert.doesNotMatch(r.stdout, /Turn classes|Context per turn/);
});

test('#4029: a transcript with no tool calls and no assistant turns renders the class lines with zeros and dashes', async () => {
  const dir = tcRun();
  const bare = path.join(dir, 'bare.jsonl');
  fs.writeFileSync(bare, '{"type":"user","timestamp":"2026-10-24T10:02:00.000Z","message":{"role":"user","content":"hello"}}\n');
  const r = await run(['--run', dir, '--transcript', bare, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Turn classes \(tool calls\): edit 0 · read 0 · explore 0 · procedure 0 · bookkeeping 0 · orientation 0 · verify 0 · guard-refusal 0 · dispatch 0 · other 0 — ceremony share —$/m);
  assert.match(r.stdout, /^Context per turn: p50 — · p90 — tokens over 0 turns · models: — · subagents: 0$/m);
});

// renderMarkdown with a hand-built single-phase run and a totals bucket, for render-only rows.
function renderTotals(totals) {
  const { renderMarkdown } = require(CLI);
  const phase = { phase: 'build', source: 'event', minutes: 1, ownMinutes: 1, verify: [] };
  const out = { phases: [phase], totals: { minutes: 1, verifyRuns: 0, verifyModes: [] } };
  const bucket = { tokens: { input: 0, output: 0 }, procedureBytes: 0, toolRoundTrips: 0 };
  const tokens = {
    phases: [{ ...phase, ...bucket }],
    unattributed: { ...bucket, rows: 0 },
    totals: { ...bucket, rows: 1, context: { turns: 1, p50: 100, p90: 100 }, modelMix: {}, subagents: 0, ...totals },
  };
  return renderMarkdown(out, tokens, { gateDenial: 0, wdAmbiguous: 0, wdDeny: 0 }).split('\n');
}
const zeroClasses = () => Object.fromEntries(['edit', 'read', 'explore', 'procedure', 'bookkeeping', 'orientation', 'verify', 'guard-refusal', 'dispatch', 'other'].map((c) => [c, 0]));

test('#4029 M2: the ceremony share renders from the integer class counts, not the 3dp float', async () => {
  // 889 of 2000 is 44.45%; the 3dp float 0.445 would render 45%
  const lines = renderTotals({ turnClasses: { ...zeroClasses(), procedure: 889, edit: 1111 }, ceremonyShare: 0.445 });
  assert.ok(lines.some((l) => l.endsWith('— ceremony share 44%')), lines.join('\n'));
});

test('#4029 M3: one context turn renders "over 1 turn", any other count "turns"', async () => {
  const one = renderTotals({ turnClasses: zeroClasses(), ceremonyShare: null });
  assert.ok(one.some((l) => l.includes(' tokens over 1 turn · ')), one.join('\n'));
  const two = renderTotals({ turnClasses: zeroClasses(), ceremonyShare: null, context: { turns: 2, p50: 1, p90: 1 } });
  assert.ok(two.some((l) => l.includes(' tokens over 2 turns · ')), two.join('\n'));
});

test('#4029 M1: a rewrite without --check-budgets carries the existing budget verdict forward unchanged', async () => {
  const { root, dir } = budgetTree();
  assert.equal((await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets'])).status, 0);
  const checked = readTiming(dir).budget;
  assert.ok(checked && checked.profile === 'fast-lane', JSON.stringify(checked));
  assert.equal((await runIn(root, ['--run', dir, '--transcript', TC_SESSION])).status, 0);
  assert.deepEqual(readTiming(dir).budget, checked);
  // and --json shows the carried verdict too
  assert.deepEqual(JSON.parse((await runIn(root, ['--run', dir, '--json'])).stdout).budget, checked);
});

// --check-budgets (#4029): a tmp checkout (.git dir) with a policy.yml and a run dir under
// .claude-tweaks/pipelines/, run with cwd = the checkout so the staging anchor resolves to it.
// A stub `gh` first on PATH answers the open-record lookup (`[]` unless `ghAnswer` is given),
// so no test reaches real gh. On win32 a bare executable stub is not launchable: the lookup
// then fails open, which every test here tolerates except the one that skips win32.
function budgetTree({ config = 'ceremony-profile: fast-lane\n', policy = 'fast-lane-run-round-trip-ceiling: 5\n', git = true, ghAnswer = '[]' } = {}) {
  const root = fs.realpathSync(scratchDir('ct-budget-cli-'));
  fs.mkdirSync(path.join(root, 'stub-bin'));
  fs.writeFileSync(path.join(root, 'stub-bin', 'gh'), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(ghAnswer)});\n`, { mode: 0o755 });
  if (git) fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines'), { recursive: true });
  if (policy !== null) fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policy);
  const id = '2026-10-24T100000-record-4029';
  const dir = path.join(root, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(dir);
  fs.copyFileSync(path.join(TC_FIX, 'events.jsonl'), path.join(dir, 'events.jsonl'));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yml'), config);
  return { root, dir, id };
}
// The stub gh is found through the injected PATH, so the real gh seam runs (allowRealRunner).
const runIn = (cwd, args) => run(args, { cwd, env: { ...process.env, PATH: `${path.join(cwd, 'stub-bin')}${path.delimiter}${process.env.PATH}` }, allowRealRunner: true });
const TC_SESSION = path.join(TC_FIX, 'session.jsonl');
const stagedFiles = (dir) => (fs.existsSync(path.join(dir, 'staged')) ? fs.readdirSync(path.join(dir, 'staged')) : []);

test('#4029 AC2.1: a budget-breach fixture produces a staged item', async () => {
  const { root, dir, id } = budgetTree();
  const r = await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const staged = path.join(dir, 'staged', `efficiency-budget-${id}.md`);
  assert.ok(fs.existsSync(staged), r.stderr);
  const text = fs.readFileSync(staged, 'utf8');
  assert.ok(text.startsWith('Title: Efficiency budget: fast-lane runs over the round-trips ceiling\n'), text);
  assert.ok(text.includes(`Run \`${id}\``), 'the run id stays in the body');
  // M7: phase-timing forwards timing.json's unattributed bucket into the proposal
  assert.ok(text.includes('Unattributed round trips: 0 of 10 (0%)'), text);
  const decisions = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
  const stagedLine = decisions.split('\n').find((l) => l.startsWith('- STAGED'));
  assert.ok(stagedLine, decisions);
  assert.ok(stagedLine.includes(`Stage path: staged/efficiency-budget-${id}.md.`), stagedLine);
  assert.match(stagedLine, /efficiency budget: Efficiency budget breached \(fast-lane\): round-trips 10\/5\./);
  assert.match(decisions, /^## \/wrap-up$/m);
  const t = readTiming(dir);
  assert.equal(t.budget.profile, 'fast-lane');
  assert.equal(t.budget.profileSource, 'config');
  assert.equal(t.budget.checks.find((c) => c.metric === 'round-trips').status, 'breach');
  assert.equal(t.budget.staged, `staged/efficiency-budget-${id}.md`);
  // the budget line is the last thing --markdown prints
  const out = r.stdout.trimEnd().split('\n');
  assert.match(out[out.length - 1], /^Budget \(fast-lane\): round-trips 10\/5 BREACH · procedure-kb 0\.1\/\d+ ok · verify-minutes 2\/\d+ ok$/);

  // a re-run overwrites the one staged item and does not log it twice
  const again = await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(stagedFiles(dir).filter((f) => f.startsWith('efficiency-budget-')), [`efficiency-budget-${id}.md`]);
  assert.equal(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8').split('\n').filter((l) => l.startsWith('- STAGED')).length, 1);
});

test('#4029 I3: through the real CLI, an open record carrying the fingerprint folds the breach (stub gh)', { skip: process.platform === 'win32' && 'win32: a bare executable stub is not a launchable gh' }, async () => {
  const { budgetFingerprint } = require('../../../plugin/bin/lib/timing/budget');
  const fp = budgetFingerprint('fast-lane');
  const { root, dir } = budgetTree({ ghAnswer: JSON.stringify([{ number: 4242, body: `x\n\n<!-- work-fingerprint: ${fp} -->\nwork-fingerprint: ${fp}` }]) });
  const r = await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(stagedFiles(dir), []);
  const t = readTiming(dir);
  assert.equal(t.budget.trackedBy, 4242);
  assert.equal(t.budget.staged, null);
  assert.match(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'), /^- AUTO [^\n]*already tracked by #4242 — not re-staged\./m);
});

test('AC9.1: the gh host probe reads the injected env and writes its one-time host note through the injected stderr', { skip: process.platform === 'win32' && 'win32: a bare executable stub is not a launchable gh' }, async () => {
  const { root, dir } = budgetTree();
  fs.rmSync(path.join(root, '.git'), { recursive: true });
  // the fixture's own setup git calls must not inherit a repo-pointing variable from the test runner
  // GH_HOST is dropped too: an exported one makes the host probe return before it reads the remote.
  const {
    GH_HOST, GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR, ...gitEnv
  } = process.env;
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', 'git@acme.ghe.com:o/r.git']]) {
    execFileSync('git', args, { cwd: root, env: gitEnv, windowsHide: true });
  }
  const r = await run(['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown'], {
    cwd: root, env: { ...gitEnv, PATH: `${path.join(root, 'stub-bin')}${path.delimiter}${process.env.PATH}` }, allowRealRunner: true,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^claude-tweaks: .*acme\.ghe\.com.* — gh calls get GH_HOST=acme\.ghe\.com$/m);
});

test('#4029: no transcript leaves round-trip and procedure budgets unmeasured', async () => {
  const { root, dir } = budgetTree();
  const r = await runIn(root, ['--run', dir, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const checks = Object.fromEntries(readTiming(dir).budget.checks.map((c) => [c.metric, c.status]));
  assert.deepEqual(checks, { 'round-trips': 'unmeasured', 'procedure-kb': 'unmeasured', 'verify-minutes': 'ok' });
  assert.deepEqual(stagedFiles(dir), [], 'nothing breached, nothing staged');
  assert.match(r.stdout, /^Budget \(fast-lane\): round-trips —\/5 unmeasured · procedure-kb —\/\d+ unmeasured · verify-minutes 2\/\d+ ok$/m);
  // the CLI writes the degrade trace itself (I2)
  assert.match(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'), /^- SKIP \d{2}:\d{2}:\d{2} — efficiency budget \(degraded\): condition: round-trips, procedure-kb unmeasured \(no transcript rows\)/m);
});

test('#4029: a transcript that cannot be read leaves the transcript-backed budgets unmeasured, not ok', async () => {
  const { root, dir } = budgetTree();
  const r = await runIn(root, ['--run', dir, '--transcript', path.join(root, 'missing.jsonl'), '--check-budgets', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const checks = Object.fromEntries(JSON.parse(r.stdout).budget.checks.map((c) => [c.metric, c.status]));
  assert.equal(checks['round-trips'], 'unmeasured');
  assert.equal(checks['procedure-kb'], 'unmeasured');
});

test('#4029: a config.yml without ceremony-profile falls back to standard with a note', async () => {
  const { root, dir } = budgetTree({ config: 'mode: auto\n', policy: 'standard-run-round-trip-ceiling: 5\n' });
  const r = await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /budget: ceremony-profile absent from config\.yml — checked against standard/);
  const t = readTiming(dir);
  assert.equal(t.budget.profile, 'standard');
  assert.equal(t.budget.profileSource, 'fallback');
  // the standard ceiling (5) is what breached, not fast-lane's
  assert.equal(t.budget.checks.find((c) => c.metric === 'round-trips').status, 'breach');
  assert.ok(fs.readFileSync(path.join(dir, 'staged', `efficiency-budget-${path.basename(dir)}.md`), 'utf8').startsWith('Title: Efficiency budget: standard runs over'));
});

test('#4029: a ceiling of 0 disables its budget and a disabled budget stages nothing', async () => {
  const { root, dir } = budgetTree({ policy: 'fast-lane-run-round-trip-ceiling: 0\n' });
  const r = await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readTiming(dir).budget.checks.find((c) => c.metric === 'round-trips').status, 'disabled');
  assert.deepEqual(stagedFiles(dir), []);
  assert.match(r.stdout, /^Budget \(fast-lane\): round-trips 10\/0 disabled/m);
});

test('#4029: --check-budgets --json keeps stdout a single JSON document carrying the budget key', async () => {
  const { root, dir } = budgetTree();
  const r = await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).budget.staged !== null, true);
});

test('#4029: without --check-budgets timing.json has no budget key and is otherwise unchanged', async () => {
  const { root, dir } = budgetTree();
  const strip = (t) => { const { generatedAt, budget, ...rest } = t; return rest; };
  assert.equal((await runIn(root, ['--run', dir, '--transcript', TC_SESSION])).status, 0);
  const plain = readTiming(dir);
  assert.equal('budget' in plain, false);
  assert.deepEqual(stagedFiles(dir), []);
  assert.equal((await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets'])).status, 0);
  assert.deepEqual(strip(readTiming(dir)), strip(plain));
});

test('#4029: a staging failure (run dir not anchored under a checkout) is reported, never fatal', async () => {
  const { root, dir } = budgetTree({ git: false });
  const r = await runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /budget: could not stage the efficiency-budget proposal/);
  const t = readTiming(dir);
  assert.equal(t.budget.staged, null);
  assert.match(t.budget.stageError, /not-anchored/);
  assert.equal(t.budget.checks.find((c) => c.metric === 'round-trips').status, 'breach');
  assert.deepEqual(stagedFiles(dir), []);
  assert.match(r.stdout, /^Budget \(fast-lane\): round-trips 10\/5 BREACH/m);
});

test('#4029: a run dir with no .claude-tweaks ancestor records budget.skipped and prints the reason to stderr', async () => {
  const dir = tcRun();
  const r = await run(['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readTiming(dir).budget, { skipped: 'no .claude-tweaks ancestor' });
  assert.match(r.stderr, /budget: skipped — no \.claude-tweaks ancestor/);
  assert.doesNotMatch(r.stdout, /^Budget \(/m);
});

// --- #5382 in-process entry contract -------------------------------------------

test('AC9.1: a relative --run resolves against the injected cwd', async () => {
  const parent = fs.realpathSync(scratchDir('ct-timing-parent-'));
  fs.mkdirSync(path.join(parent, 'run'));
  for (const f of ['events.jsonl', 'manifest.yml']) fs.copyFileSync(path.join(FIX, f), path.join(parent, 'run', f));
  const r = await run(['--run', 'run', '--json'], { cwd: parent });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).runDir, path.join(parent, 'run'));
});

test('AC9.1: a relative --transcript resolves against the injected cwd, for its usage rows and its subagents/ dir', async () => {
  const s = subagentRun();
  // The runner's real cwd has no sess-1.jsonl; only deps.cwd() can find the transcript and sess-1/subagents.
  const r = await run(['--run', s.dir, '--markdown', '--transcript', 'sess-1.jsonl'], { cwd: s.slugDir });
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(s.dir);
  assert.ok(t.transcripts[0].rows > 0, JSON.stringify(t.transcripts));
  assert.equal(t.transcripts[0].note, undefined);
  assert.equal(t.dispatches.items.length, 3);
});

// --- #5597 workflow agents in timing.json ------------------------------------
function addWorkflowAgent(s, runId, id, { rows = true } = {}) {
  const dir = path.join(s.slugDir, 'sess-1', 'subagents', 'workflows', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ description: 'lens 3b A', model: 'sonnet', workflowPhase: 'review' }));
  const line = (type, ts, message) => JSON.stringify({ type, agentId: id, isSidechain: true, timestamp: ts, message: { role: type, ...message } });
  fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), rows ? [
    line('user', '2026-10-17T10:05:00.000Z', { content: [{ type: 'text', text: 'x' }] }),
    line('assistant', '2026-10-17T10:05:05.000Z', { id: 'wm1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } }),
  ].join('\n') + '\n' : '');
  return dir;
}

async function baselineSubagents() {
  const base = subagentRun();
  const r = await runAuto(base);
  assert.equal(r.status, 0, r.stderr);
  return readTiming(base.dir).totals.subagents;
}

async function baselineTiming() {
  const base = subagentRun();
  const r = await runAuto(base);
  assert.equal(r.status, 0, r.stderr);
  return readTiming(base.dir);
}

test('#5597 AC9.4: a workflow agent whose transcript has no timestamped row is in dispatches with its note and in no count', async () => {
  const baseTotal = await baselineSubagents();
  const s = subagentRun();
  addWorkflowAgent(s, 'r1', 'w0', { rows: false });
  const r = await runAuto(s);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(s.dir);
  const w0 = t.dispatches.items.find((i) => i.agentId === 'w0');
  assert.equal(w0.notFound, 'transcript has no usage rows');
  assert.equal(t.totals.subagents, baseTotal);
});

test('#5597: workflow agents count in their phase subagents and in dispatches end to end', async () => {
  const base = await baselineTiming();
  const baseTotal = base.totals.subagents;
  const s = subagentRun();
  addWorkflowAgent(s, 'r1', 'w1');
  const r = await runAuto(s);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(s.dir);
  assert.equal(t.totals.subagents, baseTotal + 1);
  // The fixture agent starts at 10:05, inside the build phase (09:58-10:10).
  const phaseOf = (tj, name) => tj.phases.find((p) => p.phase === name);
  assert.equal(phaseOf(t, 'build').subagents, phaseOf(base, 'build').subagents + 1);
  assert.equal(t.unattributed.subagents, base.unattributed.subagents);
  assert.equal(t.dispatches.items.find((i) => i.agentId === 'w1').workflowRunId, 'r1');
  const direct = t.dispatches.items.find((i) => i.agentId === 'a1');
  assert.equal('workflowRunId' in direct, false);
  assert.equal('workflowPhase' in direct, false);
});

test('#5597: a run directory problem appears in notFoundDirs', async () => {
  const s = subagentRun();
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  fs.mkdirSync(path.join(sub, 'workflows', 'r2'), { recursive: true });
  const r = await runAuto(s);
  assert.equal(r.status, 0, r.stderr);
  // collectDispatches canonicalises the subagents dir (realpath), so build the expectation from the same root.
  const msg = `no agent-* transcripts in ${path.join(fs.realpathSync(sub), 'workflows', 'r2')}`;
  const dirs = readTiming(s.dir).dispatches.notFoundDirs;
  assert.ok(dirs && dirs.includes(msg), JSON.stringify(dirs));
  assert.ok(r.stdout.includes(`dispatches: subagent transcripts not found (${msg})`), r.stdout);
});

// A run dir whose run-state.json names a worktree and session, plus the session's transcript
// copied under `<configDir>/projects/<slug>/`.
function autoFixture(configDir) {
  const dir = tmpRun(true);
  const slugDir = path.join(configDir, 'projects', '-Users-x-Code-repo--claude-worktrees-wt');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.copyFileSync(TFIX, path.join(slugDir, 'sess-9.jsonl'));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: '/Users/x/Code/repo/.claude/worktrees/wt', sessionId: 'sess-9', status: 'active' }));
  return dir;
}

test('--auto-transcript searches the injected HOME, never os.homedir()', async () => {
  const home = scratchDir('ct-timing-home-');
  const dir = autoFixture(path.join(home, '.claude'));
  // runCli throws when os.homedir() is called while env.HOME is injected
  const r = await run(['--run', dir, '--markdown', '--auto-transcript'], { env: fixtureHomeEnv(home) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| review \| 8 \| — \| 116\/228 \| 0\.0 \| 3 \|$/m);
});

test('--auto-transcript honours CLAUDE_CONFIG_DIR given only in the injected env', async () => {
  const cfg = path.join(scratchDir('ct-timing-cfg-'), 'cfg');
  const dir = autoFixture(cfg);
  const otherHome = scratchDir('ct-timing-home-');
  const r = await run(['--run', dir, '--markdown', '--auto-transcript'], { env: { ...fixtureHomeEnv(otherHome), CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| review \| 8 \| — \| 116\/228 \| 0\.0 \| 3 \|$/m);
});

test('--auto-transcript on a closed run (worktree null) picks the worktreeAtClose slug, not the newest candidate (#5555)', async () => {
  const cfg = path.join(scratchDir('ct-timing-cfg-'), 'cfg');
  const dir = tmpRun(true);
  const own = '/Users/x/Code/repo/.claude/worktrees/wt';
  const line = (input) => JSON.stringify({ timestamp: '2026-09-05T13:05:00.000Z', message: { role: 'assistant', id: `m${input}`, model: 'claude-test', content: [], usage: { input_tokens: input, output_tokens: 0 } } }) + '\n';
  const write = (slug, input) => {
    fs.mkdirSync(path.join(cfg, 'projects', slug), { recursive: true });
    const f = path.join(cfg, 'projects', slug, 'sess-9.jsonl');
    fs.writeFileSync(f, line(input));
    return f;
  };
  write('-Users-x-Code-repo--claude-worktrees-wt', 11);
  const other = write('-Users-x-Code-repo--claude-worktrees-other', 999);
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(other, later, later);
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: null, worktreeAtClose: own, sessionId: 'sess-9', status: 'clean' }));
  const r = await run(['--run', dir, '--auto-transcript'], { env: { ...fixtureHomeEnv(scratchDir('ct-timing-home-')), CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  assert.equal(t.totals.tokens.input, 11);
  assert.equal(t.transcripts.length, 1);
});

test('AC6.1: require() prints nothing and leaves process.exitCode undefined', () => {
  delete require.cache[require.resolve(CLI)];
  const writes = [];
  const outWrite = process.stdout.write;
  const errWrite = process.stderr.write;
  const before = process.exitCode;
  process.stdout.write = (t) => { writes.push(t); return true; };
  process.stderr.write = (t) => { writes.push(t); return true; };
  try {
    require(CLI);
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(process.exitCode, before);
  assert.strictEqual(process.exitCode, undefined);
});
