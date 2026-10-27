'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chmodDenialSkip } = require('../../helpers/root');
const { readText } = require('../../helpers/read-skill');
const { fixtureHomeEnv } = require('../../helpers/fixture-home');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'phase-timing.js');
const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535');
function run(args) { return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }
function tmpRun(copyFixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-'));
  if (copyFixture) for (const f of ['events.jsonl', 'manifest.yml']) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  return dir;
}

test('#1928 AC4: --markdown prints the table and writes timing.json', () => {
  const dir = tmpRun(true);
  const r = run(['--run', dir, '--markdown']);
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

test('#2550: an events file with only session-end collapses to a one-line summary instead of a 12-row all-unattributed table, and exits 0', () => {
  const dir = tmpRun(false);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T14:13:00.000Z","type":"session-end"}\n');
  const r = run(['--run', dir, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'no phase events; no tool-use data available\n');
});

test('#1928: a malformed line is skipped, not fatal; a missing events file is an empty run', () => {
  const dir = tmpRun(true);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), 'not json\n');
  assert.equal(run(['--run', dir, '--json']).status, 0);
  const empty = tmpRun(false);
  const r = run(['--run', empty, '--json']);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).totals.minutes, 0);
});

test('#1928: malformed invocation exits 2 — no --run, or a --run that is not a directory', () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['--run', path.join(os.tmpdir(), 'ct-timing-does-not-exist')]).status, 2);
  assert.equal(run(['--run']).status, 2);
});

test('#1928 fix round 2: --run "" (present but empty — the unset-$PIPELINE_RUN_DIR idiom) exits 0 and writes nothing', () => {
  const r = run(['--run', '', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /no run directory/);
});

const TFIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'transcript-small.jsonl');

