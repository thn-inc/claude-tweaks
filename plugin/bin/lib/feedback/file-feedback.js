// bin/lib/feedback/file-feedback.js
// Argv-safe upstream-feedback filing (#681). Replaces skills/feedback/SKILL.md
// Step 8's shell recipe, which interpolated a model-authored title into
// `gh issue create --title '<title>'` — a title containing backticks got
// command-substituted by /bin/sh before `gh` ever saw it. Here the title
// travels through the injectable runner's argv array, never a shell string.
// Also replaces Step 4's `createFingerprint` misuse: that function is a
// factory returning { fingerprint, normalizeDescription } for a
// named-fields-off-an-object caller shape (docs-health, harness-health,
// journey-health); calling it directly on a string basis produced
// `[object Object]`. This module calls fingerprintFromBasis directly instead.
//
// Same two-file shape as bin/lib/issues/link.js + bin/link-records.js:
// defaultRunner, errorText, per-item try/catch into a status envelope, every
// side effect (runner, filesystem) injectable so tests never touch real `gh`
// or disk. Module never calls process.exit, never reads argv, never touches
// real `gh` unless the caller's runner does.
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { normalizeText, fingerprintFromBasis } = require('../health-core/fingerprint');
const { findByMarker } = require('../issues/dedup-lookup');

// Node's execFileSync default maxBuffer (1MB) overflows on findDuplicate's
// unscoped `--state all` full-body list against a repo with 1,500+ issues
// (#1564) — every gh call here shares this raised ceiling since the create/
// view calls' own output is always small.
const GH_MAX_BUFFER = 64 * 1024 * 1024;

function defaultRunner(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GH_MAX_BUFFER, windowsHide: true });
}

// Same shape as bin/lib/issues/link.js's errorText — a runner may throw a
// non-Error (string, object, undefined); never let the failure reason come
// back empty.
function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter(Boolean).map(String);
  return parts.length ? parts.join(' ') : String(err);
}

// A transient-looking gh failure: a 5xx status, a timeout, or a connection
// reset — the same signature `_shared/pr-early-run-lifecycle.md`'s Step 2/
// Step 3 push/PR-create retries already key on. Deliberately narrower than
// `_shared/github-rate-limit.md`'s taxonomy: that file is scoped to
// rate-limit signatures (403/429) and explicitly is not the right
// classifier for a plain server-side 5xx/timeout outage (see that
// lifecycle file's Step 2 note) — a bare 403/429 here is never retried.
const TRANSIENT_RE = /\b5\d\d\b|timeout|ETIMEDOUT|ECONNRESET|econnreset|socket hang up|could not connect|network error/i;

function isTransientFailure(err) {
  return TRANSIENT_RE.test(errorText(err));
}

// Same synchronous-sleep trick as bin/lib/file-lock.js's sleepSync.
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best-effort */ }
}

// Wrap a runner so a transient-looking failure (see isTransientFailure) is
// retried up to `maxRetries` times, waiting `waitMs` between attempts,
// before giving up — matching `_shared/pr-early-run-lifecycle.md`'s "retry
// once after a 15-second wait, then treat a second failure exactly like any
// other failure" convention at the default `maxRetries: 1`. `sleep` is
// injectable so tests never actually wait; a non-transient failure (or the
// final consecutive failure) is rethrown unchanged. Safe for idempotent
// calls only — see `createWithDedupSafeRetry` below for why a plain,
// unbounded-count retry of `gh issue create` is NOT safe to build from this.
function withTransientRetry(runner, { waitMs = 15000, maxRetries = 1, sleep = sleepSync } = {}) {
  return function retryingRunner(args) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return runner(args);
      } catch (err) {
        if (!isTransientFailure(err)) throw err;
        lastErr = err;
        if (attempt < maxRetries) sleep(waitMs);
      }
    }
    throw lastErr;
  };
}

