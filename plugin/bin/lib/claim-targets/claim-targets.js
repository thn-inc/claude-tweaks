// bin/lib/claim-targets/claim-targets.js
// The group-claim loop as one command — `skills/flow/claim-targets.md`'s
// Step 2.8 read-classify-write loop, mirrored here so a headless run can
// shell out to one process instead of a chain of `node -e` snippets. Logic
// lives in `run(argv, deps)`; every side effect (`ghApi`, `gh`, `now`,
// `stdout`, `stderr`, `hostname`, `sessionId`) goes through `deps` so tests
// never touch real `gh`. See `skills/_shared/issue-claims.md` ("The lock"
// steps 1-6, "Group claiming") for the protocol this implements, and
// `.claude/skills/gh-api-module-pattern/SKILL.md` for the injectable-runner
// convention this file follows.
//
// `deps.ghApi` is the claim-store contract: `ghApi(args)` never throws,
// returns `{stdout, failure, status}` (same shape `bin/lib/issues/claim-store.js`
// already uses for the contents-API reads/writes this module delegates to it).
// `deps.gh` is the generic-runner contract: `gh(args)` is invoked as if
// `gh ${args.join(' ')}`, returns stdout, and *throws* on failure — used for
// every non-contents-API call (`repo view`, `label list/create`,
// `issue edit --add-label/--remove-label`, `issue comment`). Every `deps.gh`
// call that can throw is wrapped so a failure never escapes uncaught.
'use strict';

const path = require('path');
const claimStore = require('../issues/claim-store');
const { classifyClaimBlob, claimPayload, releasePayload } = require('../issues/claims');
const { ensureLabelPayload } = require('../issues/labels');
const { runClassified, isTimeoutError } = require('../shared-primitives');
const { appendEntry, formatEntry, resolveTarget } = require('../log-decision/append');
const { CLAIM_LOG_SECTION, CLAIM_LOG_STEP, claimLogText } = require('../log-decision/claim-log');
const { tombstoneInFlightPr } = claimStore;

const BOT_IN_PROGRESS = 'bot:in-progress';
const BOT_IN_PROGRESS_DESC = 'Bot state: an agent currently holds the claim on this record';
// #1873: the Bot state family's color — matches _shared/label-bootstrap.md's
// canonical LABELS_JSON entry for this same label, since this call site
// bootstraps it independently rather than going through the shared loop.
const BOT_IN_PROGRESS_COLOR = '6A737D';
const ABORT_REASON = 'never-started: file-overlap group partial claim';

const USAGE = 'usage: claim-targets.js --run-id <id> --targets <n,n,...> [--keep-going] [--run <run-dir>] [--steps <step,step,...>] [--help]\n'
  + '  --steps <step,step,...>: the resolved /flow step list; one with neither build nor test claims\n'
  + '           nothing and exits 0 with {claimed:[],alreadyOwned:[],skipped:[],skipGuard:"no-build-or-test"}\n'
  + '  --run <run-dir>: writes the Step 2.8 claim-log line to that run dir\'s decisions.md for every claimed target\n'
  + '  exit 0 = all claimed (or, with --keep-going, partial; or the --steps skip-guard)\n'
  + '  exit 2 = malformed invocation or missing dependency\n'
  + '  exit 3 = contested, or a pr-opened tombstone whose linked PR is still open\n'
  + '           (contested: {contested:[{issue,holder}], ...}; in-flight: {inFlight:[{issue,link}], ...})\n'
  + '  exit 4 = transient gh failure\n'
  + '  exit 5 = claim write reported success but the post-write read-back did not\n'
  + '           confirm it (a live claim carrying this runId) — {unverified:[{issue}], ...}\n';

function errText(e) {
  return String((e && e.message) || e);
}