test('#1929 AC4: --transcript twice sums both, prints the three columns and the Guard footer, writes totals.guard', () => {
  const dir = tmpRun(true);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T13:05:00.000Z","type":"gate-denial"}\n{"ts":"2026-09-05T13:06:00.000Z","type":"wd-deny"}\n{"ts":"2026-09-05T13:07:00.000Z","type":"wd-deny"}\n');
  const r = run(['--run', dir, '--transcript', TFIX, '--transcript', TFIX, '--markdown']);
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

test('#1929 AC4: a nonexistent --transcript prints the not-found note, blank columns, exit 0', () => {
  const dir = tmpRun(true);
  const r = run(['--run', dir, '--transcript', path.join(os.tmpdir(), 'ct-missing-transcript.jsonl'), '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^tokens: transcript not found \(ENOENT/m);
  assert.match(r.stdout, /^\| review \| 8 \| — \| — \| — \| — \|$/m);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  assert.equal(json.transcripts[0].rows, 0);
  assert.match(json.transcripts[0].note, /ENOENT/);
});

test('#1929 review fold-in: an empty transcript file prints the no-usage-rows note, exit 0, six-column header', () => {
  const dir = tmpRun(true);
  const empty = path.join(os.tmpdir(), 'ct-empty-transcript.jsonl');
  fs.writeFileSync(empty, '');
  const r = run(['--run', dir, '--transcript', empty, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^tokens: transcript had no usage rows \(/m);
  assert.match(r.stdout, /^\| Phase \| Minutes \| Verify \| Tokens \(in\/out\) \| Proc\. KB \| Tool RTs \|$/m);
});

test('#1929: without any --transcript the table keeps its #1928 three-column shape', () => {
  const dir = tmpRun(true);
  const r = run(['--run', dir, '--markdown']);
  assert.equal(r.stdout.split('\n')[0], '| Phase | Minutes | Verify |');
  assert.doesNotMatch(r.stdout, /Guard denials/);
});

test('#1929 AC4: --auto-transcript locates the run session transcript from run-state.json under a fixture home', () => {
  const dir = tmpRun(true);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-home-'));
  const worktree = '/Users/x/Code/repo/.claude/worktrees/wt';
  const slugDir = path.join(home, '.claude', 'projects', '-Users-x-Code-repo--claude-worktrees-wt');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.copyFileSync(TFIX, path.join(slugDir, 'sess-9.jsonl'));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree, sessionId: 'sess-9', status: 'active' }));
  const r = spawnSync(process.execPath, [CLI, '--run', dir, '--markdown', '--auto-transcript'], { encoding: 'utf8', env: fixtureHomeEnv(home) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| review \| 8 \| — \| 116\/228 \| 0\.0 \| 3 \|$/m);
  const none = tmpRun(true);
  fs.writeFileSync(path.join(none, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const r2 = spawnSync(process.execPath, [CLI, '--run', none, '--markdown', '--auto-transcript'], { encoding: 'utf8', env: fixtureHomeEnv(home) });
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /^tokens: transcript not found \(no worktree or sessionId in run-state\.json\)$/m);
});

test('#1929 whole-branch review fix 3: a transcript row timestamped before every phase renders an unattributed row, and total sums visible + unattributed', () => {
  const dir = tmpRun(true);
  const early = path.join(os.tmpdir(), 'ct-timing-early-transcript.jsonl');
  fs.writeFileSync(early, [
    '{"type":"assistant","timestamp":"2026-09-05T12:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"early"}],"usage":{"input_tokens":7,"output_tokens":9,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
    '{"type":"user","timestamp":"2026-09-05T12:00:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"none","content":"x"}]}}',
  ].join('\n') + '\n');
  const r = run(['--run', dir, '--transcript', early, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| unattributed \| — \| — \| 7\/9 \| 0\.0 \| 1 \|$/m);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  const visible = json.phases.reduce((acc, p) => ({ input: acc.input + p.tokens.input, output: acc.output + p.tokens.output }), { input: 0, output: 0 });
  assert.equal(visible.input + json.unattributed.tokens.input, json.totals.tokens.input);
  assert.equal(visible.output + json.unattributed.tokens.output, json.totals.tokens.output);
});

test('#2550 (was #1929 whole-branch review fix 8): a run with no phase events but a transcript collapses to a one-line summary naming the token/round-trip counts, not a total row in an otherwise-empty table', () => {
  const dir = tmpRun(false); // no events.jsonl copied — an empty run
  const early = path.join(os.tmpdir(), 'ct-timing-notimes-transcript.jsonl');
  fs.writeFileSync(early, '{"type":"assistant","timestamp":"2026-09-05T12:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n');
  const r = run(['--run', dir, '--transcript', early, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  // #3375: a transcript-requested run also prints the dispatches not-found line (no subagents/ beside this transcript)
  const subDir = path.join(os.tmpdir(), 'ct-timing-notimes-transcript', 'subagents');
  assert.equal(r.stdout, `no phase events; 0 tool round-trips, 3/4 tokens\n\ndispatches: subagent transcripts not found (no subagents/ directory at ${subDir})\n`);
});

test('#2550 review fix: the collapsed one-line summary still carries a Guard-denials line when the run recorded real denials', () => {
  const dir = tmpRun(false); // no phase events
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T12:00:00.000Z","type":"gate-denial"}\n{"ts":"2026-09-05T12:01:00.000Z","type":"wd-deny"}\n');
  const early = path.join(os.tmpdir(), 'ct-timing-guard-collapsed-transcript.jsonl');
  fs.writeFileSync(early, '{"type":"assistant","timestamp":"2026-09-05T12:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n');
  const r = run(['--run', dir, '--transcript', early, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  // #3375: followed by the dispatches not-found line (no subagents/ beside this transcript)
  const subDir = path.join(os.tmpdir(), 'ct-timing-guard-collapsed-transcript', 'subagents');
  assert.equal(r.stdout, `no phase events; 0 tool round-trips, 3/4 tokens\nGuard denials: 1 gate · 0 wd-ambiguous · 1 wd-deny\n\ndispatches: subagent transcripts not found (no subagents/ directory at ${subDir})\n`);
});

test('#1929 whole-branch review fix 2: a --transcript file whose stat succeeds but whose read fails (mode 000) degrades to a note, exit 0', chmodDenialSkip('root ignores file permissions'), () => {
  const dir = tmpRun(true);
  const unreadable = path.join(os.tmpdir(), 'ct-timing-unreadable-transcript.jsonl');
  fs.writeFileSync(unreadable, '{}\n');
  fs.chmodSync(unreadable, 0o000);
  try {
    const r = run(['--run', dir, '--transcript', unreadable, '--markdown']);
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
const SUB_EVENTS = '{"ts":"2026-10-17T09:58:00.000Z","type":"skill_invoked","skill":"claude-tweaks:build"}\n{"ts":"2026-10-17T10:10:00.000Z","type":"session-end"}\n';

// -> { dir, home, slugDir, transcript, env }: a run dir over the fixture's
// events, and a tmp HOME holding a copy of the fixture session at the slug of
// `worktree` (as the --auto-transcript test does).
function subagentRun({ events = SUB_EVENTS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-'));
  if (events !== null) fs.writeFileSync(path.join(dir, 'events.jsonl'), events);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-home-'));
  const slugDir = path.join(home, '.claude', 'projects', '-Users-x-Code-repo--claude-worktrees-wt');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.cpSync(SUBFIX, slugDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: '/Users/x/Code/repo/.claude/worktrees/wt', sessionId: 'sess-1', status: 'active' }));
  return { dir, home, slugDir, transcript: path.join(slugDir, 'sess-1.jsonl'), env: fixtureHomeEnv(home) };
}
function runAuto(s, extra = []) {
  return spawnSync(process.execPath, [CLI, '--run', s.dir, '--markdown', '--auto-transcript', ...extra], { encoding: 'utf8', env: s.env });
}
const readTiming = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));

test('#3375 AC3.1: with --auto-transcript the phase table is byte-identical to before, followed by the dispatch table', () => {
  const s = subagentRun();
  const r = runAuto(s);
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

test('#3375 AC3.2: with no transcript flag, the whole output and timing.json are byte-identical to before', () => {
  const s = subagentRun();
  const r = spawnSync(process.execPath, [CLI, '--run', s.dir, '--markdown'], { encoding: 'utf8', env: s.env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, readText(path.join(SUBFIX, '..', 'subagents-golden-plain.md')));
  assert.equal('dispatches' in readTiming(s.dir), false);
});

test('#3375 AC4: a not-found dispatch prints a not-found line and no numeric row for it', () => {
  const s = subagentRun();
  fs.writeFileSync(path.join(s.slugDir, 'sess-1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ description: 'Implement Task 9', model: 'sonnet' }));
  const r = runAuto(s);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^dispatch agent-x: transcript not found \(ENOENT\)$/m);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
  assert.match(r.stdout, /^\| implementer \| 1 \|/m);
  const x = readTiming(s.dir).dispatches.items.find((i) => i.agentId === 'x');
  assert.equal(x.tokens, null);
  assert.equal(x.wallClockMs, null);
});

test('#3375 AC4: an empty transcript, an orphan transcript, and a user-lines-only transcript each render per their own rule', () => {
  const s = subagentRun();
  const sub = path.join(s.slugDir, 'sess-1', 'subagents');
  fs.writeFileSync(path.join(sub, 'agent-empty.meta.json'), JSON.stringify({ description: 'Implement Task 7', model: 'sonnet' }));
  fs.writeFileSync(path.join(sub, 'agent-empty.jsonl'), '');
  // orphan: a transcript with usage but no meta -> counted (unlabelled, tier from transcript model)
  fs.writeFileSync(path.join(sub, 'agent-orphan.jsonl'), '{"type":"assistant","timestamp":"2026-10-17T10:03:00.000Z","message":{"id":"mo","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":2,"output_tokens":3,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n');
  // user-lines-only: timestamped, no assistant row -> notFound null, tokens 0, renders in its bucket
  fs.writeFileSync(path.join(sub, 'agent-user.meta.json'), JSON.stringify({ description: 'Review lens 3b security', model: 'fable' }));
  fs.writeFileSync(path.join(sub, 'agent-user.jsonl'), '{"type":"user","timestamp":"2026-10-17T10:04:00.000Z","message":{"role":"user","content":[{"type":"text","text":"x"}]}}\n');
  const r = runAuto(s);
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

test('#3375 AC5.1: a transcript-requested run with no subagent data gains exactly one new key, dispatches, with the not-found reason', () => {
  const dir = tmpRun(true);
  const r = run(['--run', dir, '--transcript', TFIX, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const json = readTiming(dir);
  // the #1929 key set for this run
  const before = ['runDir', 'generatedAt', 'phases', 'totals', 'unattributed', 'transcripts'];
  assert.deepEqual(Object.keys(json).filter((k) => k !== 'dispatches').sort(), before.sort());
  assert.deepEqual(Object.keys(json).filter((k) => !before.includes(k)), ['dispatches']);
  assert.match(json.dispatches.notFound, /^no subagents\/ directory at /);
  assert.deepEqual(Object.keys(json.dispatches), ['notFound']);
  assert.match(r.stdout, /^dispatches: subagent transcripts not found \(no subagents\/ directory at .+\)$/m);
  assert.doesNotMatch(r.stdout, /Dispatches \(/);
  assert.ok(r.stdout.endsWith('\n\ndispatches: subagent transcripts not found (' + json.dispatches.notFound + ')\n'));
});

test('#3375 AC5.2: no existing timing.json key changes', () => {
  const dir = tmpRun(true);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T13:05:00.000Z","type":"gate-denial"}\n');
  assert.equal(run(['--run', dir, '--transcript', TFIX, '--transcript', TFIX, '--markdown']).status, 0);
  const json = readTiming(dir);
  assert.deepEqual(json.totals.tokens, { input: 232, output: 456, cacheRead: 620, cacheCreate: 104 });
  assert.equal(json.totals.procedureBytes, 36);
  assert.equal(json.totals.toolRoundTrips, 6);
  assert.deepEqual(json.totals.guard, { gateDenial: 1, wdAmbiguous: 0, wdDeny: 0 });
  assert.equal(json.transcripts.length, 2);
});

test('#3375 review focus 3: the same transcript passed twice does not double-count dispatches', () => {
  const s = subagentRun();
  const r = spawnSync(process.execPath, [CLI, '--run', s.dir, '--markdown', '--transcript', s.transcript, '--transcript', s.transcript], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
  assert.equal(readTiming(s.dir).dispatches.items.length, 3);
});

test('#3375: with several transcripts, one whose subagents/ directory is missing is still named beside the tables', () => {
  const s = subagentRun();
  const other = path.join(s.slugDir, 'sess-2.jsonl');
  fs.writeFileSync(other, '');
  const r = spawnSync(process.execPath, [CLI, '--run', s.dir, '--markdown', '--transcript', s.transcript, '--transcript', other], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const d = readTiming(s.dir).dispatches;
  const expectedDir = path.join(s.slugDir, 'sess-2', 'subagents');
  assert.equal(d.items.length, 3);
  assert.equal(d.notFoundDirs.length, 1);
  assert.equal(d.notFoundDirs[0], `no subagents/ directory at ${expectedDir}`);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
  assert.ok(r.stdout.split('\n').includes(`dispatches: subagent transcripts not found (no subagents/ directory at ${expectedDir})`), r.stdout);
});

test('#3375 M2: the same transcript reached through a symlinked directory alias does not double-count dispatches', () => {
  const s = subagentRun();
  const alias = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-alias-')), 'link');
  fs.symlinkSync(s.slugDir, alias, 'dir');
  const r = spawnSync(process.execPath, [CLI, '--run', s.dir, '--markdown', '--transcript', s.transcript, '--transcript', path.join(alias, 'sess-1.jsonl')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readTiming(s.dir).dispatches.items.length, 3);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
});

test('#3375: the collapsed no-phase-events path still appends the dispatch table', () => {
  const s = subagentRun({ events: null });
  const r = spawnSync(process.execPath, [CLI, '--run', s.dir, '--markdown', '--transcript', s.transcript], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^no phase events; [^\n]*\n\nDispatches \(whole session — no run events;/);
  assert.match(r.stdout, /^\| standard \| 2 \|/m);
  assert.equal(readTiming(s.dir).dispatches.scope, 'whole-session');
});

test('#3375 R1: a run whose events all sit outside the dispatches reports them excluded and renders no tier rows', () => {
  const s = subagentRun({ events: null });
  for (const f of ['events.jsonl', 'manifest.yml']) fs.copyFileSync(path.join(FIX, f), path.join(s.dir, f));
  const r = spawnSync(process.execPath, [CLI, '--run', s.dir, '--markdown', '--transcript', s.transcript], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^dispatches: 3 outside the run window excluded$/m);
  assert.doesNotMatch(r.stdout, /^\| (fast|standard|capable|frontier|unmapped) \|/m);
  const d = readTiming(s.dir).dispatches;
  assert.equal(d.scope, 'run-window');
  assert.equal(d.excludedOutsideWindow, 3);
  assert.deepEqual(d.items, []);
});

test('#3375: a late worktree-reaped event does not stretch the run window over the idle gap', () => {
  // the session ends at 10:03; a3 (10:05-10:07) ran after it, the reap fires at 12:00
  const s = subagentRun({ events: SUB_EVENTS.replace('10:10:00', '10:03:00') + '{"ts":"2026-10-17T12:00:00.000Z","type":"worktree-reaped"}\n' });
  const r = spawnSync(process.execPath, [CLI, '--run', s.dir, '--markdown', '--transcript', s.transcript], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const d = readTiming(s.dir).dispatches;
  assert.equal(d.excludedOutsideWindow, 1);
  assert.deepEqual(d.items.map((i) => i.agentId), ['a1', 'a2']);
  assert.match(r.stdout, /^dispatches: 1 outside the run window excluded$/m);
});

// --- #4029 turn-class telemetry -----------------------------------------------
const TC_FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'turn-classes');
const TC_HAND = { edit: 1, read: 1, explore: 1, procedure: 1, bookkeeping: 1, orientation: 2, verify: 1, 'guard-refusal': 1, dispatch: 1, other: 1 };
function tcRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-'));
  fs.copyFileSync(path.join(TC_FIX, 'events.jsonl'), path.join(dir, 'events.jsonl'));
  return dir;
}

test('#4029 AC1.1: timing.json for the turn-classes fixture carries the class breakdown matching the hand count', () => {
  const dir = tcRun();
  const r = run(['--run', dir, '--transcript', path.join(TC_FIX, 'session.jsonl'), '--markdown']);
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

test('#4029: without a transcript timing.json totals gain verifyMinutes only, and no class lines render', () => {
  const dir = tcRun();
  const r = run(['--run', dir, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const t = readTiming(dir);
  assert.equal(t.totals.verifyMinutes, 2);
  for (const k of ['turnClasses', 'context', 'modelMix', 'subagents', 'ceremonyShare']) assert.equal(k in t.totals, false, k);
  assert.doesNotMatch(r.stdout, /Turn classes|Context per turn/);
});

test('#4029: a transcript with no tool calls and no assistant turns renders the class lines with zeros and dashes', () => {
  const dir = tcRun();
  const bare = path.join(dir, 'bare.jsonl');
  fs.writeFileSync(bare, '{"type":"user","timestamp":"2026-10-24T10:02:00.000Z","message":{"role":"user","content":"hello"}}\n');
  const r = run(['--run', dir, '--transcript', bare, '--markdown']);
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

test('#4029 M2: the ceremony share renders from the integer class counts, not the 3dp float', () => {
  // 889 of 2000 is 44.45%; the 3dp float 0.445 would render 45%
  const lines = renderTotals({ turnClasses: { ...zeroClasses(), procedure: 889, edit: 1111 }, ceremonyShare: 0.445 });
  assert.ok(lines.some((l) => l.endsWith('— ceremony share 44%')), lines.join('\n'));
});

test('#4029 M3: one context turn renders "over 1 turn", any other count "turns"', () => {
  const one = renderTotals({ turnClasses: zeroClasses(), ceremonyShare: null });
  assert.ok(one.some((l) => l.includes(' tokens over 1 turn · ')), one.join('\n'));
  const two = renderTotals({ turnClasses: zeroClasses(), ceremonyShare: null, context: { turns: 2, p50: 1, p90: 1 } });
  assert.ok(two.some((l) => l.includes(' tokens over 2 turns · ')), two.join('\n'));
});

test('#4029 M1: a rewrite without --check-budgets carries the existing budget verdict forward unchanged', () => {
  const { root, dir } = budgetTree();
  assert.equal(runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets']).status, 0);
  const checked = readTiming(dir).budget;
  assert.ok(checked && checked.profile === 'fast-lane', JSON.stringify(checked));
  assert.equal(runIn(root, ['--run', dir, '--transcript', TC_SESSION]).status, 0);
  assert.deepEqual(readTiming(dir).budget, checked);
  // and --json shows the carried verdict too
  assert.deepEqual(JSON.parse(runIn(root, ['--run', dir, '--json']).stdout).budget, checked);
});

// --check-budgets (#4029): a tmp checkout (.git dir) with a policy.yml and a run dir under
// .claude-tweaks/pipelines/, run with cwd = the checkout so the staging anchor resolves to it.
// A stub `gh` first on PATH answers the open-record lookup (`[]` unless `ghAnswer` is given),
// so no test reaches real gh. On win32 a bare executable stub is not launchable: the lookup
// then fails open, which every test here tolerates except the one that skips win32.
function budgetTree({ config = 'ceremony-profile: fast-lane\n', policy = 'fast-lane-run-round-trip-ceiling: 5\n', git = true, ghAnswer = '[]' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-budget-cli-')));
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
const runIn = (cwd, args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd, env: { ...process.env, PATH: `${path.join(cwd, 'stub-bin')}${path.delimiter}${process.env.PATH}` } });
const TC_SESSION = path.join(TC_FIX, 'session.jsonl');
const stagedFiles = (dir) => (fs.existsSync(path.join(dir, 'staged')) ? fs.readdirSync(path.join(dir, 'staged')) : []);

test('#4029 AC2.1: a budget-breach fixture produces a staged item', () => {
  const { root, dir, id } = budgetTree();
  const r = runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
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
  const again = runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(stagedFiles(dir).filter((f) => f.startsWith('efficiency-budget-')), [`efficiency-budget-${id}.md`]);
  assert.equal(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8').split('\n').filter((l) => l.startsWith('- STAGED')).length, 1);
});

test('#4029 I3: through the real CLI, an open record carrying the fingerprint folds the breach (stub gh)', { skip: process.platform === 'win32' && 'win32: a bare executable stub is not a launchable gh' }, () => {
  const { budgetFingerprint } = require('../../../plugin/bin/lib/timing/budget');
  const fp = budgetFingerprint('fast-lane');
  const { root, dir } = budgetTree({ ghAnswer: JSON.stringify([{ number: 4242, body: `x\n\n<!-- work-fingerprint: ${fp} -->\nwork-fingerprint: ${fp}` }]) });
  const r = runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(stagedFiles(dir), []);
  const t = readTiming(dir);
  assert.equal(t.budget.trackedBy, 4242);
  assert.equal(t.budget.staged, null);
  assert.match(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'), /^- AUTO [^\n]*already tracked by #4242 — not re-staged\./m);
});

test('#4029: no transcript leaves round-trip and procedure budgets unmeasured', () => {
  const { root, dir } = budgetTree();
  const r = runIn(root, ['--run', dir, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const checks = Object.fromEntries(readTiming(dir).budget.checks.map((c) => [c.metric, c.status]));
  assert.deepEqual(checks, { 'round-trips': 'unmeasured', 'procedure-kb': 'unmeasured', 'verify-minutes': 'ok' });
  assert.deepEqual(stagedFiles(dir), [], 'nothing breached, nothing staged');
  assert.match(r.stdout, /^Budget \(fast-lane\): round-trips —\/5 unmeasured · procedure-kb —\/\d+ unmeasured · verify-minutes 2\/\d+ ok$/m);
  // the CLI writes the degrade trace itself (I2)
  assert.match(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'), /^- SKIP \d{2}:\d{2}:\d{2} — efficiency budget \(degraded\): condition: round-trips, procedure-kb unmeasured \(no transcript rows\)/m);
});

test('#4029: a transcript that cannot be read leaves the transcript-backed budgets unmeasured, not ok', () => {
  const { root, dir } = budgetTree();
  const r = runIn(root, ['--run', dir, '--transcript', path.join(root, 'missing.jsonl'), '--check-budgets', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const checks = Object.fromEntries(JSON.parse(r.stdout).budget.checks.map((c) => [c.metric, c.status]));
  assert.equal(checks['round-trips'], 'unmeasured');
  assert.equal(checks['procedure-kb'], 'unmeasured');
});

test('#4029: a config.yml without ceremony-profile falls back to standard with a note', () => {
  const { root, dir } = budgetTree({ config: 'mode: auto\n', policy: 'standard-run-round-trip-ceiling: 5\n' });
  const r = runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /budget: ceremony-profile absent from config\.yml — checked against standard/);
  const t = readTiming(dir);
  assert.equal(t.budget.profile, 'standard');
  assert.equal(t.budget.profileSource, 'fallback');
  // the standard ceiling (5) is what breached, not fast-lane's
  assert.equal(t.budget.checks.find((c) => c.metric === 'round-trips').status, 'breach');
  assert.ok(fs.readFileSync(path.join(dir, 'staged', `efficiency-budget-${path.basename(dir)}.md`), 'utf8').startsWith('Title: Efficiency budget: standard runs over'));
});

test('#4029: a ceiling of 0 disables its budget and a disabled budget stages nothing', () => {
  const { root, dir } = budgetTree({ policy: 'fast-lane-run-round-trip-ceiling: 0\n' });
  const r = runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readTiming(dir).budget.checks.find((c) => c.metric === 'round-trips').status, 'disabled');
  assert.deepEqual(stagedFiles(dir), []);
  assert.match(r.stdout, /^Budget \(fast-lane\): round-trips 10\/0 disabled/m);
});

test('#4029: --check-budgets --json keeps stdout a single JSON document carrying the budget key', () => {
  const { root, dir } = budgetTree();
  const r = runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).budget.staged !== null, true);
});

test('#4029: without --check-budgets timing.json has no budget key and is otherwise unchanged', () => {
  const { root, dir } = budgetTree();
  const strip = (t) => { const { generatedAt, budget, ...rest } = t; return rest; };
  assert.equal(runIn(root, ['--run', dir, '--transcript', TC_SESSION]).status, 0);
  const plain = readTiming(dir);
  assert.equal('budget' in plain, false);
  assert.deepEqual(stagedFiles(dir), []);
  assert.equal(runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets']).status, 0);
  assert.deepEqual(strip(readTiming(dir)), strip(plain));
});

test('#4029: a staging failure (run dir not anchored under a checkout) is reported, never fatal', () => {
  const { root, dir } = budgetTree({ git: false });
  const r = runIn(root, ['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /budget: could not stage the efficiency-budget proposal/);
  const t = readTiming(dir);
  assert.equal(t.budget.staged, null);
  assert.match(t.budget.stageError, /not-anchored/);
  assert.equal(t.budget.checks.find((c) => c.metric === 'round-trips').status, 'breach');
  assert.deepEqual(stagedFiles(dir), []);
  assert.match(r.stdout, /^Budget \(fast-lane\): round-trips 10\/5 BREACH/m);
});

test('#4029: a run dir with no .claude-tweaks ancestor records budget.skipped and prints the reason to stderr', () => {
  const dir = tcRun();
  const r = run(['--run', dir, '--transcript', TC_SESSION, '--check-budgets', '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readTiming(dir).budget, { skipped: 'no .claude-tweaks ancestor' });
  assert.match(r.stderr, /budget: skipped — no \.claude-tweaks ancestor/);
  assert.doesNotMatch(r.stdout, /^Budget \(/m);
});