// gh issue create is not idempotent — unlike the dedup search and read-back
// calls, blindly retrying it on an ambiguous transient failure (the request
// reached GitHub and succeeded, but the response was lost to the same
// timeout/reset that looks "transient") risks filing a second duplicate
// issue carrying the same fingerprint marker. Before each retry, re-run the
// dedup search for that marker: a hit means the "failed" attempt actually
// succeeded, so return the existing issue instead of creating another one.
// Defaults to 4 retries (5 total attempts) — this record's own observed
// worst case (#834's Gotchas: one of 6 filings needed 5 attempts across two
// hand-rolled loops before succeeding).
function createWithDedupSafeRetry({ repo, marker, create, runner, waitMs = 15000, maxRetries = 4, sleep = sleepSync }) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return create();
    } catch (err) {
      if (!isTransientFailure(err)) throw err;
      lastErr = err;
      if (attempt < maxRetries) {
        sleep(waitMs);
        const hit = findDuplicate({ repo, marker, runner });
        if (hit) return hit.number;
      }
    }
  }
  throw lastErr;
}

// draft.fingerprintBasis: { component, summary } -> 'feedback-{8 hex}'. Throws
// if either field is missing — a caller bug (the CLI must validate every
// draft's shape before calling this), not a runtime condition to paper over.
function computeFingerprint(draft) {
  const basis = draft && draft.fingerprintBasis;
  const hasComponent = basis && basis.component !== undefined && basis.component !== null && basis.component !== '';
  const hasSummary = basis && basis.summary !== undefined && basis.summary !== null && basis.summary !== '';
  if (!hasComponent || !hasSummary) {
    throw new Error('computeFingerprint: draft.fingerprintBasis must include both component and summary');
  }
  return fingerprintFromBasis('feedback', [basis.component, normalizeText(basis.summary)]);
}

// The one place that renders a fingerprint value into its HTML-comment
// marker form — embedFingerprint, verifyReadBack, and fileOne all need the
// exact same string, so they share this instead of re-templating it each time.
function fingerprintMarker(fingerprint) {
  return `<!-- fingerprint: ${fingerprint} -->`;
}

// The sole source of truth for what fingerprint marker actually gets filed.
// Step 5's draft template already renders a `<!-- fingerprint: <marker> -->`
// placeholder line as part of the human-readable preview — possibly the
// literal `[object Object]` bug text if drafted before this fix. Never trust
// that incoming value: replace the line wholesale if present, else append it.
// #1435: the replacement must be a function, not the literal `line` string —
// String.replace's string-replacement grammar treats a raw `$`-prefixed
// sequence in that argument as a splice directive ($` = "everything before
// the match"), not literal text. `line` is always a hex fingerprint today
// (no `$`), but the function form costs nothing and removes the trap.
function embedFingerprint(body, fingerprint) {
  const line = fingerprintMarker(fingerprint);
  const marker = /<!-- fingerprint:[^\n]*-->/;
  if (marker.test(String(body))) return String(body).replace(marker, () => line);
  const sep = String(body).endsWith('\n') ? '' : '\n';
  return `${body}${sep}${line}\n`;
}

// { repo, marker, runner } -> first matching issue { number, title, body,
// createdAt } or null. Plain list-then-filter, per
// `_shared/github-write-transport.md`'s prohibition on `gh issue list
// --search`/`search_issues` for a find-by-marker/dedup lookup (both ride
// GitHub's eventually-consistent search index — root cause of #1016/#1079/
// #1089). Reuses the same findByMarker idiom `_shared/headless-self-report.md`
// already documents. One call per draft: dedup is cheap and per-item
// fail-safe matters more here than batching — unlike link.js's databaseId
// resolution, there's no shared batch call to make. Unlike that precedent's
// `--label by:{caller}`-scoped list, this caller has no reliable label to
// scope by (feedback drafts carry caller-supplied labels, not a fixed one),
// so `--limit` is the only truncation guard — set high enough to cover the
// whole repo's issue history rather than a bounded recent window (#1094
// review finding: `--limit 500` already truncated ~half of this repo's
// then-998 issues).
function findDuplicate({ repo, marker, runner = defaultRunner }) {
  const out = runner(['issue', 'list', '--repo', repo, '--state', 'all', '--json', 'number,title,body,createdAt', '--limit', '10000']);
  const issues = JSON.parse(out);
  const result = findByMarker(Array.isArray(issues) ? issues : [], marker);
  return result ? result.canonical : null;
}

