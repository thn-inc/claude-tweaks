#!/usr/bin/env node
// bin/friction-events.js — single-invocation CLI for the reflect Friction
// Lens's ad-hoc-session fallback (#500, skills/reflect/full-mode.md's
// Friction Lens section).
//
// The lens's primary input is the current run's own events.jsonl. That is
// enough for a formal /claude-tweaks:build or /claude-tweaks:flow pipeline,
// which had a run dir from the start. An ad-hoc worktree dev session has no
// run dir until /claude-tweaks:wrap-up creates one for its own reflect
// pass — so friction incurred BEFORE that point would otherwise be
// invisible, even though bin/lib/hooks/post-tool-use.js's
// stampAdHocRunDir now stamps a lightweight run dir at EnterWorktree time
// specifically to catch it. This CLI is what reads that stamp back: it
// unions the primary run's events.jsonl with every OTHER non-terminal run
// dir recorded against the same worktree (bin/lib/hooks/context.js's
// findRunsByWorktreePath) — typically zero or one such ad-hoc dir, but
// never assumed to be at most one (a session can be interrupted more than
// once before ever reaching wrap-up).
// It also unions every non-terminal ad-hoc dir owned by the current session id
// whose worktree was removed (findAdHocRunsBySessionId skips a live one)
// (--session, default CLAUDE_CODE_SESSION_ID — a Bash-invoked CLI sees it,
// unlike a hook process): the ordinary ad-hoc order is ExitWorktree(remove)
// before wrap-up, after which the worktree-path match finds nothing (#2783).
// Each dir is read once even when both lookups return it.
//
// Usage: friction-events.js --run <run-dir> [--worktree <path>] [--session <id>] [--help]
// `--worktree` defaults to process.cwd() — the caller (reflect, running
// inside the worktree it's evaluating) does not usually need to pass it
// explicitly.
// Output: one JSON array on stdout, filtered to the event types
// skills/reflect/full-mode.md's friction-lens-vocab block declares the
// Friction Lens reads (`wd-deny`, `gate-denial`, `bookkeeping-stamp-deny`,
// `contract-violation`, `ask-user-question`, `wd-guard-refusal` (#2282),
// `zero-tool-use-verdict` (#2345) —
// bin/lib/friction-lens-vocab.js is the shared source of truth for that
// list, #2016). Every other event
// type the run logged (`commit`, `push`, `pre-compact`, `session-end`,
// `skill_invoked`, …) is dropped here rather than left for each lens run to
// re-filter. Each surviving element is the parsed events.jsonl entry plus
// `_source` ("primary" | "adhoc") and `_runDir` (which run dir it came
// from) — so the lens's Evidence line can name where a given finding was
// actually logged. Malformed lines are skipped, never thrown. Exit 0 on
// success (including an empty array — no events is not an error); 1 on a
// malformed invocation (missing --run); 2 when --run does not resolve to a
// real, readable directory.
//
// #2989: a run directory can be mkdir-only minted well before it is ever
// claimed by the pipeline that owns it -- events appended to its
// events.jsonl in that window are not this run's own operator experience
// (see computeClaimBoundary below for the full rationale and fail-open
// posture).
'use strict';

const fs = require('fs');
const path = require('path');
const ctxLib = require('./lib/hooks/context');
const { FRICTION_EVENT_TYPES } = require('./lib/friction-lens-vocab');

const FRICTION_TYPES = new Set(FRICTION_EVENT_TYPES);

const USAGE = 'usage: friction-events.js --run <run-dir> [--worktree <path>] [--session <id>] [--help]\n';

function parseArgs(argv) {
  const opts = { run: null, worktree: null, session: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--run') opts.run = argv[++i];
    else if (a === '--worktree') opts.worktree = argv[++i];
    else if (a === '--session') opts.session = argv[++i];
    else return { error: `unknown argument: ${a}` };
  }
  return opts;
}