// Claim blobs are remote data: an unparseable one is classified 'unreadable'
// by classifyClaimBlob and never fatal here, so every identity read yields
// null rather than throwing.
function parseJsonOrNull(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function parseArgs(argv) {
  const opts = {
    runId: null, targetsRaw: null, keepGoing: false, help: false, runDir: null, stepsRaw: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--run-id') opts.runId = next();
    else if (a === '--targets') opts.targetsRaw = next();
    else if (a === '--keep-going') opts.keepGoing = true;
    else if (a === '--run') opts.runDir = next();
    else if (a === '--steps') opts.stepsRaw = next();
    else return { error: `unknown argument: ${a}` };
  }
  return opts;
}

// Explicit positive-integer validation per part — never `Number(s)`, whose
// `Number('') === 0` would let a trailing comma or blank slip past
// `Number.isInteger` (gh-api-module-pattern skill's documented hazard).
function parseTargets(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.split(',').map((s) => s.trim());
  const targets = [];
  for (const p of parts) {
    if (!/^[1-9]\d*$/.test(p)) return null;
    targets.push(Number(p));
  }
  return targets.length ? targets : null;
}

// /flow's step vocabulary — `skills/flow/steps-and-gates.md`'s Allowed Steps
// table plus the bundled `re-verify` it names as a no-op list entry and the
// resume-only `review-console` (`/flow {specs} review-console` must skip, not
// hard-stop). Held here as data, never grepped from that prose at runtime.
const FLOW_STEPS = Object.freeze(['build', 'stories', 'test', 'review', 'polish', 're-verify', 'wrap-up', 'review-console']);

// `--steps` is the resolved /flow step list (`flow/SKILL.md` Step 1, item 4).
// Same strictness as parseTargets: a blank value, a bare trailing flag
// (`undefined`), an empty part (`review,,wrap-up`, `build,`), a part that is
// another flag (`--steps --keep-going` consumed `--keep-going` as the value),
// or any name outside FLOW_STEPS (`Build`, `biuld`) is malformed, never
// silently read as "no build/test" — a mangled list must not turn into a
// skipped claim. Returns `{steps}` or `{error}` (the caller prints `error`,
// when non-empty, ahead of USAGE).
function parseSteps(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: '' };
  const parts = raw.split(',').map((s) => s.trim());
  const bad = parts.find((p) => !FLOW_STEPS.includes(p));
  if (bad !== undefined) {
    return { error: `claim-targets: unknown --steps entry ${JSON.stringify(bad)} — accepted: ${FLOW_STEPS.join(', ')}\n` };
  }
  if (parts.length > 1 && parts.includes('review-console')) {
    return { error: 'claim-targets: --steps entry "review-console" is resume-only and not valid beside other steps (flow/steps-and-gates.md)\n' };
  }
  return { steps: parts };
}

// Default `deps.appendClaimLog` implementation — writes the exact Step 2.8
// claim-log line (`flow/claim-targets.md`'s "Log the claim", #2492) for one
// claimed target, via the same appendEntry/formatEntry machinery
// log-decision.js itself uses. No new line format: `claimLogText` is the
// single source for the --text shape, `CLAIM_LOG_SECTION`/`CLAIM_LOG_STEP`
// for the section/step, both from log-decision/claim-log.js (#2775).
//
// Gated on the same `resolveTarget` anchoring check `log-decision.js`'s own
// `run()` performs before it ever calls `appendEntry` — never a parallel
// check. Called with production defaults (cwd/mainRoot both left to
// `resolveTarget`'s own computation, exactly as `log-decision.js`'s
// `realDeps` does), so a worktree-local shadow copy of a run dir is refused
// here the same way it is there, closing the [IL-127]-class gap a bare
// `appendEntry` call would otherwise reopen: writing straight past the
// anchoring check would let an unanchored `--run` silently create a shadow
// decisions.md the main-checkout bookkeeping-stamps gate never reads. A
// refusal throws — the caller's existing try/catch (see `run()` below)
// records it in `claimLogFailures` and never un-claims the target.
function defaultAppendClaimLog({ runDir, issue, transport }) {
  const target = resolveTarget({ runDir });
  if (!target.ok) {
    throw new Error(`run dir not usable for the claim log (${target.reason})`);
  }
  appendEntry({
    runDir,
    section: CLAIM_LOG_SECTION,
    entry: formatEntry({
      status: 'AUTO',
      now: Date.now(),
      step: CLAIM_LOG_STEP,
      text: claimLogText(issue, transport),
      reversibility: 'high',
    }),
  });
}

