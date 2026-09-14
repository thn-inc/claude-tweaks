// bin/lib/hooks/session-start.js — A1: deps check + stale pipeline-run
// detection + advisory nudge toward worktree setup when the project's
// policy requires it.
'use strict';
const fs = require('fs');
const path = require('path');
const deps = require('../deps');
const ctxLib = require('./context');
const policy = require('../policy');
const wtDetect = require('./worktree-detect');
const runIntegrity = require('./run-integrity');
const { reconcile } = require('../reconcile');
const { DEFAULT_TTL_MS } = require('../reconcile/cache');
const portsEnsure = require('../ports/ensure');
const { BLOCK_SIZE: PORTS_BLOCK_SIZE } = require('../ports/registry');
const { INTERACTION_STYLE_DIRECTIVE } = require('./interaction-style');
const { resolvePluginVersion } = require('../plugin-version');

const MAX_REPORTED = 3;

// #1738: the one banner-assembly shape both advisory scans below build by
// hand today — a header sentence, the per-run "- name — detail" lines, and a
// templated trailer (one or more sentences, already newline-joined by the
// caller when there's more than one). Producing byte-identical output to the
// pre-extraction inline concatenation is the whole point: this is formatting
// only, never a behavior change.
function advisoryBanner(header, lines, trailer) {
  return `${header}\n${lines.join('\n')}\n${trailer}`;
}
// The fast/background split (#820, D8, corrected): SessionStart's own
// process runs only the cheap read/detect checks inline — everything
// write-only and janitorial (release/archive/archive-branches/remote-prune/
// reap) is deferred to a detached `reconcile-background` child process (see
// bin/hooks.js's `reconcile-background` subcommand), whose result is
// surfaced on a LATER SessionStart firing via the status-file read below.
// This corrects the original issue's premise (hooks.json's `async: true`
// discards a hook's stdout/JSON output entirely — unusable for a check
// whose whole point is to report what it did).
const FAST_CHECKS = ['mirror', 'red-tip', 'console'];

// #137: complements (never replaces) the seven-copy routine preamble
// paragraph (skills/_shared/routine-template-schema.md) that reports the
// resolved build in a routine firing's own *output* -- readable back from a
// transcript or filed issue later. This puts the same fact in every OTHER
// entry point's *context* instead (interactive session, /flow run, dispatched
// subagent) -- the agent knows it, even if it never says it out loud. Read
// unconditionally, not gated on differing from the marketplace catalog: this
// hook is a real Node process already running from the resolved plugin root,
// so CLAUDE_PLUGIN_ROOT is simply this process's own env, never a guess the
// way the preamble's multi-rung LLM-executed fallback ladder has to be for an
// agent reading its own context -- a catalog read here would add a network
// dependency to every session start for a diagnostic only ever consulted when
// something already looks wrong (decided, not left open, per the record's own
// Deliverables). `env` is injectable for tests; production omits it.
function resolveBuildLine(env = process.env) {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return null;
  // #1837 review finding: the plugin.json read/parse/extract this function
  // performed inline was its own copy of the same logic bin/harness-health.js
  // and bin/materialize.js each independently reimplemented too — now shared
  // via bin/lib/plugin-version.js. This function keeps owning its own
  // presentation (the formatted "claude-tweaks v{version} @ {root}" line);
  // it just no longer owns the filesystem read.
  const version = resolvePluginVersion(env);
  if (version === undefined) return null;
  return `claude-tweaks v${version} @ ${pluginRoot}`;
}

