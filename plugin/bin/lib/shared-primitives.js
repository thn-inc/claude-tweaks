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
//   - isPathContained: "is this resolved path inside that resolved path" — a
//     thin strict / `orEqual` wrapper over `path-guard`'s `isAncestorOrSelf`
//     (#3498), so the containment comparison itself lives in one place: strict
//     by default (the root itself is excluded), `orEqual` to include it, and an
//     optional `pathImpl` for host-independent win32/posix tests. Previously
//     retyped independently as a hand-rolled prefix-plus-separator `startsWith`
//     test (with or without a `candidate === root` branch) in
//     `bin/lib/reconcile/reap-merged.js` (`isOwnCwd`, and its own
//     domain-boundary check), `bin/lib/hooks/worktree-reap.js` (the same two
//     checks), `bin/lib/timing/transcript.js`, and
//     `bin/lib/hooks/pre-tool-use.js` (two call sites, one of each shape) —
//     found during #2324's review when its own new `--extra-file` containment
//     check turned out to be a 6th independent copy of the pattern; #3498
//     migrated the four sites that were still hand-rolled. Every caller passes
//     its own already-resolved (`path.resolve`/`realpathSync`) paths in — this
//     is pure path arithmetic (`path.relative`), never a filesystem call, so it
//     does not change any caller's resolution strategy (lexical vs.
//     symlink-real), only the containment comparison itself. It is not a pure
//     string comparison: a relative argument resolves against `process.cwd()`
//     rather than failing closed, and a null/undefined argument throws
//     `ERR_INVALID_ARG_TYPE` — so pass absolute, already-resolved paths.
'use strict';

const path = require('path');
const { isAncestorOrSelf } = require('./path-guard');

const DEFAULT_GH_TIMEOUT_MS = 5000;
const GH_TIMEOUT_ENV_VAR = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
// #3051: mirrors GH_TIMEOUT_MS's own shape exactly — a separate key because
// claims-git-cas.js's `git` subprocess calls (fetch/show/push against the
// claims-registry branch) have a different cost profile than a `gh` call,
// and a loaded machine's slow-but-healthy remote needs more room than the
// gh-timeout-ms default gives it (#2567's 5s default killed an observed
// 8.6s healthy fetch under concurrent dispatch load).
const DEFAULT_GIT_TIMEOUT_MS = 30000;
const GIT_TIMEOUT_ENV_VAR = 'CLAUDE_TWEAKS_GIT_TIMEOUT_MS';
const DEFAULT_GIT_PUSH_TIMEOUT_MS = 600000;
const GIT_PUSH_TIMEOUT_ENV_VAR = 'CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS';
const GIT_PUSH_TIMEOUT_BOUNDS = { min: 1000, max: 3600000 };
const LARGE_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

// Memoized once per process — set on first read, never re-read after (the
// Gotcha this exists for: re-reading policy.yml on every `gh` invocation
// would add filesystem I/O to a hot path).
let resolvedGhTimeoutMs;
let resolvedGitTimeoutMs;
let resolvedGitPushTimeoutMs;

// A positive-integer env var wins outright; anything else (unset, blank,
// non-numeric, zero, negative, or outside the `gh-timeout-ms` policy key's
// own [min, max] — read from POLICY_KEYS rather than a second hard-coded
// 1000/60000 pair, so the two bounds can never drift apart) falls through to
// the policy/default path below rather than throwing or applying an
// unbounded value — a malformed override must not crash the caller that
// only wanted a timeout value, and an operator's typo (an extra zero) must
// not silently hang every `gh` call for minutes.
// `boundsOf()` returns the {min, max} to clamp against, or nothing; it runs only once a
// positive integer is set, so an unset variable never loads policy-schema.
function timeoutFromEnv(envVar, boundsOf) {
  const raw = process.env[envVar];
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  const bounds = boundsOf();
  if (bounds && (parsed < bounds.min || parsed > bounds.max)) return undefined;
  return parsed;
}

