#!/usr/bin/env node
// bin/ci-gate-record.js — record how long a pull request's CI took at the
// merge gate (#5160): append one `ci-gate` event to an anchored run dir's
// events.jsonl. A post-hoc recorder: it never changes a verdict, and the
// caller logs a SKIP on any non-zero exit rather than blocking the merge.
//   node bin/ci-gate-record.js --pr <n> --head-sha <sha> --verdict <green|red|timeout-park>
//     --gate-start-epoch <s> --run <run-dir> [--repo <owner/repo>] [--help]
// It re-reads the head commit's workflow runs with one
// `gh run list --commit <sha> --limit 100 --json <RUN_LIST_FIELDS>`
// (no --repo: gh resolves the repo from the cwd's origin through ghOptions).
//
// The `ci-gate` event's fields — this file is their single source; prose
// cites it rather than restating the list:
//   pr          the --pr number
//   headSha     the --head-sha value
//   verdict     the --verdict value, from the flag only (never reconciled with
//               the runs read here)
//   gateWaitMs  now - gate-start-epoch * 1000, unclamped (negative under clock
//               skew or a stale gate-start file)
//   runsReadAt  ISO time the runs were read
//   runs[]      each { workflow (gh's workflowName), event, status, createdAt,
//               startedAt, updatedAt, attempt, conclusion, databaseId }, unfiltered
//   ciWallMs    latest updatedAt minus earliest createdAt over the runs whose
//               status is `completed` (any conclusion, any event); null when none
//   pendingAtBound  true, present only for --verdict timeout-park
// appendEvent stamps `ts` and `type`.
//
// Exit codes (the Sanctioned-writer vocabulary): 0 the event was written (the
// events.jsonl path echoed to stdout); 2 a malformed invocation or unreadable
// input — a failed `gh run list` is 2 (unreadable input), as is gh output that
// is not a JSON array of objects or a completed run with an unparseable
// timestamp, never a ciWallMs of null; 3 the run dir is missing or not anchored
// under the main checkout (a worktree-local shadow — _shared/pipeline-run-dir.md's
// Anchoring section, [IL-127]), or the write did not land. No exit 1.
//
// Confirm by re-read: appendEvent is best-effort and swallows its own write
// failure, so a return from it proves nothing. The writer re-reads
// events.jsonl and exits 0 only when a line carries this event's type, pr,
// headSha, verdict and runsReadAt; an unreadable file or no such line is 3.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveTarget } = require('./lib/stage-item/write');
const { appendEvent } = require('./lib/hooks/context');
const { ghOptions } = require('./lib/repo-resolve');

// Deliberately its own value, not GH_TIMEOUT_MS: this read sits on Step 2.5's
// merge path, and a hung gh must not hold it, while gh-timeout-ms may raise
// GH_TIMEOUT_MS to 60 s.
const CI_GATE_GH_TIMEOUT_MS = 15000;

const VERDICTS = Object.freeze(['green', 'red', 'timeout-park']);
const RUN_LIST_FIELDS = 'createdAt,startedAt,updatedAt,attempt,event,conclusion,status,workflowName,databaseId';

const USAGE = 'usage: ci-gate-record.js --pr <n> --head-sha <40-hex sha> --verdict <green|red|timeout-park> --gate-start-epoch <s> --run <run-dir> [--repo <owner/repo>] [--help]\n'
  + '  exit 0 event written (events.jsonl path on stdout); 2 malformed invocation or unreadable input (a failed gh run list included); 3 run dir missing or not anchored, or the write did not land\n';

// flag -> [option key, validator returning an error message or null]
const FLAGS = {
  '--pr': ['pr', (v) => (/^\d+$/.test(v) && Number(v) !== 0 ? null : 'must be a positive integer')],
  '--head-sha': ['headSha', (v) => (/^[0-9a-f]{40}$/.test(v) ? null : 'must be a 40-character lowercase hex sha')],
  '--verdict': ['verdict', (v) => (VERDICTS.includes(v) ? null : `must be one of: ${VERDICTS.join(', ')}`)],
  '--gate-start-epoch': ['gateStartEpoch', (v) => (/^\d+$/.test(v) ? null : 'must be a non-negative integer (epoch seconds)')],
  '--run': ['run', () => null],
  '--repo': ['repo', (v) => (v.startsWith('-') ? 'must not begin with -' : null)],
};

function parseArgs(argv) {
  const o = {
    pr: null, headSha: null, verdict: null, gateStartEpoch: null, run: null, repo: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; return o; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    const [key, check] = FLAGS[a];
    const problem = check(v);
    if (problem) return { error: `${a} ${problem} (got ${JSON.stringify(v)})` };
    o[key] = v;
  }
  if (o.pr !== null) o.pr = Number(o.pr);
  if (o.gateStartEpoch !== null) o.gateStartEpoch = Number(o.gateStartEpoch);
  return o;
}