// Writes body to bodyFile (caller supplies the path — keeps this function
// testable without touching the real filesystem's tmp dir), then files the
// issue. Title goes through the runner's argv array — never string-
// interpolated. `gh` has no `--title-file`; body still goes via `--body-file`.
// Parses the created issue's number from gh's printed URL.
function fileDraft({ repo, title, body, labels = [], runner = defaultRunner, bodyFile, writeFile = fs.writeFileSync }) {
  writeFile(bodyFile, body, 'utf8');
  const labelArgs = labels.flatMap((l) => ['--label', l]);
  const out = runner(['issue', 'create', '--repo', repo, '--title', title, '--body-file', bodyFile, ...labelArgs]);
  const m = /\/issues\/(\d+)/.exec(String(out));
  if (!m) throw new Error(`fileDraft: could not parse issue number from gh output: ${JSON.stringify(String(out))}`);
  return Number(m[1]);
}

function readBack({ repo, number, runner = defaultRunner }) {
  const out = runner(['issue', 'view', String(number), '--repo', repo, '--json', 'title,body']);
  const parsed = JSON.parse(out);
  return { title: parsed.title, body: parsed.body };
}

// { draft, fingerprint, readBack } -> { ok: true } | { ok: false, reason }.
function verifyReadBack({ draft, fingerprint, readBack }) {
  if (readBack.title !== draft.title) {
    return { ok: false, reason: `title mismatch: expected ${JSON.stringify(draft.title)}, got ${JSON.stringify(readBack.title)}` };
  }
  const marker = fingerprintMarker(fingerprint);
  if (!String(readBack.body || '').includes(marker)) {
    return { ok: false, reason: `fingerprint marker missing from read-back body (expected "${marker}")` };
  }
  return { ok: true };
}

// Orchestrates one draft end-to-end: compute fingerprint -> embed -> dedup
// search -> if hit, dedup-hit -> else file -> read back -> verify. Every step
// from dedup onward is try/caught into a filing-failure result — one draft's
// `gh` failure never aborts the batch (same posture as link.js's per-edge
// try/catch). computeFingerprint's own throw (missing fingerprintBasis
// fields) is a caller bug and is deliberately NOT caught here — the CLI
// validates every draft's shape before calling fileOne.
// `runner` must be the plain, non-retrying runner — retry is applied here,
// internally, with call-appropriate safety: the dedup search and read-back
// (idempotent reads) retry freely via `withTransientRetry`; the create call
// goes through `createWithDedupSafeRetry` instead, since a plain retry
// there risks filing a duplicate issue (see that function's doc comment).
// Passing an already-retrying `runner` in here would defeat the dedup-safe
// path — its failures would already be exhausted/retried before this
// function's own catch ever saw them.
function fileOne({ repo, draft, runner = defaultRunner, bodyFile, writeFile = fs.writeFileSync, waitMs = 15000, maxRetries = 4, sleep = sleepSync }) {
  const fingerprint = computeFingerprint(draft);
  const body = embedFingerprint(draft.body, fingerprint);
  const marker = fingerprintMarker(fingerprint);
  const retryingReader = withTransientRetry(runner, { waitMs, maxRetries, sleep });
  let number;
  try {
    const hit = findDuplicate({ repo, marker, runner: retryingReader });
    if (hit) return { status: 'dedup-hit', number: hit.number };
    number = createWithDedupSafeRetry({
      repo,
      marker,
      runner,
      waitMs,
      maxRetries,
      sleep,
      create: () => fileDraft({ repo, title: draft.title, body, labels: draft.labels || [], runner, bodyFile, writeFile }),
    });
    const rb = readBack({ repo, number, runner: retryingReader });
    const verify = verifyReadBack({ draft, fingerprint, readBack: rb });
    if (!verify.ok) return { status: 'filing-failure', number, reason: verify.reason };
    return { status: 'filed', number };
  } catch (err) {
    return { status: 'filing-failure', number, reason: errorText(err) };
  }
}

module.exports = {
  defaultRunner,
  GH_MAX_BUFFER,
  errorText,
  isTransientFailure,
  withTransientRetry,
  createWithDedupSafeRetry,
  computeFingerprint,
  embedFingerprint,
  findDuplicate,
  fileDraft,
  readBack,
  verifyReadBack,
  fileOne,
};
