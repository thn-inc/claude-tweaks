'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { skipUnderRoot } = require('../../helpers/root');
const { readText } = require('../../helpers/read-skill');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'phase-timing.js');
const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535');
function run(args) { return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }
function tmpRun(copyFixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-'));
  if (copyFixture) for (const f of ['events.jsonl', 'manifest.yml']) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  return dir;
}
// A fixture home for spawned children: os.homedir() reads USERPROFILE on
// Windows, so both are set; CLAUDE_CONFIG_DIR is dropped so the developer's
// own config dir cannot redirect the transcript lookup away from the fixture.
function fixtureHomeEnv(home) {
  const { CLAUDE_CONFIG_DIR, ...base } = process.env;
  return { ...base, HOME: home, USERPROFILE: home };
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

test('#1929 whole-branch review fix 2: a --transcript file whose stat succeeds but whose read fails (mode 000) degrades to a note, exit 0', { skip: skipUnderRoot('root ignores file permissions').skip || (process.platform === 'win32' && 'win32: chmod 0o000 only sets the read-only attribute') }, () => {
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