// Latest updatedAt minus earliest createdAt over completed runs; null when none.
// Throws TypeError on a completed run whose createdAt/updatedAt does not parse.
function computeCiWallMs(runs) {
  let min = Infinity;
  let max = -Infinity;
  for (const r of runs) {
    if (r.status !== 'completed') continue;
    const created = Date.parse(r.createdAt);
    const updated = Date.parse(r.updatedAt);
    if (Number.isNaN(created) || Number.isNaN(updated)) {
      throw new TypeError(`completed run ${r.databaseId} has an unparseable createdAt/updatedAt (${JSON.stringify(r.createdAt)}, ${JSON.stringify(r.updatedAt)})`);
    }
    if (created < min) min = created;
    if (updated > max) max = updated;
  }
  return min === Infinity ? null : max - min;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  now: () => Date.now(),
  gh: (args) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', windowsHide: true, timeout: CI_GATE_GH_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  })),
  appendEvent,
  resolveTarget,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function firstLine(err) {
  const text = String((err && err.stderr) || (err && err.message) || 'unknown error');
  return text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || 'unknown error';
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const fail = (code, message) => { deps.stderr(`ci-gate-record.js: ${message}\n`); return code; };
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.error) { deps.stderr(`ci-gate-record.js: ${o.error}\n` + USAGE); return 2; }
  for (const [flag, key, value] of [
    ['--pr', 'pr', '<n>'], ['--head-sha', 'headSha', '<sha>'], ['--verdict', 'verdict', '<verdict>'],
    ['--gate-start-epoch', 'gateStartEpoch', '<s>'], ['--run', 'run', '<run-dir>'],
  ]) {
    if (o[key] === null) { deps.stderr(`ci-gate-record.js: ${flag} ${value} is required\n` + USAGE); return 2; }
  }

  let target;
  try { target = deps.resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    return fail(3, String(err && err.message));
  }
  if (!target.ok) {
    if (target.reason === 'missing') return fail(3, `run dir does not exist: ${o.run}`);
    return fail(3, `run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }

  const ghArgs = ['run', 'list', '--commit', o.headSha, '--limit', '100', '--json', RUN_LIST_FIELDS, ...(o.repo ? ['--repo', o.repo] : [])];
  let stdout;
  try { stdout = deps.gh(ghArgs); } catch (err) {
    return fail(2, `gh run list failed: ${firstLine(err)}`);
  }
  let raw;
  try { raw = JSON.parse(stdout); } catch {
    return fail(2, 'gh run list output is not JSON');
  }
  if (!Array.isArray(raw)) return fail(2, 'gh run list output is not a JSON array');
  if (!raw.every(isPlainObject)) return fail(2, 'gh run list output holds an entry that is not an object');
  let ciWallMs;
  try { ciWallMs = computeCiWallMs(raw); } catch (err) {
    return fail(2, `gh run list output is unreadable: ${err.message}`);
  }

  const nowMs = deps.now();
  const runsReadAt = new Date(nowMs).toISOString();
  const data = {
    pr: o.pr,
    headSha: o.headSha,
    verdict: o.verdict,
    gateWaitMs: nowMs - o.gateStartEpoch * 1000,
    runsReadAt,
    runs: raw.map((r) => ({
      workflow: r.workflowName ?? null,
      event: r.event ?? null,
      status: r.status ?? null,
      createdAt: r.createdAt ?? null,
      startedAt: r.startedAt ?? null,
      updatedAt: r.updatedAt ?? null,
      attempt: r.attempt ?? null,
      conclusion: r.conclusion ?? null,
      databaseId: r.databaseId ?? null,
    })),
    ciWallMs,
  };
  if (o.verdict === 'timeout-park') data.pendingAtBound = true;

  deps.appendEvent(target.dir, 'ci-gate', data);

  const eventsPath = path.join(target.dir, 'events.jsonl');
  let text;
  try { text = deps.readFile(eventsPath); } catch (err) {
    return fail(3, `could not read ${eventsPath} to confirm the ci-gate event (${err && err.message})`);
  }
  const confirmed = String(text).split('\n').some((line) => {
    let ev;
    try { ev = JSON.parse(line); } catch { return false; }
    return isPlainObject(ev) && ev.type === 'ci-gate' && ev.pr === data.pr && ev.headSha === data.headSha
      && ev.verdict === data.verdict && ev.runsReadAt === runsReadAt;
  });
  if (!confirmed) return fail(3, `ci-gate event not confirmed in ${eventsPath}`);
  deps.stdout(eventsPath + '\n');
  return 0;
}

module.exports = {
  run, parseArgs, realDeps, computeCiWallMs, VERDICTS, RUN_LIST_FIELDS,
};

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