// Reads one run dir's events.jsonl into an array of parsed objects, tagged
// with provenance. Missing file -> []; a malformed line is skipped rather
// than aborting the whole read (matches appendEvent's own best-effort
// posture — one bad line must never hide every good one).
//
// #1337 (widened #2282): a gate-denial or wd-guard-refusal event written by
// the test suite's own exercise of pre-tool-use.js's deny logic
// (CT_HOOKS_TEST_MODE — see that file's appendEvent calls) carries
// `test: true`. Those are dropped here rather than at the write site, so the
// underlying test that asserts the event IS written still sees it — only
// this aggregation-facing read excludes it, keeping a real operator denial
// (never tagged) unaffected.
//
// #1402: a `primary`-sourced event carrying `attribution: 'fallback'` is
// evidence context.js's own appendEvent doc comment says a reader "may [need
// to] filter on" — resolveRun's fallback guess (context.js) is now
// worktree-aware for every NEW write, but an events.jsonl written before
// that fix can still hold an older cross-worktree misattribution, and this
// CLI has no way to recover which worktree an already-written fallback event
// actually belongs to. Dropped here, defense-in-depth, rather than trusted:
// the Friction lens's own judgments (aggregate volume, avoidability) need
// this run's own evidence only, and ambiguous-provenance noise is worse for
// that than an undercount. `adhoc`-sourced events are unaffected — those
// already passed a worktree-binding check via findRunsByWorktreePath.
//
// #2350: a `contract-violation` event carrying `variant: 'lenient'` is, by
// subagent-stop.js's own two-tier design, a COMPLIANT reply (a dispatch
// template still using the pre-#2265 status-line shape) — logged only so a
// stale dispatch site stays visible for migration, never a real breach. The
// Friction lens counted every `contract-violation`-typed event identically,
// so a clean run using an old-shape template (e.g. superpowers'
// subagent-driven-development bullet) accumulated dozens of false friction
// hits. Dropped here, at the same read boundary as the #1337/#1402 filters
// above, rather than at the vocabulary filter in run() below, since this is
// about event fidelity (is this actually friction?), not event type.
//
// #2344: `variant: 'foreign-contract'` is the same shape of false positive —
// a reply belonging to ANOTHER dispatch site's own declared verdict
// vocabulary (APPROVED/NEEDS_FIXES/ADDRESSED/VERIFIED), not a real Subagent
// Contract breach. Dropped here on the identical precedent, so the aggregate
// `contract-violation` count the Friction lens judges is left holding only
// genuine (`variant: 'violation'`, or legacy events with no variant field at
// all) breaches.
// #2989: a run directory's own name carries its mint instant — the
// canonical `{YYYY-MM-DDTHHMMSS}-{slug}` run-id shape (the ISO-timestamp
// convention every mint site uses; see run-dir-resolution.md). Returns
// `null` — never a guess — when the basename doesn't match that shape, which
// covers every synthetic fixture directory this file's own tests build via
// a plain `mkdtemp` name.
function parseRunDirMintTime(runDir) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})-/.exec(path.basename(runDir));
  if (!m) return null;
  const [, day, hh, mm, ss] = m;
  const d = new Date(`${day}T${hh}:${mm}:${ss}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// #2989: the moment a run directory stops being a bare mkdir-only mint and
// becomes a pipeline's genuinely claimed run — `/claude-tweaks:flow`'s Step
// 2.8 claim, logged as decisions.md's own first entry, well before
// config.yml (written later still, by the Manifesto step — see
// skills/flow/claim-targets.md's ordering). decisions.md's first entry is
// therefore always the earlier, and the only locally-readable, signal of
// the two "real claim" markers #2989's own Acceptance Criteria names.
//
// #3442: the HH:MM:SS that decisions.md logs is the writer's LOCAL wall-clock
// time, not UTC (parseRunDirMintTime's mint instant stays UTC). The claim is
// therefore resolved against the mint's local calendar day, not a `Z` suffix.
//
// An event appended to events.jsonl with a `ts` earlier than this boundary
// did not come from this run's own pipeline — #2989's own incident found 9
// `ask-user-question` and 2 `contract-violation` entries about wholly
// unrelated work sitting in a run's events.jsonl, dated minutes before that
// run's own Manifesto ever ran, and read back later as if they were this
// run's own Friction Lens evidence.
//
// Deliberately fails OPEN — returns `null` (no filtering applied) — whenever
// either half of the window can't be positively established: an
// unrecognized directory name (parseRunDirMintTime above), or no
// decisions.md yet (still mid-mint, or a run this file's own tests construct
// without one). Only a run dir that positively matches both the mint-time
// shape and carries a readable claim entry gets the exclusion below.
function computeClaimBoundary(runDir) {
  const mint = parseRunDirMintTime(runDir);
  if (!mint) return null;
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return null; }
  const entry = /^- \S+ (\d{2}:\d{2}:\d{2}) —/m.exec(raw);
  if (!entry) return null;
  const [hh, mm, ss] = entry[1].split(':').map(Number);
  let claimed = new Date(mint.getFullYear(), mint.getMonth(), mint.getDate(), hh, mm, ss);
  if (Number.isNaN(claimed.getTime())) return null;
  // decisions.md logs HH:MM:SS only, never the date — if the computed
  // instant lands before the run's own mint (the claim actually happened
  // after a local midnight rollover from the mint day, #3442), it belongs
  // to the following local day instead.
  if (claimed < mint) claimed = new Date(mint.getFullYear(), mint.getMonth(), mint.getDate() + 1, hh, mm, ss);
  return claimed;
}

function readEvents(runDir, source) {
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'); } catch { return []; }
  const claimBoundary = computeClaimBoundary(runDir);
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object') continue;
      if ((parsed.type === 'gate-denial' || parsed.type === 'wd-guard-refusal') && parsed.test === true) continue;
      if (source === 'primary' && parsed.attribution === 'fallback') continue;
      if (parsed.type === 'contract-violation' && (parsed.variant === 'lenient' || parsed.variant === 'foreign-contract')) continue;
      if (claimBoundary) {
        const evTime = new Date(parsed.ts);
        if (!Number.isNaN(evTime.getTime()) && evTime < claimBoundary) continue; // #2989: pre-claim noise
      }
      out.push({ ...parsed, _source: source, _runDir: runDir });
    } catch { /* skip malformed line, keep reading */ }
  }
  return out;
}

const realDeps = {
  isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  cwd: () => process.cwd(),
  readEvents,
  findRunsByWorktreePath: ctxLib.findRunsByWorktreePath,
  sessionId: () => process.env.CLAUDE_CODE_SESSION_ID || null,
  findAdHocRunsBySessionId: ctxLib.findAdHocRunsBySessionId,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch the real
// filesystem — same seam as bin/resolve-blockers.js's run(argv, deps).
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 1; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!opts.run) { deps.stderr('missing required --run\n' + USAGE); return 1; }
  const runDir = path.resolve(opts.run);
  if (!deps.isDirectory(runDir)) { deps.stderr(`friction-events.js: --run ${opts.run} is not a directory\n`); return 2; }

  const worktreePath = opts.worktree ? path.resolve(opts.worktree) : deps.cwd();
  const events = deps.readEvents(runDir, 'primary');
  const seen = new Set();
  const siblings = deps.findRunsByWorktreePath(worktreePath, worktreePath, runDir) || [];
  // #2783: after ExitWorktree(remove) the worktree path above matches nothing;
  // the owning session id still finds the ad-hoc dir.
  const sessionId = opts.session || deps.sessionId();
  const bySession = sessionId ? (deps.findAdHocRunsBySessionId(deps.cwd(), sessionId, runDir) || []) : [];
  for (const { runDir: siblingDir } of [...siblings, ...bySession]) {
    if (seen.has(siblingDir)) continue;
    seen.add(siblingDir);
    events.push(...deps.readEvents(siblingDir, 'adhoc'));
  }
  const friction = events.filter((e) => FRICTION_TYPES.has(e.type));

  deps.stdout(`${JSON.stringify(friction)}\n`);
  return 0;
}

module.exports = { run, parseArgs, readEvents, FRICTION_EVENT_TYPES };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
