// bin/lib/shared-primitives.js
// Small, previously-duplicated primitives, consolidated per #977:
//
//   - GH_TIMEOUT_MS: the `gh` subprocess timeout (ms) shared by every direct
//     `execFileSync('gh', ...)` / `execFileAsync('gh', ...)` call in the
//     claim machinery. Before this extraction it was defined identically in
//     `plugin/bin/claim-targets.js`, `plugin/bin/lib/issues/claim-store.js`,
//     and `plugin/bin/lib/reconcile/release-merged.js` — a 4th copy lived in
//     `claim-engine.js` until that file was retired (#787), which is why
//     #977 originally counted 4. NOT the hook-teardown timeout —
//     `plugin/bin/lib/hooks/teardown-run.js` deliberately uses a different,
//     longer value and stays out of scope here.
//     #2567: no longer a fixed 5000 — resolved with precedence env var
//     (CLAUDE_TWEAKS_GH_TIMEOUT_MS) > `gh-timeout-ms` policy key > the same
//     5000 default, computed lazily on first access and cached for the rest
//     of the process (see `resolveGhTimeoutMs` below). A GitHub Enterprise
//     Server host's cold `gh` call routinely exceeds 5s; a fixed bound with
//     no override made every consumer listed above fail until `gh` warmed
//     up. Exported as a getter (`Object.defineProperty` below), not a plain
//     value, so every consumer's existing `const { GH_TIMEOUT_MS } =
//     require(...)` keeps working unchanged while still picking up the
//     resolved value — and, critically, so the resolution (a policy-file
//     read) never runs for a process that requires this module but never
//     actually reads GH_TIMEOUT_MS (bin/lib/hooks/pre-tool-use.js's hot
//     path pulls this module in via git-exec.js for `isPathContained` alone
//     and must not pay for a read it never asked for).
//   - escapeRegExp: a one-line "escape regex metacharacters" helper, also
//     defined identically in `plugin/bin/lib/skill-audit/skill-catalog.js`
//     and `plugin/bin/lib/code-health/candidates-dead-code.js` before this
//     extraction. Unrelated in purpose to GH_TIMEOUT_MS, but consolidated
//     into this same file per #977's single-shared-module deliverable
//     rather than a second one-export file.
//   - LARGE_MAX_BUFFER_BYTES: the 64 MiB `execFileSync`/`execSync` `maxBuffer`
//     override for a call whose output can exceed Node's 1MB default (a full
//     `git log`/`gh issue list --state all` dump). Previously defined
//     identically (in two different multiplication orders) in
//     `plugin/bin/residue.js` (both its generic runner and its `npm test`
//     call) and `plugin/bin/lib/issues/backlog.js`'s `deriveCreatedAtFromGit`
//     — a third pattern-copy landed in `plugin/bin/backlog-grant-gate.js`'s
//     `gh`/`git` runners before this consolidation, which is what prompted it.
//   - runClassified / runClassifiedAsync: the try/execute/catch scaffold
//     shared by the sync/async primitive pairs below
//     — `runGit`/`runGitAsync` (bin/lib/hooks/git-exec.js) and
//     `ghHealthCheck`/`ghHealthCheckAsync` (bin/lib/reconcile/preflight.js)
//     each previously retyped this shape once per twin. #1652: a
//     whole-branch pre-release review (pre-v6.110.0) found runGit's stderr
//     field had been added without updating runGitAsync to match, despite a
//     header comment claiming "identical return shape" — this extraction,
//     paired with each pair's own single buildSuccess/buildFailure shaping
//     functions (defined once, called from both twins), makes that class of
//     drift structurally impossible rather than merely documented against.
//     #2567: both twins accept an optional third `{ retryOnTimeout }` opts
//     arg (default false — every existing call site is unaffected). When a
//     caller opts in, a timeout-shaped `fn()` throw (the same signature
//     bin/lib/hooks/git-exec.js's own `classify()` already used to detect a
//     killed subprocess) is retried exactly once before mapError ever sees
//     it — a single slow cold `gh` call no longer fails the caller outright.
//     Deliberately opt-in, not a blanket default: this scaffold is shared by
//     `git`-calling twins too (runGit/runGitAsync), and doubling worst-case
//     latency there has a different, and in one case (pre-tool-use.js's
//     enforcement-critical worktree gate) much higher, cost than for a `gh`
//     call — see the gh-only call sites in release-merged.js, preflight.js,
//     and pr-state.js for what actually opts in. Gated specifically on the
//     timeout classification: a real auth error or 404 is never retried,
//     and the retry always uses the same timeout the first attempt did (a
//     caller's `fn` closure already has it baked in) — never a longer
//     window, and never more than one retry.
//   - isPathContained: the `candidate === root || candidate.startsWith(root +
//     path.sep)` (or the strict, no-equals-branch half of it alone) idiom for
//     "is this resolved path inside that resolved path". Previously retyped
//     independently in `bin/lib/reconcile/reap-merged.js` (`isOwnCwd`, and its
//     own domain-boundary check), `bin/lib/hooks/worktree-reap.js` (the same
//     two checks), `bin/lib/timing/transcript.js`, and
//     `bin/lib/hooks/pre-tool-use.js` (two call sites, one of each shape) —
//     found during #2324's review when its own new `--extra-file` containment
//     check turned out to be a 6th independent copy of the pattern. Every
//     caller passes its own already-resolved (`path.resolve`/`realpathSync`)
//     paths in — this is a pure string check, never a filesystem call, so it
//     does not change any caller's resolution strategy (lexical vs.
//     symlink-real), only the containment comparison itself.
'use strict';