// Best-effort bootstrap-then-add for `bot:in-progress`, per
// `_shared/label-bootstrap.md`'s check-then-create convention. Throws are the
// caller's problem to catch (per contract, this never aborts a claim).
function ensureAndAddLabel(gh, issue) {
  const payload = ensureLabelPayload(BOT_IN_PROGRESS, BOT_IN_PROGRESS_DESC, BOT_IN_PROGRESS_COLOR);
  const existing = String(gh(['label', 'list', '--search', payload.name, '--json', 'name', '-q', '.[].name']) || '')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  if (!existing.includes(payload.name)) {
    gh(['label', 'create', payload.name, '--color', payload.color, '--description', payload.description]);
  }
  gh(['issue', 'edit', String(issue), '--add-label', payload.name]);
}

function removeLabelBestEffort(gh, issue) {
  try { gh(['issue', 'edit', String(issue), '--remove-label', BOT_IN_PROGRESS]); } catch { /* best-effort, per issue-claims.md */ }
}

// Best-effort re-read to name a write-conflict's winner for the contested
// report. Never throws (claimStore's ghApi contract never throws) and never
// affects claim/contest state — a failed or absent re-read simply leaves
// `holder` at `null`, same as an unreadable blob's holder.
function holderFromFreshRead(deps, repoSlug, issue) {
  const fresh = claimStore.readClaimBlob(deps, repoSlug, issue);
  if (fresh.failure || fresh.absent) return null;
  const classified = classifyClaimBlob(fresh.content, deps.now());
  if (classified.state !== 'live') return null;
  return parseJsonOrNull(fresh.content);
}

// #2073: a claim write can report `ok: true` without the blob actually
// landing (the git-CAS push confirms the push itself, not that a later read
// sees it — the #1973 incident this closes). Re-read the just-written blob
// through the same read path (`readClaimBlob`, `knownTip` when the write was
// a git-CAS success so this costs no extra fetch) and confirm it classifies
// `'live'` with `runId` equal to this run's — anything else (a failed read,
// an absent/tombstoned/unreadable blob, or a live blob some other runId
// owns) means the write cannot be trusted and the caller must not treat this
// target as claimed. Never throws — `readClaimBlob`'s own contract already
// guarantees that.
function verifyClaimLanded(deps, repoSlug, issue, runId, knownTip) {
  const verify = claimStore.readClaimBlob(deps, repoSlug, issue, knownTip);
  if (verify.failure) return false;
  const content = verify.absent ? null : verify.content;
  const classified = classifyClaimBlob(content, deps.now());
  if (classified.state !== 'live') return false;
  const identity = parseJsonOrNull(content);
  return !!(identity && identity.runId === runId);
}

// #2329: on the contents-API path (`knownTip === null`), `verifyClaimLanded`'s
// read-back races GitHub's eventually-consistent contents API — a write that
// just landed can still read back as the pre-write blob for a short window,
// producing a spurious 'unverified' on a claim that actually succeeded. The
// git-CAS path (`knownTip` a chainable commit sha) reads at that exact commit
// and is already consistent, so it gets exactly one check — retrying there
// would only slow down every claim for no correctness gain (the file's own
// `knownTip` comment above `claimedThisRun` is the source of that guarantee).
// Reuses claim-store.js's `casBackoffMs`/`defaultSleep` — the same
// randomized, increasing backoff already used for git-CAS push retries —
// rather than inventing a second backoff shape for what is the same
// "proven-stale-so-far, worth one more look" wait.
const VERIFY_MAX_ATTEMPTS = 3;

function verifyClaimLandedWithRetry(deps, repoSlug, issue, runId, knownTip) {
  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt += 1) {
    if (verifyClaimLanded(deps, repoSlug, issue, runId, knownTip)) return true;
    if (knownTip !== null || attempt === VERIFY_MAX_ATTEMPTS) return false;
    (deps.sleep || claimStore.defaultSleep)(claimStore.casBackoffMs(attempt));
  }
  return false;
}

