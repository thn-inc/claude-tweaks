// bin/lib/hooks/run-dir-resolve.js — pure resolver behind
// `node bin/hooks.js resolve-run-dir` (#692).
//
// Implements _shared/run-dir-resolution.md's resolution order (env var with
// adoption-time anchoring check -> newest matching directory -> standalone
// fallback) on top of worktree-detect.js's mainCheckoutRoot(), so a skill step
// gets the anchored $RUN_ROOT/run directory back as a single command instead of
// composing it from `git rev-parse --git-common-dir` inline. That composition
// is exactly how #692's incident happened: a relative `.claude-tweaks/pipelines/…`
// read from inside a worktree silently created/used a worktree-local shadow,
// splitting run state across two locations ([IL-127]).
//
// `run-dir-resolution.md`'s Bash snippet stays as the reference implementation
// this module mirrors — except that step 2 here also refuses an unadoptable
// match (`adoptionRefusal`, #1962/#4151), which the snippet does not. Every
// call site should cite this command instead of restating that snippet.
//
// Deliberately loud where the shared resolution algorithm (as consumed by a
// skill adopting $PIPELINE_RUN_DIR) is deliberately quiet: that algorithm
// treats a worktree-trapped env var as "stale, fall through" so a skill can
// keep going. This command exists specifically to CATCH that shape, so it
// fails loud instead — see the header comment on `resolve` below.
'use strict';
const fs = require('fs');
const path = require('path');
const wtDetect = require('./worktree-detect');
const { escapeRegExp } = require('../shared-primitives');

function safeReal(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

// Run dirs are named as ISO-timestamp-prefixed slugs (e.g. 2026-07-01T090000-spec-1).
// Other siblings under pipelines/ — notably archive/, the wrap-up archival
// destination — are not runs. archive/ sorts AFTER ISO names lexically, so an
// unfiltered .sort().reverse() would rank it first and shadow live runs (#848, #2870).
const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T/;

// ISO-timestamp-prefixed run-dir naming: YYYY-MM-DDTHHMMSS (no colons —
// portable across filesystems), matching run-dir-resolution.md's SPEC_SLUG
// conventions and every hand-written snippet this module replaces.
function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function fail(reason, message) {
  return { ok: false, path: null, created: false, reason, message };
}

function ok(dir, created) {
  return { ok: true, path: dir, created: !!created, reason: null, message: dir };
}

// #208: archived-is-terminal invariant. `{run-id}` is never written to again once
// `archive/{run-id}/` exists — checked at this module's one writer chokepoint rather than
// reconciling two copies on every read. Returns 'archived' | 'not-archived' | 'unknown' — the
// last only when the read itself failed for a reason other than "doesn't exist" (a permission
// error, e.g.). Every caller below treats 'unknown' exactly like 'not-archived' — fails OPEN,
// same posture as every other ambiguity in this file: a genuinely unfinished/creatable run must
// never be silently suppressed by an unrelated read failure (this record's AC4).
function archiveStatus(pipelinesRoot, runId) {
  if (!runId) return 'not-archived';
  try {
    const st = fs.statSync(path.join(pipelinesRoot, 'archive', runId));
    return st.isDirectory() ? 'archived' : 'not-archived';
  } catch (e) {
    return e && e.code === 'ENOENT' ? 'not-archived' : 'unknown';
  }
}

// Adoption preconditions, not a liveness verdict (#1962, #4419): an adopted run needs a live
// status — `interrupted` is an explicit can't-resume stamp — and, when `active`, its recorded
// worktree on disk. `runLiveness` is deliberately not consulted here: a `dead` verdict on an
// `active` run is the crash-resume (owner pid gone) or long-idle (legacy 72h) case, and both
// must stay adoptable (#3979 red-team, #4419). Adopting an unresumable dir inherits a closed PR
// number, a stale config.yml, stale staged/ items and a foreign claim runId (observed 3 times in
// one dispatch firing — #1962's own Current State). `state` is the plain object
// `adoptionRefusal` below has already validated.
function unresumableState(state) {
  if (state.status === 'interrupted') return true;
  if (state.status === 'active' && typeof state.worktree === 'string' && state.worktree) {
    return !fs.existsSync(state.worktree);
  }
  return false;
}

// #4151 (moved out of `/claude-tweaks:release`'s inline adoption guard, #3898): why step 2
// must not adopt `dir`, or null when it may. Order: an unreadable run-state.json (a read
// error other than ENOENT, a JSON.parse failure, or a value that is not a plain object — a
// crash or truncated write must never read as "adopt"), a `createdBy: release-standalone`
// directory, a terminal status (any string outside run-integrity's NON_TERMINAL), then the
// #1962 unresumable check (`unresumableState` above). An ABSENT run-state.json stays adoptable
// (a bare mkdir-only mint), and a missing or non-string status is not terminal. Step 1's
// PIPELINE_RUN_DIR never reaches this.
function adoptionRefusal(dir) {
  // Lazy: run-integrity -> context.js -> this module is a load-time cycle if required at the top.
  const { NON_TERMINAL } = require('./run-integrity');
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8'));
  } catch (e) {
    return e && e.code === 'ENOENT' ? null : 'unreadable-run-state';
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'unreadable-run-state';
  if (state.createdBy === 'release-standalone') return 'release-standalone';
  if (typeof state.status === 'string' && !NON_TERMINAL.has(state.status)) return 'terminal';
  if (unresumableState(state)) return 'dead';
  return null;
}

// True when `slug` occurs in `name` as a whole `-`-delimited segment: bounded on
// the left by `-` (or start of name) and on the right by `-` (or end of name).
// `spec-378` matches `…-spec-378`, `…-spec-378-standalone`, `…-spec-378-379`,
// never `…-spec-3784`.
function hasSegment(name, slug) {
  return new RegExp(`(^|-)${escapeRegExp(slug)}(?=-|$)`).test(name);
}

// Step 2 (`_shared/run-dir-resolution.md`'s resolution order): the most recent
// directory under `{pipelinesRoot}` whose name contains `specSlug` as a whole
// segment (`hasSegment` above, #3865), matching the reference snippet's
// segment-glob `find ... | grep canonical | sort | tail -n 1` — except that an
// unadoptable candidate (`adoptionRefusal` above: unresumable per #1962, terminal,
// release-standalone or unreadable per #4151) is skipped in favor of the
// next-newest match, rather than being adopted as-is. A non-canonical name
// (`RUN_ID_RE` above) is never a candidate at all, as in the snippet: a plain
// `sort` lets `20260911T…` outrank every `2026-MM-DDT…` name forever (#2870).
function newestMatch(pipelinesRoot, specSlug) {
  let entries;
  try { entries = fs.readdirSync(pipelinesRoot, { withFileTypes: true }); } catch { return null; }
  const names = entries
    .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name) && hasSegment(e.name, specSlug))
    .map((e) => e.name)
    .sort();
  for (let i = names.length - 1; i >= 0; i -= 1) {
    const dir = path.join(pipelinesRoot, names[i]);
    if (adoptionRefusal(dir) === null) return dir;
  }
  return null;
}