const path = require('path');

const DEFAULT_GH_TIMEOUT_MS = 5000;
const GH_TIMEOUT_ENV_VAR = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
const LARGE_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

// Memoized once per process — set on first read, never re-read after (the
// Gotcha this exists for: re-reading policy.yml on every `gh` invocation
// would add filesystem I/O to a hot path).
let resolvedGhTimeoutMs;

// A positive-integer env var wins outright; anything else (unset, blank,
// non-numeric, zero, negative) falls through to the policy/default path
// below rather than throwing — a malformed override must not crash the
// caller that only wanted a timeout value.
function ghTimeoutFromEnv() {
  const raw = process.env[GH_TIMEOUT_ENV_VAR];
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// Policy read is required lazily, inside the function body — never hoisted
// to this module's top level — for the same call-time-resolution reason
// bin/lib/policy.js's own resolvePortServices lazy-requires
// `./ports/registry`: this module is a small, broadly-required leaf (see
// the header), and a top-level require here would pull policy.js's own
// require graph into every consumer whether or not it ever reads
// GH_TIMEOUT_MS.
function ghTimeoutFromPolicy() {
  try {
    // eslint-disable-next-line global-require
    const { readGhTimeoutMs } = require('./policy');
    return readGhTimeoutMs(process.cwd());
  } catch {
    // No repo root resolvable at cwd, a malformed policy.yml, or any other
    // read failure — fall through to the hard-coded default below.
    return undefined;
  }
}

function resolveGhTimeoutMs() {
  return ghTimeoutFromEnv() ?? ghTimeoutFromPolicy() ?? DEFAULT_GH_TIMEOUT_MS;
}

function getGhTimeoutMs() {
  if (resolvedGhTimeoutMs === undefined) resolvedGhTimeoutMs = resolveGhTimeoutMs();
  return resolvedGhTimeoutMs;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPathContained(candidate, root, { orEqual = false } = {}) {
  if (orEqual && candidate === root) return true;
  return candidate.startsWith(root + path.sep);
}

// Same three-way check bin/lib/hooks/git-exec.js's own `classify()` uses to
// recognize a killed subprocess: execFileSync/execFile signal a timeout kill
// via `killed`/`signal` and, depending on platform and Node version, an
// ETIMEDOUT code — check all three rather than relying on any one being
// present. Deliberately narrow: an auth failure or a real 404 leaves the
// process un-killed (`err.killed` is falsy), so this never retries those.
function isTimeoutError(err) {
  return Boolean(err) && (err.code === 'ETIMEDOUT' || err.killed === true || err.signal === 'SIGTERM');
}

function runClassified(fn, mapError, { retryOnTimeout = false } = {}) {
  try {
    return fn();
  } catch (err) {
    if (retryOnTimeout && isTimeoutError(err)) {
      try {
        return fn();
      } catch (err2) {
        return mapError(err2);
      }
    }
    return mapError(err);
  }
}

async function runClassifiedAsync(fn, mapError, { retryOnTimeout = false } = {}) {
  try {
    return await fn();
  } catch (err) {
    if (retryOnTimeout && isTimeoutError(err)) {
      try {
        return await fn();
      } catch (err2) {
        return mapError(err2);
      }
    }
    return mapError(err);
  }
}

module.exports = { LARGE_MAX_BUFFER_BYTES, escapeRegExp, isPathContained, runClassified, runClassifiedAsync };
Object.defineProperty(module.exports, 'GH_TIMEOUT_MS', { enumerable: true, get: getGhTimeoutMs });