// A policy key's own row ({min, max, …}) from POLICY_KEYS.
function policyKeyBounds(key) {
  try {
    // eslint-disable-next-line global-require
    const { POLICY_KEYS } = require('./policy-schema');
    return POLICY_KEYS.find((k) => k.key === key);
  } catch {
    // policy-schema unresolvable — fall through with the parsed value
    // un-clamped rather than losing an otherwise-legitimate override.
    return undefined;
  }
}

function ghTimeoutFromEnv() {
  return timeoutFromEnv(GH_TIMEOUT_ENV_VAR, () => policyKeyBounds('gh-timeout-ms'));
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

// #3051: same shape as ghTimeoutFromEnv, bounded against the `git-timeout-ms`
// policy key's own [min, max] rather than a second hard-coded pair.
function gitTimeoutFromEnv() {
  return timeoutFromEnv(GIT_TIMEOUT_ENV_VAR, () => policyKeyBounds('git-timeout-ms'));
}

// Same call-time-lazy-require rationale as ghTimeoutFromPolicy above.
function gitTimeoutFromPolicy() {
  try {
    // eslint-disable-next-line global-require
    const { readGitTimeoutMs } = require('./policy');
    return readGitTimeoutMs(process.cwd());
  } catch {
    return undefined;
  }
}

function resolveGitTimeoutMs() {
  return gitTimeoutFromEnv() ?? gitTimeoutFromPolicy() ?? DEFAULT_GIT_TIMEOUT_MS;
}

function getGitTimeoutMs() {
  if (resolvedGitTimeoutMs === undefined) resolvedGitTimeoutMs = resolveGitTimeoutMs();
  return resolvedGitTimeoutMs;
}

// #4026: phase-exit.js's `git push` runs the consumer's pre-push hook (often a test
// suite) against the remote, so GIT_TIMEOUT_MS's 30 s kills healthy pushes. Env var >
// a 10-minute default, through the same bounded env reader; no policy key.
function getGitPushTimeoutMs() {
  if (resolvedGitPushTimeoutMs === undefined) {
    resolvedGitPushTimeoutMs = timeoutFromEnv(GIT_PUSH_TIMEOUT_ENV_VAR, () => GIT_PUSH_TIMEOUT_BOUNDS) ?? DEFAULT_GIT_PUSH_TIMEOUT_MS;
  }
  return resolvedGitPushTimeoutMs;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPathContained(candidate, root, { orEqual = false, pathImpl = path } = {}) {
  if (!isAncestorOrSelf(root, candidate, { pathImpl })) return false;
  return orEqual || pathImpl.relative(root, candidate) !== '';
}

// A path with every `sep` separator rewritten to `/` — the repo-display form
// (git output, JSON report IDs, globs). `sep` is a parameter so a test can pin
// the win32 branch with `path.win32.sep` on any host (#2767). Never apply it to
// a path that is then opened with fs: that one stays native.
function toPosix(p, sep = path.sep) {
  return sep === '/' ? p : p.split(sep).join('/');
}

// The `/`-joined repo-display ID of `to` relative to `from` (#3315): the one
// spelling for a path that lands in a report, JSON ID, or comparison key.
// `pathImpl` is the seam a test injects `path.win32` through; callers keep
// opening files with the native path.
function relativeDisplayId(from, to, pathImpl = path) {
  return toPosix(pathImpl.relative(from, to), pathImpl.sep);
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

module.exports = {
  LARGE_MAX_BUFFER_BYTES, escapeRegExp, isPathContained, isTimeoutError, runClassified, runClassifiedAsync, toPosix,
  relativeDisplayId,
};
Object.defineProperty(module.exports, 'GH_TIMEOUT_MS', { enumerable: true, get: getGhTimeoutMs });
Object.defineProperty(module.exports, 'GIT_TIMEOUT_MS', { enumerable: true, get: getGitTimeoutMs });
Object.defineProperty(module.exports, 'GIT_PUSH_TIMEOUT_MS', { enumerable: true, get: getGitPushTimeoutMs });