// opts: { cwd, env, specSlug, mode, standalone, create, rootOnly, now }
function resolve(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || {};
  const now = opts.now || new Date();

  const mainRoot = wtDetect.mainCheckoutRoot(cwd);
  if (!mainRoot) {
    return fail(
      'no-repo',
      `could not determine the git repository root from ${cwd} — not a git repo, ` +
      'or git/the .git file could not be read. resolve-run-dir refuses to guess.',
    );
  }

  // --root-only: just the anchored main-checkout root, no run resolution at
  // all. For call sites that only ever needed $RUN_ROOT itself (a `find`
  // backstop scoped to the whole pipelines/ tree, the wrap-up transitional
  // copy-out guard's DEST computation), not a specific run's directory.
  if (opts.rootOnly) return ok(mainRoot, false);

  const pipelinesRoot = path.join(mainRoot, '.claude-tweaks', 'pipelines');

  // Step 1: PIPELINE_RUN_DIR env var, with the adoption-time anchoring check.
  const envVal = typeof env.PIPELINE_RUN_DIR === 'string' && env.PIPELINE_RUN_DIR ? env.PIPELINE_RUN_DIR : null;
  if (envVal) {
    const real = safeReal(envVal);
    if (real) {
      if (wtDetect.isAnchoredUnderRoot(real, mainRoot)) {
        // #208: a resurrected copy of an already-archived run-id — the env var was resolved
        // before archival and the directory has since reappeared underneath it (a hook write
        // racing archival, or any other resurrection path). Archived is terminal: never adopt
        // it back as live. This is not the [IL-127] shadow-env failure below (the path IS
        // correctly anchored) — fall through exactly like a stale/missing env var instead of
        // failing loud, since there is a legitimate next step (Step 2/create) to fall through to.
        if (archiveStatus(pipelinesRoot, path.basename(real)) !== 'archived') {
          return ok(real, false);
        }
      } else {
        // Exists, but resolves OUTSIDE the main checkout — this is the #692/
        // [IL-127] shape: adopting it would use (or create) a worktree-local
        // shadow of the run's audit trail. Fail loud rather than falling
        // through silently, naming what it actually is when we can tell.
        const info = wtDetect.repoInfo(real);
        const shadowNote = info.isLinkedWorktree
          ? `resolves inside a linked worktree (${info.repoRoot}) instead of the main checkout — a shadow copy`
          : `does not resolve under the main checkout root (${mainRoot})`;
        return fail(
          'shadow-env',
          `PIPELINE_RUN_DIR=${envVal} ${shadowNote}. This is exactly the failure ` +
          `_shared/pipeline-run-dir.md's Anchoring section exists to prevent ([IL-127]) — refusing to use it. ` +
          `Unset PIPELINE_RUN_DIR or point it at a directory under ${mainRoot}, then retry.`,
        );
      }
    }
    // Set but nothing exists there at all — stale, not dangerous. Fall
    // through to step 2 exactly like an unset var (matches the reference
    // snippet's `[ -d "$RUN_DIR" ] || RUN_DIR=""`).
  }

  // Step 2: newest matching directory under the main checkout.
  //
  // #2838: skipped entirely for a mint-only `--create` call (one naming
  // `--spec-slug` with no `--standalone`) — the plain mkdir-only mint shape
  // `/claude-tweaks:dispatch` Step 4, `flow/claim-targets.md`'s
  // direct-invocation mint, and `flow/steps-and-gates.md` case 5's creation
  // path all use, every one of them reaching this call specifically because
  // no existing run directory should be adopted (case 5's own cases 1-4
  // already ruled that out upstream). Without this guard, Step 2 adopted
  // whatever same-slug directory happened to exist — including one a live
  // sibling session had minted seconds earlier — defeating the caller's own
  // "create fresh" intent and handing two sessions the same run dir and
  // worktree. A `--standalone` call (release/wrap-up/sweep/specify's
  // standalone-auto mints) is unaffected — the `-standalone` suffix already
  // names a distinct directory shape, and those callers are not in scope
  // here. A read-only resolution call (no `--create` at all) is also
  // unaffected — it keeps today's adopt-newest-matching behavior exactly.
  if (opts.specSlug && !(opts.create && !opts.standalone)) {
    const match = newestMatch(pipelinesRoot, opts.specSlug);
    // #208: same invariant as Step 1 — never reuse a live directory whose run-id already has
    // an archived counterpart (a resurrected copy). Fall through to create/fail below instead.
    if (match && archiveStatus(pipelinesRoot, path.basename(match)) !== 'archived') return ok(match, false);
  }

  // Standalone-fallback-shaped creation. Never runs unless --create was
  // explicitly passed.
  if (opts.create) {
    // `--mode`, when GIVEN, gates creation to auto mode only — mirroring
    // resolution-order step 4's "AND the skill is running in auto mode"
    // clause for the standalone-auto allowlist (/tidy, /init, /capture,
    // /claude-tweaks:dispatch, /claude-tweaks:backlog, /claude-tweaks:specify,
    // /claude-tweaks:sweep).
    // When `--mode` is OMITTED entirely, no such gate applies — that is the
    // two documented exceptions' path (run-dir-resolution.md resolution order
    // step 4's own clauses): wrap-up and /claude-tweaks:release each create a
    // standalone run dir in *every* mode, not only auto, because wrap-up's
    // Review Console and release's Step 4 console / release-held.md staging
    // each run in every mode. Callers on the standalone-auto allowlist pass
    // `--mode auto` themselves (only once they have already confirmed auto
    // mode); wrap-up and release pass neither.
    if (opts.mode && opts.mode !== 'auto') {
      return fail(
        'mode-not-auto',
        `--mode ${opts.mode} given — standalone creation only proceeds in auto mode ` +
        '(omit --mode entirely for a caller that creates in every mode, e.g. wrap-up).',
      );
    }
    if (opts.standalone) {
      // The step-4 standalone-auto-fallback shape: {ts}-{name}-standalone,
      // pre-populated with decisions.md and staged/ — byte-for-byte what the
      // reference snippet's own standalone branch does.
      const dir = path.join(pipelinesRoot, `${formatTimestamp(now)}-${opts.standalone}-standalone`);
      // #208: never (re-)create a run-id that already exists under archive/ — archived is
      // terminal. Checked immediately before the mkdir, the one writer chokepoint.
      if (archiveStatus(pipelinesRoot, path.basename(dir)) === 'archived') {
        return fail(
          'archived-run-id',
          `run-id ${path.basename(dir)} already exists under archive/ — archived is terminal, ` +
          'refusing to recreate a live copy of it.',
        );
      }
      fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
      try { fs.closeSync(fs.openSync(path.join(dir, 'decisions.md'), 'a')); } catch { /* best-effort touch */ }
      return ok(dir, true);
    }
    if (opts.specSlug) {
      // The plain mint shape /flow (steps-and-gates.md case 4), /dispatch
      // (SKILL.md Step 4), and /claude-tweaks:flow's claim-targets.md use:
      // mkdir only. config.yml/decisions.md are written later, by whichever
      // step actually initializes the run (the Config Manifesto), not by
      // this mint.
      const dir = path.join(pipelinesRoot, `${formatTimestamp(now)}-${opts.specSlug}`);
      // #208: same archived-is-terminal guard as the standalone branch above.
      if (archiveStatus(pipelinesRoot, path.basename(dir)) === 'archived') {
        return fail(
          'archived-run-id',
          `run-id ${path.basename(dir)} already exists under archive/ — archived is terminal, ` +
          'refusing to recreate a live copy of it.',
        );
      }
      fs.mkdirSync(dir, { recursive: true });
      return ok(dir, true);
    }
    return fail(
      'create-unnamed',
      '--create was given but neither --standalone nor --spec-slug names the new directory.',
    );
  }

  return fail(
    'unresolved',
    `no pipeline run directory resolved under ${pipelinesRoot}` +
    (opts.specSlug ? ` for spec-slug "${opts.specSlug}"` : '') +
    ' (PIPELINE_RUN_DIR unset or invalid, no matching run, and --create not passed).',
  );
}

module.exports = { resolve, formatTimestamp, adoptionRefusal, RUN_ID_RE };
