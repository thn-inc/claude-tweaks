'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { skipUnderRoot } = require('../../helpers/root');

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

test('#1928 AC4: an events file with only session-end prints every phase unattributed and exits 0', () => {
  const dir = tmpRun(false);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"ts":"2026-09-05T14:13:00.000Z","type":"session-end"}\n');
  const r = run(['--run', dir, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').slice(2);
  assert.equal(rows.length, 10);
  for (const row of rows) assert.match(row, /\| 0 \| unattributed \|$/);
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
  const r = spawnSync(process.execPath, [CLI, '--run', dir, '--markdown', '--auto-transcript'], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| review \| 8 \| — \| 116\/228 \| 0\.0 \| 3 \|$/m);
  const none = tmpRun(true);
  fs.writeFileSync(path.join(none, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const r2 = spawnSync(process.execPath, [CLI, '--run', none, '--markdown', '--auto-transcript'], { encoding: 'utf8', env: { ...process.env, HOME: home } });
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

test('#1929 whole-branch review fix 8: a run with a transcript but no minutes/verify still prints a total row', () => {
  const dir = tmpRun(false); // no events.jsonl copied — an empty run
  const early = path.join(os.tmpdir(), 'ct-timing-notimes-transcript.jsonl');
  fs.writeFileSync(early, '{"type":"assistant","timestamp":"2026-09-05T12:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n');
  const r = run(['--run', dir, '--transcript', early, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| total \| 0 \| 0 run\(s\) \| 3\/4 \| 0\.0 \| 0 \|$/m);
});

test('#1929 whole-branch review fix 2: a --transcript file whose stat succeeds but whose read fails (mode 000) degrades to a note, exit 0', skipUnderRoot('root ignores file permissions'), () => {
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