// All-or-abort release of every target this invocation claimed, before a
// contest or transient failure aborts the run (`issue-claims.md`'s "Group
// claiming" — a partial group claim must not leave a member built alone).
// Best-effort throughout: a release-write failure here is logged by the
// caller via the returned `releaseFailed` list (never a second abort) so a
// target left claimed under this run's identity is named on stdout instead
// of silently riding out its TTL unlabeled.
function releaseClaimedThisRun(deps, repoSlug, runId, issues) {
  const released = [];
  const releaseFailed = [];
  for (const issue of issues) {
    const fresh = claimStore.readClaimBlob(deps, repoSlug, issue);
    if (fresh.failure || fresh.absent) {
      releaseFailed.push({ issue, error: fresh.failure || 'absent' });
      continue; // nothing we can safely overwrite
    }
    const payload = releasePayload({
      issueNumber: issue, runId, reason: ABORT_REASON, now: deps.now(),
    });
    // `expectedContent` = what this very read saw, so a git-CAS push rejected
    // by unrelated `claims-registry` activity retries instead of aborting the
    // rollback and stranding a claim whose label was already stripped (#787
    // final-review finding I1 — see claim-store.js's writeClaimBlob).
    const w = claimStore.writeClaimBlob(deps, repoSlug, issue, {
      content: payload.tombstoneContent, sha: fresh.sha, expectedContent: fresh.content, message: `Release issue #${issue} — ${ABORT_REASON}`,
    });
    if (w.ok) {
      released.push(issue);
    } else {
      releaseFailed.push({ issue, error: w.failure || (w.conflict ? 'conflict' : (w.secondaryRateLimit ? 'secondary-rate-limit' : 'unknown')) });
    }
    removeLabelBestEffort(deps.gh, issue);
  }
  return { released, releaseFailed };
}