async function run(ctx) {
  const parts = [];
  // Per-invocation cache (#381): memoizes `git worktree list --porcelain` and
  // `resolveIntegrationBranch`'s resolved name, each keyed by repo root, so the
  // up-to-MAX_REPORTED checkRunIntegrity calls below and the trailing reconcile()
  // call share one spawn of each instead of one per call. Opt-in and scoped to this
  // single run(ctx) invocation — every other caller of these functions (direct unit
  // tests, /dispatch, /tidy, any other reconcile() caller) omits it and keeps
  // today's fresh-spawn-per-call behavior unchanged.
  const cache = { worktreeList: new Map(), integrationBranch: new Map() };
  // #1687: hoisted to the top of run() so both the inline reconcile() call
  // below AND the detached reconcile-background spawn (further down) can use
  // the same value — `ctx.input.session_id` is the hook payload's own session
  // id, reliably present here (unlike `process.env.CLAUDE_CODE_SESSION_ID`,
  // which bin/hooks.js's own header comment documents as not reliably present
  // for a hook-spawned process). Previously computed only inside the first
  // try block below, so the spawn block (a separate try block, further down)
  // had no access to it and the detached child never received a session id at
  // all — see that block's own comment for the fix this enables.
  const sessionId = typeof ctx.input === 'object' && ctx.input && typeof ctx.input.session_id === 'string' && ctx.input.session_id
    ? ctx.input.session_id
    : undefined;
  // #1909: injected once here instead of restated verbatim in every SKILL.md
  // (35+ byte-identical 501B copies) — the single source of truth is
  // interaction-style.js; docs/skill-authoring.md documents the convention.
  // Unconditional (never wrapped in try/catch or a feature gate): this is a
  // plain string push that cannot throw, and every session gets it regardless
  // of what else this hook finds to report.
  parts.push(INTERACTION_STYLE_DIRECTIVE);
  // #2070: single upstream read of CLAUDE_PLUGIN_ROOT, threaded into both
  // resolveBuildLine (below) and the stale-runs report line's fallback
  // (further down) — one place for a future normalization/validation fix to
  // land, instead of two reads that can drift.
  const pluginRootEnv = process.env.CLAUDE_PLUGIN_ROOT;
  try { parts.push(...deps.collect()); } catch { /* best-effort */ }
  try {
    const buildLine = resolveBuildLine({ CLAUDE_PLUGIN_ROOT: pluginRootEnv });
    if (buildLine) parts.push(buildLine);
  } catch { /* best-effort */ }
  try {
    // Only the newest MAX_REPORTED entries are ever shown — pull from the
    // lazy iterator and stop early instead of materializing (and reading
    // run-state.json for) every non-clean run dir under pipelines/, most of
    // which would just be sliced off and discarded.
    const stale = [];
    for (const entry of ctxLib.iterRunDirsWithState(ctx.cwd)) {
      stale.push(entry);
      if (stale.length >= MAX_REPORTED) break;
    }
    if (stale.length) {
      // Hoisted once and reused below — this expression was previously
      // computed twice (once per stale entry inside the .map, once here),
      // and each copy could only drift from the other.
      const pluginRoot = pluginRootEnv || '${CLAUDE_PLUGIN_ROOT}';
      // This stale-runs block running BEFORE the reaper block is load-bearing
      // ordering: the reaper removes merged worktrees, which breaks branch
      // derivation for the integrity check.
      const lines = stale.map(({ dir, state }) => {
        // #410: read-only — the URL run-state.json already recorded, never a
        // fresh gh call from this hot path. Absent for local-merge runs and
        // any pr-first run whose run-start push/create degraded.
        const prSuffix = state && state.pr && state.pr.url ? ` — PR ${state.pr.url}` : '';
        const base = `- ${path.basename(dir)} (status: ${(state && state.status) || 'unknown'})${prSuffix}`;
        try {
          const verdict = runIntegrity.checkRunIntegrity(dir, { cache });
          if (verdict.state === 'shipped-unclosed') {
            // Evidence names what was checked so the reader can judge the claim.
            const how = verdict.evidence.merged === 'cherry' ? 'squash/rebase-equivalent' : 'merged';
            return (
              `${base} — work appears shipped (branch ${verdict.evidence.branch} ${how} into the integration branch, ` +
              'no wrap-up recorded): close out with /claude-tweaks:wrap-up, or bookkeeping-only: ' +
              `node "${pluginRoot}/bin/hooks.js" close-run --run "${dir}"`
            );
          }
        } catch { /* integrity check is advisory — never break the scan */ }
        return base;
      });
      // #803: the banner previously had no designated consumer — a session could
      // receive it and never triage or relay it. This trailing sentence is that
      // consumer: an explicit, model-facing instruction (same pattern as the
      // worktree-always banner below) to relay the list once, in the session's
      // first reply, rather than leaving detection with no assigned follow-through.
      parts.push(advisoryBanner(
        'claude-tweaks: unfinished pipeline run(s) detected under .claude-tweaks/pipelines/:',
        lines,
        `Review {run}/decisions.md and staged/ to resume, or close a finished run with: node "${pluginRoot}/bin/hooks.js" close-run --run <dir>\n` +
          'Relay this list once, in your first reply to the user, one line per run naming its close-run command — do not proceed silently without mentioning it.\n' +
          'Say with it that only the session owning a run should close it: a listed run may be live in a sibling session right now, and closing it ends that run enforcement and event logging mid-flight.',
      ));
    }
  } catch { /* best-effort */ }
  try {
    // #1493 AC5 (spec-1493, filed alongside #803 — the SAME designated
    // consumer this file's stale-run block above already names): a
    // standalone run (name matches `*-standalone`, the archival-compaction
    // naming convention `step-6-auto.md` already uses) can finish cleanly and
    // STILL carry human-facing work — un-actioned proposals under `staged/`
    // (a `--dry-run` preview, or a staged-but-never-approved tidy firing).
    // `_shared/pipeline-run-dir.md`'s run-dir layout section names exactly
    // one terminal status value: "run-state.json (hook-maintained
    // status/worktree assignment; terminal = status `clean`)" — that is the
    // ONLY cleanly-finished value used anywhere in this codebase (verified:
    // no other terminal status string, e.g. "complete", is ever written to
    // run-state.json), so this checks for it by name rather than "anything
    // other than interrupted", which would silently also match a future or
    // unrecognized status value.
    //
    // This is a SEPARATE scan from the stale-runs block above, not a branch
    // inside it: the opposite status signal matters here — clean AND
    // non-empty `staged/` — where the stale-runs block above wants
    // interrupted/still-live runs. #1738 gave the shared iterator an opt-in
    // `{ status: 'clean' }` filter for exactly this shape, so this scan now
    // shares that iterator's anchor, ordering, archive-twin skip, and
    // `archiving`-claim skip instead of hand-rolling a second directory walk
    // (the gap the iterator's default exclude-clean behavior used to force).
    //
    // Only a `*-tidy-standalone*` run dir — or, since sweep's shared run dir
    // (#1494), a `*-sweep-standalone*` one, whose Step 1 runs tidy inside it
    // and stages the same residue shape — is `tidy --approve`-resolvable
    // (`approve-mode.md`'s own glob match) — narrowed from the earlier
    // `endsWith('-standalone')` match, which also matched every OTHER
    // standalone-auto skill's run dir (`-init-standalone`, `-capture-standalone`,
    // etc.), none of which `tidy --approve` can ever resolve or apply.
    //
    // Capped at MAX_REPORTED via an early-break for-loop, mirroring the
    // stale-runs block three lines up (this file's own precedent, whose
    // own comment a few lines above prescribes exactly this lazy pattern).
    // The break is on `approvable.length` (entries that passed BOTH the name
    // test and the non-empty `staged/` read), not on iteration count — it
    // counts approvable entries, not candidates.
    const approvable = [];
    for (const { dir } of ctxLib.iterRunDirsWithState(ctx.cwd, { status: 'clean' })) {
      if (!/-(tidy|sweep)-standalone/.test(path.basename(dir))) continue;
      let staged;
      try { staged = fs.readdirSync(path.join(dir, 'staged')); } catch { continue; }
      if (!staged.length) continue;
      approvable.push(dir);
      if (approvable.length >= MAX_REPORTED) break;
    }
    if (approvable.length) {
      const lines = approvable.map(
        (dir) => `- ${path.basename(dir)} — staged proposal(s) awaiting approval: /claude-tweaks:tidy --approve "${dir}"`,
      );
      // #1493/#803: the same designated-consumer relay directive the
      // stale-runs banner above already carries — without it this banner
      // reproduces #803's original defect (detected, never assigned a
      // follow-through).
      parts.push(advisoryBanner(
        'claude-tweaks: standalone run(s) finished with unapproved staged proposal(s) under staged/:',
        lines,
        'Review and apply with /claude-tweaks:tidy --approve <dir>, or clear staged/ to dismiss.\n' +
          'Relay this list once, in your first reply to the user, one line per run naming its tidy --approve command — do not proceed silently without mentioning it.',
      ));
    }
  } catch { /* best-effort */ }
  try {
    // reconcile() resolves the shared main checkout internally the same way
    // the pre-#408 direct reaper.reapWorktrees call did (mainCheckoutRoot,
    // never repoInfo().repoRoot — see `_shared/integration-branch.md`'s named
    // anti-pattern for why a linked worktree's own HEAD must never stand in
    // for the shared trunk). FAST_CHECKS restricts this inline call to the
    // cheap read/detect checks only (mirror, red-tip, console) — the
    // write-only janitorial checks (release/archive/archive-branches/
    // remote-prune/reap) run in a detached background process instead (see
    // the spawn block below), and their results are surfaced on a LATER
    // SessionStart firing via the status-file read below, not here (#820,
    // D8, corrected).
    //
    // `skipIfFresh` (#820, D7) makes near-simultaneous session starts in the
    // same repo cost nothing at all: the second and later ones inside the TTL
    // short-circuit before any git/gh I/O. This project's real operating
    // pattern — many concurrent worktree sessions against one main checkout —
    // is exactly the case D7 exists for, and this inline pass is the hot path
    // #820 is about. The deliberate tradeoff is accepted staleness: for up to
    // DEFAULT_TTL_MS, a session start may not observe a mirror fast-forward,
    // a newly-red tip, or a newly-answered console. The background pass is
    // NOT gated on this same stamp — it keys off
    // reconcile-background-status.json's own `completedAt` (see the spawn
    // block below and its comment for why conflating the two was a bug).
    // `sessionId` (hoisted to the top of run(), above) is the hook payload's
    // own session id — the same field hooks.js's dispatcher already reads for
    // `ownedRun` (`ctxLib.resolveRun(cwd, process.env, input.session_id)`).
    // FAST_CHECKS never includes 'archive' (see this file's own constant
    // above), so passing it here has no effect on archive-merged.js's
    // ownership gate today — that check only ever runs off the detached
    // `reconcile-background` child process (spawned below), which now
    // receives this same session id via its spawn environment instead of
    // having none to thread through at all (#1687). Passed here anyway for
    // correctness: this is the one call site in this file that actually calls
    // reconcile() inline, and a real session id is genuinely reachable at it.
    const result = await reconcile({
      cwd: ctx.cwd, checks: FAST_CHECKS, skipIfFresh: true, ttlMs: DEFAULT_TTL_MS, cache, sessionId,
    });

    // One added summary line for what the fast path did — today just mirror
    // ff, the only FAST_CHECKS member that ever populates it. The write-only
    // checks that used to contribute to this same line (claim releases,
    // run-dir archival, branch/remote-branch pruning) moved to the
    // background pass and are surfaced separately below.
    const summary = [];
    if (result.mirror && result.mirror.action === 'fast-forwarded') {
      summary.push('integration branch fast-forwarded to origin');
    }
    if (summary.length) {
      parts.push(`claude-tweaks: reconciled — ${summary.join('; ')}.`);
    }
    // #561: an unconditional, inform-tier line when reconcile() detected a
    // failing CI conclusion on the integration branch's tip — the only
    // coverage for direct pushes (fast-lane commits, bookkeeping, releases)
    // that no merge gate ever sees. Not gated on any policy value; silent
    // when result.redTip is null (green, pending, no CI, gh absent, or any
    // API error — red-tip.js's own degrade posture).
    if (result.redTip) {
      parts.push(`claude-tweaks: ${result.redTip.message}`);
    }
    // #413: a console whose "Resolve console" box is already ticked on the
    // PR is answered-but-unexecuted work — surface it the same way an
    // unfinished pipeline run is surfaced above, pointing at the procedure
    // (`_shared/console-execution.md`) rather than executing here: several
    // item kinds are judgment-bearing and only an agent session can run
    // them (see that file's header).
    const readyConsoles = (result.console && result.console.ready) || [];
    if (readyConsoles.length) {
      parts.push(
        `claude-tweaks: ${readyConsoles.length} answered console(s) awaiting execution:\n` +
          readyConsoles.map((c) => `- ${path.basename(c.runDir)} — PR #${c.prNumber}`).join('\n') +
          '\nRead skills/_shared/console-execution.md and execute per its Execution routing.',
      );
    }
  } catch { /* best-effort */ }
  // Surface a PRIOR session's background reconcile pass exactly once, then
  // decide whether to spawn a new one (#820, D8). Both read the same status
  // file the background pass (bin/hooks.js's `reconcile-background`
  // subcommand, spawned below) writes — but they sit in SEPARATE try blocks
  // on purpose: sharing one meant a throw while rendering the summary (a
  // malformed `notableWorktrees[].path`, say) skipped the spawn decision
  // entirely and never reset, wedging the background pass off permanently
  // for that repo — every later SessionStart throwing at the same line
  // before ever reaching the gate (#820 final review). The read is cheap and
  // is simply done once per block rather than shared across them.
  const bgStatusPath = (() => {
    try {
      const root = wtDetect.mainCheckoutRoot(ctx.cwd);
      return root ? path.join(root, '.claude-tweaks', 'reconcile-background-status.json') : null;
    } catch { return null; }
  })();
  function readBgStatus() {
    try { return JSON.parse(fs.readFileSync(bgStatusPath, 'utf8')); } catch { return null; }
  }
  try {
    if (bgStatusPath) {
      const status = readBgStatus();

      // Surface once — `surfaced` flips to true the first time a
      // SessionStart firing reports it, so a summary from three sessions
      // ago doesn't reappear on every subsequent session start.
      if (status && status.surfaced === false) {
        const s = status.summary || {};
        const lines = [];
        if (s.reaped) lines.push(`${s.reaped} finished worktree(s) removed (already merged)`);
        if (s.released) lines.push(`${s.released} issue claim(s) released`);
        if (s.archived) lines.push(`${s.archived} pipeline run(s) archived`);
        if (s.archivedBranches) lines.push(`${s.archivedBranches} local branch(es) archived/deleted`);
        if (s.prunedRemote) lines.push(`${s.prunedRemote} merged remote branch(es) deleted on origin`);
        // Individually-named worktrees left in place and why — the same
        // granular signal the pre-#820-D8 inline block used to render,
        // pre-filtered by the background CLI through QUIET_SKIP_REASONS so
        // routine/expected skips stay quiet here too.
        if (Array.isArray(s.notableWorktrees) && s.notableWorktrees.length) {
          lines.push(
            `worktree(s) left in place: ${s.notableWorktrees.map((w) => `${path.basename(w.path)} (${w.reason})`).join(', ')}`,
          );
        }
        if (lines.length) {
          parts.push(`claude-tweaks: background reconcile (from a prior session) — ${lines.join('; ')}.`);
        }
        try {
          fs.writeFileSync(bgStatusPath, JSON.stringify({ ...status, surfaced: true }));
        } catch { /* best-effort */ }
      }
    }
  } catch { /* best-effort */ }
  try {
    if (bgStatusPath) {
      // Re-read rather than reuse the surfacing block's copy: the two blocks
      // are deliberately independent (see the comment above them), so this
      // gate must not depend on that block having reached its own read.
      const status = readBgStatus();

      // Spawn the detached background pass — TTL-gated by THIS status
      // file's own `completedAt`, deliberately never reconcile()'s shared
      // reconcile-cache.json `lastRunAt` stamp: that stamp fires on ANY
      // fully-completed pr-first pass, including the FAST_CHECKS call just
      // above in this same function, which would make this gate see a
      // false "fresh" from a pass that never ran the background checks at
      // all and never spawn (#820 Task 10 fix-up, caught by task review).
      // `detached: true` + `stdio: 'ignore'` + `child.unref()` together let
      // this process exit without waiting on the child, and without the
      // child dying alongside it.
      const { isFresh } = require('../reconcile/cache');
      const fresh = isFresh(
        { lastRunAt: status && typeof status.completedAt === 'number' ? status.completedAt : null },
        Date.now(),
      );
      if (!fresh) {
        try {
          const { spawn } = require('child_process');
          // #1687: thread this session's id into the detached child's
          // environment so `bin/hooks.js`'s `reconcile-background` subcommand
          // can pass it to `reconcile({ ..., sessionId })`, which is what
          // makes archive-merged.js's `isAbandonedInterrupted` ownership gate
          // actually engage on this path — before this fix the child had no
          // session id at all, reachable via neither an argv nor an env value,
          // so the gate was permanently inert here (the path that runs the
          // 'archive' check in production). A dedicated `CLAUDE_TWEAKS_`-
          // prefixed var, not `CLAUDE_CODE_SESSION_ID`: the child inherits
          // this process's env either way, and if that harness-set var were
          // reliably present here this record wouldn't exist (see this file's
          // header comment and #1687's own body). Only set when a real
          // session id is known — an absent key means "unresolvable", matching
          // reconcile-background's read-side fallback (`|| undefined`).
          const spawnEnv = sessionId ? { ...process.env, CLAUDE_TWEAKS_SESSION_ID: sessionId } : process.env;
          const child = spawn(
            process.execPath,
            [path.join(__dirname, '..', '..', 'hooks.js'), 'reconcile-background'],
            // `windowsHide: true` is load-bearing alongside `detached: true`:
            // detaching is what leaves the child with no inheritable console,
            // and without the flag Windows gives it a VISIBLE one — as it
            // then does for every git process this background pass spawns
            // beneath it. See tests/hooks-git-exec.test.js for the funnel.
            { cwd: ctx.cwd, detached: true, stdio: 'ignore', windowsHide: true, env: spawnEnv },
          );
          // spawn() returns an EventEmitter, and an ASYNCHRONOUS spawn
          // failure (EAGAIN under fork pressure — routine in a repo running
          // many concurrent agent sessions) emits 'error' after this
          // synchronous block has already returned. With no listener Node
          // promotes that to an uncaught exception, which neither the
          // surrounding try/catch (already exited) nor bin/hooks.js's
          // top-level promise `.catch()` can absorb — it would take down the
          // whole SessionStart hook process, breaking the never-break-a-
          // session invariant. A no-op listener degrades it to exactly what
          // a synchronous spawn failure already does here: this session's
          // background pass simply didn't fire, and the next one retries.
          child.on('error', () => { /* see above — silent degrade, never a throw */ });
          child.unref();
        } catch { /* best-effort — a failed spawn just means this session's background pass didn't fire; the next one tries again */ }
      }
    }
  } catch { /* best-effort */ }
  try {
    // Cheap fs-only pre-check: if no policy.yml exists anywhere in the
    // ancestor chain, there is definitely nothing to enforce — skip forking
    // git entirely for the overwhelming majority of projects that never opt
    // into this policy. Same fast-reject pre-tool-use.js's own copy of this
    // check already applies for the same reason; this file's copy
    // previously forked git on every single SessionStart regardless.
    if (wtDetect.findPolicyFile(ctx.cwd)) {
      const { repoRoot, isLinkedWorktree } = wtDetect.repoInfo(ctx.cwd);
      if (repoRoot) {
        const { on, matchedKey } = policy.resolveWorktreeAlways(repoRoot);
        parts.push(
          `claude-tweaks: worktree-always: ${on ? 'ON' : 'OFF'} (${matchedKey ? `matched key: ${matchedKey}` : 'no key'})`,
        );
        if (on && !isLinkedWorktree) {
          parts.push(
            'claude-tweaks: this project requires an isolated worktree for all work ' +
              '(policy: worktree-always in .claude-tweaks/policy.yml). Before making any edits, ' +
              'invoke /superpowers:using-git-worktrees to set one up, then follow ' +
              "`_shared/worktree-setup.md`'s post-creation catch-up before any other action.",
          );
        }

        // #1792: turns Unit 1's registry on for this checkout. Reuses the
        // repoRoot already resolved above rather than forking git a second
        // time for the same answer. `port-services` is not an auto-mode
        // lever (no Manifesto question — see that record's Non-Goals), so
        // this reads policy.yml directly, the same way the worktree-always
        // verdict above does.
        const { services, invalidNames, overCapacity, requestedCount } = policy.resolvePortServices(repoRoot);
        for (const name of invalidNames) {
          parts.push(`claude-tweaks: ports — invalid service name '${name}' ignored (services must match ^[a-z][a-z0-9-]*$)`);
        }
        if (overCapacity) {
          parts.push(
            `claude-tweaks: ports — port-services lists ${requestedCount} services, more than one block ` +
              `(${PORTS_BLOCK_SIZE}) can hold; port isolation is off for this session`,
          );
        } else if (services.length) {
          try {
            const result = await portsEnsure.ensure(ctx.cwd, { policyServices: services });
            if (result.active) {
              const range = `${result.base}-${result.base + result.ports.length - 1}`;
              // #1927: CLAUDE_TWEAKS_LEASE rides in vars for the env file, not in this line (#1792 AC3's shape).
              const vars = result.vars
                .filter(([k]) => k === 'PORT' || k.endsWith('_PORT'))
                .map(([k, v]) => `${k}=${v}`).join(' ');
              // Reallocation moves URLs — this line must never be silent
              // (see #1792's Gotchas: "never make the reallocation silent").
              parts.push(result.reallocated
                ? `claude-tweaks: ports REALLOCATED ${result.reallocated.from}→${result.reallocated.to} — ` +
                  `a foreign process took the old block; URLs moved: ${range} (${vars})`
                : `claude-tweaks: ports ${range} (${vars})`);
              if (typeof result.envWriteError === 'string' && result.envWriteError) {
                const envPluginRoot = pluginRootEnv || '${CLAUDE_PLUGIN_ROOT}';
                parts.push(
                  `claude-tweaks: ports — env file write failed (${result.envWriteError}); the lease is ` +
                    `recorded in the registry, re-run node "${envPluginRoot}/bin/ports.js" env after fixing the file`,
                );
              }
            }
          } catch (err) {
            parts.push(`claude-tweaks: ports ensure failed — ${(err && err.message) || err}`);
          }
        }
      }
    }
  } catch { /* best-effort */ }
  if (!parts.length) return {};
  return { json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') } } };
}

module.exports = { run, FAST_CHECKS, resolveBuildLine };