// argv -> exit code. All I/O through deps so tests never touch gh.
function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }

  if (!opts.runId || opts.runId.trim() === '') { deps.stderr(USAGE); return 2; }
  const targets = parseTargets(opts.targetsRaw);
  if (!targets) { deps.stderr(USAGE); return 2; }

  // The claim identity and the log location must be the same run — a `--run`
  // pointed at a different run dir would log a claim under the wrong run's
  // decisions.md (#2775).
  if (opts.runDir !== null && (typeof opts.runDir !== 'string' || opts.runDir.trim() === '')) { deps.stderr(USAGE); return 2; }
  const runDirBasename = opts.runDir !== null ? path.basename(opts.runDir) : null;
  if (runDirBasename !== null && runDirBasename !== opts.runId) {
    deps.stderr(`claim-targets: --run basename (${runDirBasename}) must equal --run-id (${opts.runId})\n`);
    return 2;
  }

  // #4027: `flow/claim-targets.md`'s skip-guard — a step list with neither
  // `build` nor `test` (a dispatched group's second call, any wrap-up-only
  // resume) has nothing left to build, so nothing to lock. Checked after all
  // argv validation and before the first `gh` call: no slug resolution, no
  // claim read or write, no label, no claim-log line, with or without
  // `--keep-going`/`--run`. Without `--steps`, behaviour is unchanged.
  if (opts.stepsRaw !== null) {
    const { steps, error } = parseSteps(opts.stepsRaw);
    if (!steps) { deps.stderr(error + USAGE); return 2; }
    if (!steps.includes('build') && !steps.includes('test')) {
      deps.stdout(JSON.stringify({
        claimed: [], alreadyOwned: [], skipped: [], skipGuard: 'no-build-or-test',
      }));
      return 0;
    }
  }

  // #3065: a `gh` timeout resolving the repo slug is retried once (same
  // shape as reconcile's release-merged.js/preflight.js/pr-state.js), then
  // classified as the CLI's existing transient class (exit 4) rather than
  // falling into the usage-error path below — a slow GitHub response is not
  // "malformed invocation or missing dependency". A non-timeout failure (gh
  // absent, auth, a real 404) still falls through to exit 2, but without the
  // USAGE text, which describes argv and is irrelevant to either cause.
  const slugResult = runClassified(
    () => ({ ok: true, slug: claimStore.resolveRepoSlugOrThrow(deps.gh) }),
    (e) => ({ ok: false, timedOut: isTimeoutError(e), error: errText(e) }),
    { retryOnTimeout: true },
  );
  if (!slugResult.ok) {
    if (slugResult.timedOut) {
      deps.stderr(
        `claim-targets: repo slug resolution timed out — ${slugResult.error}\n`
        + 'override via the gh-timeout-ms policy key or the CLAUDE_TWEAKS_GH_TIMEOUT_MS env var\n',
      );
      const transientTargets = targets.map((issue) => ({ issue, error: slugResult.error }));
      if (opts.keepGoing) {
        deps.stdout(JSON.stringify({
          claimed: [], alreadyOwned: [], skipped: targets.map((issue) => ({ issue, reason: 'transient' })),
          labelFailures: [], transportByIssue: {},
        }));
        return 0;
      }
      deps.stdout(JSON.stringify({ transient: transientTargets, released: [], releaseFailed: [] }));
      return 4;
    }
    deps.stderr(`claim-targets: could not resolve repo slug — ${slugResult.error}\n`);
    return 2;
  }
  const repoSlug = slugResult.slug;
  if (!repoSlug) { deps.stderr('claim-targets: could not resolve repo slug (empty)\n'); return 2; }
  // `tombstoneInFlightPr` (#315 review follow-up) validates a tombstone's
  // `link` against this exact owner/repo before ever calling `deps.gh` —
  // split once here rather than re-parsing `repoSlug` per target.
  const [repoOwner, repoName] = repoSlug.split('/');

  const claimedThisRun = [];
  const alreadyOwned = [];
  const skipped = [];
  const labelFailures = [];
  const transportByIssue = {};

  // #1467: amortizes this loop's git-CAS fetch across the whole batch instead
  // of one `git fetch` per issue. `null` means "no trusted tip — fetch fresh
  // on the next read" (the starting state, and the state after anything that
  // makes the previous tip untrustworthy). Set unconditionally right after
  // every read (git success -> that read's own tip; anything else -> null),
  // then re-set after any write attempt outcome for this same issue (git-CAS
  // success -> the just-pushed commit sha, chainable as the next issue's
  // known tip with zero fetch; anything else -> null, per the Gotchas below).
  // Discarding on ANY non-git outcome — not just this one item's — is
  // deliberate: a contents-API write can move the same `claims-registry`
  // branch tip without producing a git commit sha this loop can chain from,
  // and a contested/transient outcome means this run's belief about the tip
  // was already wrong. Trusting a stale tip for the next item's READ is never
  // a correctness hazard either way — it only ever informs a claim/contest
  // decision from content; the actual compare-and-swap enforcement happens at
  // `writeClaimBlobGit`'s `--force-with-lease` push, which fails closed (and
  // gets re-verified with a fresh read — claim-store.js's writeClaimBlob) the
  // instant the real remote tip has moved.
  let knownTip = null;

  // Every non---keep-going stop shares one shape: release everything this run
  // claimed (all-or-abort) plus, when the caller names one, a target this
  // run's own write just landed but couldn't confirm (`extraToRelease` —
  // #2329's claim-leak fix: `stopOrSkip`'s 'unverified' call site is the one
  // caller that ever passes this, since only a write that reported `ok: true`
  // needs releasing at all — a target that never reaches
  // `claimedThisRun.push()` because its OWN verification failed would
  // otherwise ride out its TTL unreleased and invisible, with no
  // `bot:in-progress` marker pointing at it). `releaseClaimedThisRun`'s own
  // fresh per-issue read either finds the write landed (releases it,
  // reclaimable immediately) or still doesn't see it (reports it in
  // `releaseFailed` — visible, not silently dropped). Then report the stop
  // alongside what was released and what could not be. Called only from
  // `stopOrSkip()` below, which is in turn the single call site every stop
  // below shares — so this cannot drift from any of them. `exitCode` is 3 for
  // a `contested`/`inFlight` envelope, 4 for a `transient` one, 5 for an
  // `unverified` one.
  function abort(envelope, exitCode, extraToRelease = []) {
    const { released, releaseFailed } = releaseClaimedThisRun(
      deps, repoSlug, opts.runId, [...claimedThisRun, ...extraToRelease],
    );
    deps.stdout(JSON.stringify({ ...envelope, released, releaseFailed }));
    return exitCode;
  }

  // The one shape every stop site below shares: with `--keep-going`, record
  // `{issue, reason: skipReason, ...extra}` in `skipped` and keep looping
  // (signaled by returning `null` — `abort()`'s exit codes are always 3, 4,
  // or 5, never null/0, so callers can tell the two outcomes apart with
  // `!== null`); otherwise abort the whole run via the envelope
  // `{[envelopeKey]: [{issue, ...extra}]}`. `extra` is exactly what differs
  // between call sites (an `error`, a `link`, or a `holder`) and is identical
  // between the skipped record and the envelope entry at every site — stated
  // once here instead of 5 times so the sites cannot drift from each other
  // (#977). `releaseThisIssue` (#2329) is `true` only at the 'unverified'
  // call site — the one case where THIS issue's own write reported success
  // and so needs releasing on abort alongside `claimedThisRun`, not just
  // recorded as never-claimed like every other stop reason.
  function stopOrSkip(issue, skipReason, envelopeKey, exitCode, extra, releaseThisIssue = false) {
    if (opts.keepGoing) { skipped.push({ issue, reason: skipReason, ...extra }); return null; }
    return abort({ [envelopeKey]: [{ issue, ...extra }] }, exitCode, releaseThisIssue ? [issue] : []);
  }

  // Per-`$LINK` memoization of `tombstoneInFlightPr`'s `gh pr view` call,
  // scoped to this one `run()` invocation (a fresh Map every call — never a
  // cross-invocation cache). Issues released together from one multi-spec
  // build commonly tombstone with the identical `link`, so this collapses
  // what would otherwise be one `gh pr view` per tombstoned target down to
  // one per distinct link (#977). Wraps only this call site's `gh`, not
  // `deps.gh` itself, so every other `deps.gh` call (label list/create, issue
  // edit, issue comment) is untouched. Only successful calls are cached — a
  // thrown failure is left uncached and re-thrown so `tombstoneInFlightPr`'s
  // own fail-open catch still applies per-target, exactly as before.
  const prViewCache = new Map();
  function cachedGhForPrView(args) {
    const key = JSON.stringify(args);
    if (prViewCache.has(key)) return prViewCache.get(key);
    const result = deps.gh(args);
    prViewCache.set(key, result);
    return result;
  }

  for (const issue of targets) {
    const read = claimStore.readClaimBlob(deps, repoSlug, issue, knownTip);
    if (read.failure) {
      knownTip = null;
      const stop = stopOrSkip(issue, 'transient', 'transient', 4, { error: read.failure });
      if (stop !== null) return stop;
      continue;
    }
    // A git-CAS success carries a chainable commit-sha tip; anything else
    // (contents-API, whether via a `gitRunner`-absent run or a git-side
    // fallback) is a blob sha and must not be chained (see the `knownTip`
    // comment above `claimedThisRun`).
    knownTip = read.via === 'git' ? read.sha : null;

    const content = read.absent ? null : read.content;
    const classified = classifyClaimBlob(content, deps.now());

    // A `pr-opened:` tombstone whose linked PR is still open means a build
    // already completed for this issue and is awaiting merge — reclaiming
    // (and re-building) here would race that open PR (#315). Gate this
    // ahead of the reclaimable branch below since a tombstone is otherwise
    // always reclaimable; every other tombstone reason, and any failure in
    // the check itself, falls straight through unchanged (fail open) —
    // see `tombstoneInFlightPr`'s own doc comment in claim-store.js.
    if (classified.state === 'tombstone') {
      const inFlight = tombstoneInFlightPr(content, cachedGhForPrView, repoOwner, repoName);
      if (inFlight) {
        const stop = stopOrSkip(issue, 'in-flight', 'inFlight', 3, { link: inFlight.link });
        if (stop !== null) return stop;
        continue;
      }
    }

    // Only a readable blob carries an identity — 'absent' has no content and
    // 'unreadable' has nothing parseable.
    const readable = classified.state === 'live' || classified.state === 'stale' || classified.state === 'tombstone';
    const identity = readable ? parseJsonOrNull(content) : null;

    if ((classified.state === 'live' || classified.state === 'stale') && identity && identity.runId === opts.runId) {
      alreadyOwned.push(issue);
      // A self-owned claim is still held, so its `bot:in-progress` projection
      // must be too: a prior attempt whose write landed but reported a
      // transient failure aborted before the label step, and the retry lands
      // here. Re-assert it (idempotent, best-effort like the claim path below).
      try {
        ensureAndAddLabel(deps.gh, issue);
      } catch (e) {
        labelFailures.push({ issue, error: errText(e) });
      }
      continue;
    }

    if (classified.state === 'live' || classified.state === 'unreadable') {
      const holder = classified.state === 'live' ? identity : null;
      const stop = stopOrSkip(issue, 'contested', 'contested', 3, { holder });
      if (stop !== null) return stop;
      continue;
    }

    // Reclaimable: 'absent' (create-only) or 'tombstone'/'stale' not self-owned
    // (conditional write, sha from this same read — issue-claims.md steps 3-4).
    const payload = claimPayload({
      issueNumber: issue, runId: opts.runId, sessionId: deps.sessionId, host: deps.hostname, now: deps.now(),
    });
    // `sha` is always the lease from this same read — the git-CAS branch tip
    // when the read came through git, the blob sha when it came through the
    // contents API — including for a create-only write: adding a new
    // `claims/issue-{n}.json` is still a commit on the current tip, protected
    // by the same `--force-with-lease`, and the create-only claim is exactly
    // the contended write #787's amendment moves off the contents API.
    // `createOnly` (not the presence of a sha) is what keeps that write
    // create-vs-clobber on the contents-API fallback — see
    // claim-store.js's writeClaimBlob. When no `gitRunner` dep is supplied
    // (release-merged.js's contents-API-only callers), an 'absent' read
    // returns `sha: null` anyway, so this is a no-op there.
    // `expectedContent` is the blob this same read saw (`null` when absent —
    // the create-only case, which compares on absence instead). It is what
    // lets claim-store tell a genuine lost race from a push rejected by
    // unrelated `claims-registry` activity, and what stops a fallback write
    // from clobbering a claim that landed meanwhile (#787 final-review
    // findings I1/C1 — see claim-store.js's writeClaimBlob).
    const writeOpts = {
      content: payload.fileContent,
      message: `Claim issue #${issue}`,
      sha: read.sha,
      createOnly: classified.state === 'absent',
      expectedContent: content,
    };
    const write = claimStore.writeClaimBlob(deps, repoSlug, issue, writeOpts);

    if (write.failure || write.secondaryRateLimit) {
      // A secondary/abuse rate limit is transient, never contested — a
      // throttle must not masquerade as another agent holding the claim
      // (record-697's incident read exactly that way before diagnosis,
      // #787's amendment). Either way this issue's write never confirmed a
      // git tip — discard the chain (see the `knownTip` comment above
      // `claimedThisRun`).
      knownTip = null;
      const reason = write.secondaryRateLimit ? 'secondary-rate-limit' : write.failure;
      const stop = stopOrSkip(issue, 'transient', 'transient', 4, { error: reason });
      if (stop !== null) return stop;
      continue;
    }
    if (!write.ok) {
      // Rejected (race lost between this read and this write) — contested,
      // not a retry, per issue-claims.md step 3's "A rejection on either
      // transport is contested." `write.conflict` (a 422 the ghApi dep
      // could positively identify — see claim-store.js's classifyGhApiError)
      // is the expected shape of this branch; a bare `{ok:false,
      // failure:null}` (a write-time 404, unusual but structurally possible)
      // lands here too and is handled the same way. Holder identity is
      // unknown from the write response itself, so re-read the blob once,
      // best-effort, to name the winner in the contested report.
      // A genuine contest proves this run's belief about the tip was wrong —
      // discard the chain, same as the transient branch above.
      knownTip = null;
      const holder = holderFromFreshRead(deps, repoSlug, issue);
      const stop = stopOrSkip(issue, 'contested', 'contested', 3, { holder });
      if (stop !== null) return stop;
      continue;
    }
    // write.ok === true. A git-CAS success carries `commitSha` — the just-
    // pushed commit is the new branch tip, chainable into the next issue's
    // read with zero fetch. A contents-API success (git-CAS never attempted,
    // or fell back after a transport failure/exhausted retries) has no
    // commit sha to chain — discard, forcing the next issue's read to fetch
    // fresh (see the `knownTip` comment above `claimedThisRun`).
    knownTip = typeof write.commitSha === 'string' ? write.commitSha : null;

    // #1486: a permanent, zero-extra-cost record of which transport this
    // claim actually went through — `write.commitSha` is a string only on a
    // genuine git-CAS push success (claims-git-cas.js's writeClaimBlobGit);
    // every contents-API-success path (direct PUT, or the self-write
    // recheck after a rejected git-CAS/PUT) never sets it. This answers the
    // "trace which transport actually wrote" question a future incident
    // investigation would otherwise need temporary logging to answer.
    transportByIssue[issue] = typeof write.commitSha === 'string' ? 'git' : 'contents-api';

    // Post-write verification (#2073): a write the store reported `ok: true`
    // is not yet a confirmed claim — re-read before trusting it. `knownTip`
    // is the tip this same write just produced (git-CAS success) or `null`
    // (contents-API success, nothing to chain), matching the read this loop
    // would perform for the next target anyway. `verifyClaimLandedWithRetry`
    // (#2329) bounds a retry over this read specifically for the
    // `knownTip === null` case — see its own doc comment. `releaseThisIssue:
    // true` (the 6th arg to `stopOrSkip`) is what stops a write that landed
    // but couldn't be confirmed from leaking past this run's own abort — see
    // `abort()`'s doc comment.
    if (!verifyClaimLandedWithRetry(deps, repoSlug, issue, opts.runId, knownTip)) {
      const stop = stopOrSkip(issue, 'unverified', 'unverified', 5, {}, true);
      if (stop !== null) return stop;
      continue;
    }

    claimedThisRun.push(issue);

    try {
      ensureAndAddLabel(deps.gh, issue);
    } catch (e) {
      labelFailures.push({ issue, error: errText(e) });
    }

    try {
      deps.gh(['issue', 'comment', String(issue), '--body', payload.commentBody]);
    } catch {
      try {
        deps.gh(['issue', 'comment', String(issue), '--body', payload.commentBody]);
      } catch (e2) {
        deps.stderr(`claim-targets: claim comment failed for #${issue} (claim stands) — ${errText(e2)}\n`);
      }
    }
  }

  // #2775: a successful claim must leave the Step 2.8 claim-log line itself
  // rather than relying on the dispatched agent to hand-type it afterward
  // (flow/claim-targets.md's "Log the claim" — the gap 33/48 dispatch-minted
  // runs since #2861 hit). Best-effort, same posture as labelFailures above:
  // a write failure here never un-claims the target and never changes the
  // exit code. Only attempted — and only added to the envelope — when the
  // caller passed `--run`, so the envelope stays byte-identical for every
  // existing caller/test that never does.
  const claimLogFailures = [];
  if (opts.runDir !== null) {
    for (const issue of claimedThisRun) {
      try {
        deps.appendClaimLog({ runDir: opts.runDir, issue, transport: transportByIssue[issue] });
      } catch (e) {
        const error = errText(e);
        claimLogFailures.push({ issue, error });
        deps.stderr(`claim-targets: claim-log write failed for #${issue} (claim stands) — ${error}\n`);
      }
    }
  }

  deps.stdout(JSON.stringify({
    claimed: claimedThisRun, alreadyOwned, skipped, labelFailures, transportByIssue,
    ...(opts.runDir !== null ? { claimLogFailures } : {}),
  }));
  return 0;
}

module.exports = {
  run, parseArgs, parseTargets, USAGE, FLOW_STEPS, BOT_IN_PROGRESS, ABORT_REASON, defaultAppendClaimLog,
};
