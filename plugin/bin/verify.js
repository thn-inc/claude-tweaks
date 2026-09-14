#!/usr/bin/env node
// plugin/bin/verify.js — deterministic verification runner (#892).
// The caller resolves the project's check commands (verification.md Step 1)
// and passes each as --cmd <name>=<command>; this CLI owns execution order,
// per-check log capture, exit-code keying, bounded extraction, and
// report.json. It never reads .claude-tweaks/policy.yml or CLAUDE.md —
// command resolution stays caller-side (spec: Option A boundary). Reading
// git and its own artifacts (the #1921 pass stamp) stays inside that boundary.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, UsageError, USAGE } = require('./lib/verify/args');
const { runChecks, runOne } = require('./lib/verify/run');
const {
  sniffFamily, extractFailingRegion, parseCounts, summaryLine, extractFailingFiles, stripAnsi,
} = require('./lib/verify/extract');
const { planRetry, runRetries, flakyCaveatLines } = require('./lib/verify/flaky');
const { gitInfo, gitDir: resolveGitDir, composeReport, writeReportAtomic } = require('./lib/verify/report');
const {
  readStamp: readCountStamp, detectRegression, caveatLine,
  nextFlakyHits, flakyEscalations, escalationCaveatLine,
} = require('./lib/verify/count-stamp');
const { writeFileAtomic } = require('./lib/atomic-write');
const { composeStamp, writeStamp, readStamp: readVerifyStamp, anchorOf } = require('./lib/verify/stamp');
const { readDeclaration } = require('./lib/verify/declaration');
const {
  changedFiles, resolveBase, usableAnchor, ChangedFilesError,
} = require('./lib/verify/changed-files');
const { selectScope } = require('./lib/verify/scope');
const { resolveTarget } = require('./lib/stage-item/write');
const { appendEvent } = require('./lib/hooks/context');

const KNOWN_SCOPES = new Set(['full', 'scoped', 'none', 'static-only', 'tool-scoped']);

function enrich(result) {
  if (result.skipped) return result;
  let text = '';
  try {
    text = fs.readFileSync(result.logPath, 'utf8');
  } catch {
    // Unreadable log degrades to absence, never to a fabricated pass —
    // summary/region/counts stay empty; exitCode still decides pass/fail.
    return { ...result, summary: result.spawnError || null, failingRegion: null, counts: null };
  }
  // #1837: strip ANSI once, before every parser — a coloured vitest/jest
  // summary line is otherwise invisible to the anchored regexes below. The
  // raw log file on disk stays raw; only this in-memory copy is stripped.
  const plain = stripAnsi(text);
  const family = sniffFamily(plain);
  const failed = result.exitCode !== 0;
  const counts = parseCounts(plain, family);
  return {
    ...result,
    summary: result.spawnError || summaryLine(plain, family) || null,
    failingRegion: failed ? extractFailingRegion(plain, family) : null,
    counts,
    // A tests check whose counts didn't parse — surfaced on the report entry
    // only when a count-stamp comparison is actually in play (main() gates
    // this on countStampPath before it reaches composeReport).
    ...(result.name === 'tests' && counts === null ? { countsFamily: family } : {}),
  };
}

function statusOf(check) {
  if (check.skipped) return `skipped: ${check.skipped}`;
  if (check.exitCode === 0 && check.flakyRetried && check.flakyRetried.length) return `pass (flaky-retried: ${check.flakyRetried.join(', ')})`;
  return check.exitCode === 0 ? 'pass' : 'fail';
}

function realpathOrNull(targetPath) {
  try { return fs.realpathSync(targetPath); } catch { return null; }
}

// --stamp-status (#1921): a read of the runner's own artifact. Status is data,
// never a failure — exit 0 in every case, including "no checkout at all".
// `dirty` and `head` are recomputed fresh from the live tree, never echoed
// from the stored stamp (spec Gotchas: a tree that went dirty after a clean
// pass reports match:false).
function stampStatus(parsed) {
  const ownGitDir = resolveGitDir();
  const gitDir = parsed.gitDir || ownGitDir;
  const stamp = gitDir ? readVerifyStamp(gitDir) : null;
  const git = gitDir ? gitInfo() : { sha: null, dirty: null };
  const present = stamp !== null;
  const scope = present ? (stamp.scope || null) : null;
  // An explicit --git-dir that is not this checkout's own git dir can never
  // match: head/dirty above are always the invoking cwd's (gitInfo() takes
  // no directory argument), so a foreign --git-dir's stamp is still read and
  // reported, but never trusted as verifying THIS cwd's HEAD — otherwise a
  // sibling checkout sitting at the same commit could read match:true for a
  // verification it never ran (review finding, refs #1921).
  const requestedGitDir = parsed.gitDir ? realpathOrNull(parsed.gitDir) : null;
  const resolvedOwnGitDir = ownGitDir ? realpathOrNull(ownGitDir) : null;
  const foreignGitDir = Boolean(parsed.gitDir)
    && (requestedGitDir === null || resolvedOwnGitDir === null || requestedGitDir !== resolvedOwnGitDir);
  // A stamp recorded against a dirty tree (stored dirty !== false) can never
  // cover a verified-clean HEAD, regardless of the live tree's current state:
  // the write gate never consults dirty, so a stamp written mid-edit is
  // otherwise indistinguishable from one written on a pristine HEAD once the
  // edit is discarded. A legacy bare-SHA stamp carries no dirty field at all
  // — undefined is "not false", so it can never prove the tree was clean when
  // it was recorded either (review finding, refs #1921).
  const storedClean = present && stamp.dirty === false;
  const stampCoversCleanHead = !foreignGitDir && storedClean && git.sha !== null && stamp.sha === git.sha && git.dirty === false;
  const match = stampCoversCleanHead && scope === 'full';
  // verifiedHead (#1923): "HEAD is verified" for the re-verify sites — a
  // clean HEAD covered either by a full pass (match) or by a passing
  // scoped/none/static-only/tool-scoped run whose fullSha anchor is still an
  // ancestor of HEAD (the scoped run verified exactly the delta since that
  // anchor). Never true for a foreign --git-dir, a dirty tree, or a stamp
  // whose anchor a history rewrite stranded. `match` keeps its strict
  // full-pass meaning; Skip-if-recent and /review Step 1.5 read this field.
  // a stamp with no scope (corrupt/hand-edited) is unknown coverage, never verified
  const verifiedHead = stampCoversCleanHead
    && (scope === 'full' || (KNOWN_SCOPES.has(scope) && usableAnchor({ stamp }) !== null));
  const status = {
    present,
    sha: present ? stamp.sha : null,
    head: git.sha,
    dirty: git.dirty,
    scope,
    fullSha: present ? anchorOf(stamp) : null,
    match,
    verifiedHead,
    reportPath: present && typeof stamp.reportPath === 'string' ? stamp.reportPath : null,
    legacy: present ? stamp.legacy === true : false,
  };
  process.stdout.write(`${JSON.stringify(status)}\n`);
  process.exitCode = 0;
}

// --changed-files (#1923): the read-only "what changed in this run" set the
// skills consume — /claude-tweaks:test affected and the QA story filter read
// this instead of hand-rolling `git diff --name-only` (empty for every
// committed pipeline diff). Same base resolution as --scope: the checkout's
// own stamp anchor when usable, else --base / --integration-branch; an
// unresolvable base is exit 1 with a message, never an empty list.
function changedFilesMode(parsed) {
  const ownGitDir = resolveGitDir();
  const priorStamp = ownGitDir ? readVerifyStamp(ownGitDir) : null;
  let base;
  try {
    base = resolveBase({
      stamp: priorStamp, integrationBranch: parsed.integrationBranch, base: parsed.base, requireNonDegenerate: true,
    });
  } catch (err) {
    if (!(err instanceof ChangedFilesError)) throw err;
    process.stderr.write(`--changed-files: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  const { files } = changedFiles({ base });
  const result = { base, files };
  // #2486: a distinct signal for the degenerate case a caller would
  // otherwise only catch by independently cross-checking via `git diff` —
  // covers any remaining legitimate base===HEAD outcome (e.g. no
  // --integration-branch to fall through to, or the branch really is fully
  // merged into it) that the requireNonDegenerate skip above cannot resolve.
  const head = gitInfo().sha;
  if (head && base === head) {
    result.warning = 'resolved base equals HEAD — diff will be empty';
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 0;
}

async function main() {
  process.stdout.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n${USAGE}\n`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  if (parsed.stampStatus) { stampStatus(parsed); return; }
  if (parsed.changedFiles) { changedFilesMode(parsed); return; }

  // Default paths resolve against the checkout's own git dir (#1921) so the
  // canonical skill invocation is one plain command with no $(...)
  // substitutions (the worktree Bash-shape guard refuses two of them).
  // Explicit flags win; outside a checkout the tmpdir fallback stands and
  // no count stamp is persisted. Computed once (nit, re-review): the --scope
  // anchor read below (M5) needs this exact own-git-dir value too, never a
  // --git-dir override, so it is resolved here rather than a second time.
  const ownGitDir = resolveGitDir();
  const gitDir = parsed.gitDir || ownGitDir;
  const logDir = parsed.logDir
    || (gitDir ? path.join(gitDir, 'claude-tweaks-verify') : fs.mkdtempSync(path.join(os.tmpdir(), 'claude-tweaks-verify-')));
  fs.mkdirSync(logDir, { recursive: true });
  const jsonPath = parsed.json || path.join(logDir, 'report.json');
  const countStampPath = parsed.countStamp || (gitDir ? path.join(gitDir, 'claude-tweaks-test-count.json') : null);

  // --scope (#1922): declaration → changed files since the anchor → pure
  // selection → filtered check set. Without --scope every value below is
  // its full-run default and the run is byte-for-byte today's.
  let sel = null;
  let resolvedBase = null;
  let files = [];
  let cmds = parsed.cmds;
  let decl = null;
  let priorStamp = null;
  if (parsed.scope) {
    // Every --scope usage error below shares this exit shape (message, then
    // USAGE, then exit code 2); pulled into one helper so the five sites
    // differ only in their message.
    function scopeUsageExit(message) {
      process.stderr.write(`${message}\n${USAGE}\n`);
      process.exitCode = 2;
    }

    const read = readDeclaration(parsed.scope);
    if (!read.ok) {
      scopeUsageExit(read.errors.join('\n'));
      return;
    }
    decl = read.decl;

    // AC5 (review L13): the --cmd-name-vs-declaration check only needs decl,
    // so it runs immediately after the declaration is read — before any
    // anchor/base resolution below, so a bad --cmd name never pays for a git
    // call it doesn't need. H2's required-names check (below) cannot move
    // here: it needs `sel`, which needs the anchor resolved first.
    if (decl) {
      const allowed = new Set(['types', 'lint', ...decl.suites]);
      const bad = parsed.cmds.find((c) => !allowed.has(c.name));
      if (bad) {
        scopeUsageExit(`--scope: --cmd "${bad.name}" is not types, lint, or a declared suite (${decl.suites.join(', ')})`);
        return;
      }
    }

    // M5 (review): the anchor always reads THIS checkout's OWN git dir,
    // never an explicit --git-dir — the identical rule stampStatus() applies
    // above (a foreign --git-dir's stamp is read but never trusted): a
    // sibling checkout must never borrow another repo's pass as its own.
    // (ownGitDir is resolved once, above, alongside the default log-dir.)
    priorStamp = ownGitDir ? readVerifyStamp(ownGitDir) : null;

    try {
      resolvedBase = resolveBase({ stamp: priorStamp, integrationBranch: parsed.integrationBranch, base: parsed.base });
    } catch (err) {
      if (!(err instanceof ChangedFilesError)) throw err;
      scopeUsageExit(`--scope: ${err.message}`);
      return;
    }

    // H4 (review): an explicit --base that resolves to a commit other than
    // the stamp's own anchor is a contradiction, not a silent override — the
    // caller almost certainly meant the anchor, and running the diff against
    // the wrong base would silently under- or over-verify. usableAnchor is
    // the exact same "is this anchor still usable" test resolveBase's own
    // anchor-first path applies above — a bare rev-parse with no ancestor
    // check (the earlier version of this block) could reject a --base that
    // is legitimately correct once history was rewritten and the old anchor
    // stopped being an ancestor of HEAD, even though it still resolves to a
    // real (now-stranded) commit (#1922 re-review NEW-1).
    // Computed once, reused by the H4 --base check right below and by the
    // scope selection further down: a stamp whose anchor is not a usable
    // ancestor of HEAD (a rewritten/rebased history) must never reach
    // selectScope as if it were still valid — that would stamp a non-full
    // run with `base` pointing at today's merge-base but `fullSha` still
    // naming the stale anchor, breaking the base === fullSha invariant a
    // full run relies on. Passing `stamp: null` instead forces mode 'full'
    // (#1922 review finding: stale anchor must force a full run).
    const anchorSha = usableAnchor({ stamp: priorStamp });
    if (parsed.base) {
      if (anchorSha && resolvedBase !== anchorSha) {
        scopeUsageExit(`--scope: --base ${parsed.base} conflicts with the stamp anchor ${anchorSha.slice(0, 9)}; omit --base (pass --integration-branch instead) or clear the stamp`);
        return;
      }
    }

    files = changedFiles({ base: resolvedBase }).files;
    sel = selectScope({ decl, files, stamp: anchorSha ? priorStamp : null });
    if (decl) {
      cmds = parsed.cmds.filter((c) => {
        if (c.name === 'types' || c.name === 'lint') return sel.static;
        if (sel.mode === 'tool-scoped') return false;
        return sel.suites === '*' || sel.suites.includes(c.name);
      });
      if (sel.mode === 'tool-scoped') {
        cmds = cmds.concat([{ name: 'tests', command: decl.checks.tests.replace(/\{base\}/g, resolvedBase) }]);
      }
    }

    // H2 (review): a filtered check set that leaves out a name the selection
    // itself requires is a usage error, not a silently-partial run — every
    // suite/static check the selection says must run has to be among the
    // caller's --cmd names (minus `tests` under tool-scoped, which is
    // synthesized from decl.checks.tests rather than passed via --cmd).
    if (decl && sel.mode !== 'none') {
      const suiteNames = sel.suites === '*' ? decl.suites : sel.suites;
      const staticNames = sel.static ? ['types', 'lint'].filter((k) => decl.checks[k] !== null) : [];
      let required = [...suiteNames, ...staticNames];
      if (sel.mode === 'tool-scoped') required = required.filter((n) => n !== 'tests');
      const have = new Set(parsed.cmds.map((c) => c.name));
      const missing = required.filter((n) => !have.has(n));
      if (missing.length) {
        scopeUsageExit(`--scope: mode ${sel.mode} requires --cmd for: ${missing.join(', ')}`);
        return;
      }
    }
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  // Flaky retry (#1925): only a --scope run ever classifies or retries;
  // without --scope every failure is byte-for-byte today's. Eligible checks
  // are `tests` or a declared suite — never types/lint (run.js never offers
  // those to the hook either). The decision is recorded on the check whether
  // or not a retry ran, and whether or not `flaky.files` lists anything —
  // an empty/absent `flaky` declaration still needs a `retryDecision.reason`
  // recorded so #2026's no-parse/unlisted isolation-path selection has a
  // signal to read (`planRetry` already returns `retry: false` for an empty
  // allowlist, so gating classification on `flaky.files.length > 0` only
  // ever suppressed the decision, never changed whether a retry could run).
  const retryHook = async (result, ctx) => {
    if (!decl) return result;
    // `result.name === 'tests'` is belt-and-braces here: the --cmd-vs-
    // declaration check earlier already rejects an undeclared `tests`, and
    // tool-scoped mode's synthesized `tests` is always declared — so this
    // disjunct never actually widens eligibility beyond decl.suites.
    if (!(result.name === 'tests' || decl.suites.includes(result.name))) return result;
    let text = '';
    try { text = fs.readFileSync(result.logPath, 'utf8'); } catch { return { ...result, retryDecision: { retry: false, reason: 'unreadable-log' } }; }
    const plain = stripAnsi(text);
    const failingFiles = extractFailingFiles(plain, sniffFamily(plain));
    const plan = planRetry({ failingFiles, flaky: decl.flaky, retry: decl.retry, suite: result.name });
    const decision = plan.retry ? { retry: true, files: plan.files } : { retry: false, reason: plan.reason };
    if (!plan.retry) return { ...result, retryDecision: decision };
    const retried = await runRetries({
      check: result, plan, maxRetries: decl.flaky.maxRetries,
      logDir: ctx.logDir, runOne, spawnImpl: ctx.spawnImpl, now: ctx.now, cwd: ctx.cwd,
    });
    return { ...retried, retryDecision: decision };
  };
  const results = (sel && sel.mode === 'none' ? [] : (await runChecks({
    cmds, logDir, retry: retryHook, cwd: parsed.cwd,
  })).map(enrich)).map((c) => {
    // #1837: countsUnparsed is real report content only when a count stamp
    // is actually in play — never disable the comparison silently, but also
    // never surface the field when there is no comparison to have skipped.
    const { countsFamily, ...rest } = c;
    return countStampPath && countsFamily !== undefined
      ? { ...rest, countsUnparsed: { family: countsFamily } }
      : rest;
  });
  const retriedFiles = [...new Set(results.flatMap((c) => c.flakyRetried || []))];
  const git = gitInfo();

  // Suite-count regression stamp (#881, IL-84): the "tests" check's own
  // parsed count is compared against the previous run's persisted count.
  // --count-stamp is caller-resolved (verification.md Step 2) or defaults
  // under the git dir (#1921); outside a checkout with no flag, persistence
  // and comparison are disabled entirely.
  const testsCheck = results.find((c) => c.name === 'tests' && !c.skipped);
  const currentCount = testsCheck && testsCheck.counts && typeof testsCheck.counts.tests === 'number'
    ? { tests: testsCheck.counts.tests, sha: git.sha, recordedAt: startedAt }
    : null;
  let testCountRegression = null;
  let flakyEscalation = [];
  // H3 (review): a narrowed run's "tests" count is not comparable to a full
  // run's baseline — comparing it would fire a false CAVEAT, and persisting
  // it would silently corrupt the baseline the next full run reads against.
  // The flaky hit map (#1925) is the exception: it moves on any run that
  // retried, but only ever alongside a still-valid baseline — a non-full run
  // with no prior stamp has no `tests` to write and persists nothing.
  if (countStampPath) {
    const fullMode = !sel || sel.mode === 'full';
    const previousCount = readCountStamp(countStampPath);
    if (fullMode) testCountRegression = detectRegression(previousCount, currentCount);
    // decl === null means no declaration was read at all (no --scope, or
    // --scope with a missing file) — that is not the same as "the
    // allowlist is empty" (parse-signal discipline), so nextFlakyHits gets
    // null rather than [] and carries every prior hit count forward as-is.
    const allowlist = decl ? decl.flaky.files : null;
    const hits = nextFlakyHits(previousCount, retriedFiles, allowlist);
    flakyEscalation = flakyEscalations(hits);
    let toWrite = null;
    if (fullMode && currentCount !== null) toWrite = { ...currentCount, flakyHits: hits };
    // Deliberately NOT gated on `!fullMode`: a full run with a retry but an
    // unparseable count (currentCount === null) still persists the hit
    // under the previous baseline (H3-safe), and gating it here would make
    // the escalation counter lossy exactly when suite output stops parsing.
    else if (retriedFiles.length > 0 && previousCount !== null) toWrite = { ...previousCount, flakyHits: hits };
    if (toWrite !== null) {
      // Fail-toward-absence on the write side too (readStamp already does
      // this on read): a stamp-write failure (ENOSPC, EACCES, a
      // --count-stamp path whose parent directory doesn't exist) must never
      // crash the whole run and discard an otherwise-passing report — this
      // is a caveat/surfacing mechanism, not a hard gate (count-stamp.js's
      // own stated intent). report.json's own write below is deliberately
      // unguarded: it IS the run's output, so a failure there must surface.
      try {
        fs.mkdirSync(path.dirname(countStampPath), { recursive: true });
        writeFileAtomic(countStampPath, `${JSON.stringify(toWrite, null, 2)}\n`);
      } catch { /* best-effort persistence; next run simply has no baseline */ }
    }
  }

  const mode = sel ? sel.mode : 'full';
  // L16 (review): report.json's scope.suites is always an array, never the
  // internal '*' shorthand scope.js uses — the declared suite list when the
  // declaration says "everything", else the actual --cmd names run when
  // there is no declaration at all to name them.
  let scopeSuites = null;
  if (sel) {
    scopeSuites = sel.suites === '*'
      ? (decl ? decl.suites : cmds.filter((c) => c.name !== 'types' && c.name !== 'lint').map((c) => c.name))
      : sel.suites;
  }

  const report = composeReport({
    checks: results, startedAt, durationMs: Date.now() - startMs, git, testCountRegression,
    scope: sel ? { mode: sel.mode, suites: scopeSuites, static: sel.static, base: resolvedBase, unmatched: sel.unmatched, changedFiles: files, matched: sel.matched } : null,
    flakyEscalation,
  });
  writeReportAtomic(report, jsonPath);

  // Verify event (#1928): the runner is the mechanical source for the
  // tasks→test phase boundary (bin/lib/timing/derive.js). Written only when
  // the caller named a run dir; the canonical skill snippet passes
  // --run "$PIPELINE_RUN_DIR" unconditionally, so an unset variable arrives
  // as "" and means "no run". A path that is not anchored under the main
  // checkout's pipelines tree (a worktree-local shadow, [IL-127]) is refused
  // aloud — never written silently, never fatal to the run.
  if (parsed.run) {
    const target = resolveTarget({ runDir: parsed.run });
    if (!target.ok) {
      process.stderr.write(`verify.js: --run ${parsed.run} refused (${target.reason}) — not an anchored run directory under the main checkout ([IL-127]); no verify event written\n`);
    } else {
      appendEvent(target.dir, 'verify', {
        mode: report.scope ? report.scope.mode : 'full',
        suitesRun: results.filter((c) => !c.skipped).map((c) => c.name),
        durationMs: report.durationMs,
        pass: report.pass,
        sha: git.sha,
        flakyRetried: retriedFiles,
        reportPath: jsonPath,
      });
    }
  }

  // Verification pass stamp (#1921): the runner is the ONLY writer, and only
  // for a passing run of the full resolved set — every --cmd check ran, none
  // was fail-fast skipped (#1784: an agent-written stamp let a failing run
  // stamp a pass). `dirty` never gates the write; --stamp-status's match
  // rule already requires dirty === false. --no-stamp is the caller's
  // declaration that this --cmd set is deliberately partial. The write is
  // best-effort like the count stamp: a stamp failure never fails the run.
  // Under --scope the stamp's scope names exactly what ran; only a full run
  // advances fullSha (#1922).
  const fullSet = results.every((c) => !c.skipped);
  // M6 (review): a --scope run at an unchanged HEAD (clean tree, same sha as
  // the prior FULL stamp) never downgrades that stamp. Its own selection
  // legitimately found nothing to do (mode 'none') — that is not evidence
  // the last full pass stopped being true, so the full stamp must stand.
  const unchangedHeadNoop = Boolean(
    sel && sel.mode !== 'full' && priorStamp && priorStamp.scope === 'full'
    && priorStamp.sha === git.sha && git.dirty === false,
  );
  // Belt-and-braces (H2 review): even if a filtered set somehow came out
  // empty for a mode other than 'none' (H2 above should already refuse
  // that as a usage error), never let it stamp — an empty run proves
  // nothing about the checks that mode claims to have covered.
  const emptyNonNoneRun = results.length === 0 && mode !== 'none';
  // An explicit --git-dir redirects logs and the count stamp only; the pass
  // stamp keys on the invoking cwd's HEAD, which may not be that repo's.
  if (
    report.pass && fullSet && !parsed.noStamp && gitDir && git.sha && !parsed.gitDir
    && !unchangedHeadNoop && !emptyNonNoneRun
  ) {
    const suitesRun = results.filter((c) => c.name !== 'types' && c.name !== 'lint').map((c) => c.name);
    const stamp = composeStamp({
      report, scope: mode,
      fullSha: mode === 'full' ? git.sha : sel.base,
      base: mode === 'full' ? null : resolvedBase,
      changedFiles: mode === 'full' ? [] : files,
      suitesRun, flakyRetried: retriedFiles, reportPath: path.resolve(jsonPath), at: new Date().toISOString(),
    });
    // H1 (review): the legacy bare-SHA twin only ever names a real FULL
    // pass — a narrowed run leaves it untouched rather than repointing it
    // at a sha that a scoped/tool-scoped/none run never fully verified.
    try { writeStamp(gitDir, stamp, { legacy: mode === 'full' }); } catch { /* best-effort; next --stamp-status simply reads absent */ }
  }

  const lines = [];
  if (sel) {
    const suiteList = sel.suites === '*' ? 'all' : (sel.suites.length ? sel.suites.join(', ') : 'none');
    const shortBase = String(resolvedBase).slice(0, 9);
    const sinceClause = `${files.length} changed file(s) since ${shortBase}`;
    // L10 (review): decl === null means "no declaration on disk" — name the
    // path so the caller can tell that apart from a genuine full-mode
    // selection outcome, while keeping the same trailing fields.
    const lead = decl === null ? `Scope: full — no declaration at ${parsed.scope}; ${sinceClause}` : `Scope: ${sel.mode} — ${sinceClause}`;
    lines.push(`${lead}; suites: ${suiteList}; static: ${sel.static ? 'yes' : 'no'}; unmatched: ${sel.unmatched.length}`);
    if (sel.mode === 'none') {
      // Nit (re-review): an unchanged-HEAD re-run (M6's own scenario) has
      // zero changed files — "bookkeeping-only delta ()" reads as broken
      // rather than "nothing to verify".
      lines.push(files.length
        ? `still-verified: bookkeeping-only delta (${files.join(', ')})`
        : `still-verified: no changes since ${shortBase}`);
    }
    lines.push('');
  }
  lines.push('| Check | Status | Duration | Summary |', '|---|---|---|---|');
  for (const check of results) {
    const duration = check.skipped ? '—' : `${(check.durationMs / 1000).toFixed(1)}s`;
    let summary = check.skipped ? '—' : (check.summary || '—');
    // #2026: a `no-parse` retryDecision means extractFailingFiles could not
    // name a file for this failure — the stdout summary surfaces that the
    // whole-suite re-run isolation path applies, so it's visible without
    // opening report.json.
    if (!check.skipped && check.exitCode !== 0 && check.retryDecision && check.retryDecision.reason === 'no-parse') {
      const clause = '(retry: no-parse — whole-suite re-run applies)';
      summary = check.summary ? `${summary} ${clause}` : clause;
    }
    lines.push(`| ${check.name} | ${statusOf(check)} | ${duration} | ${summary} |`);
  }
  for (const check of results) {
    if (!check.skipped && check.exitCode !== 0 && check.failingRegion) {
      lines.push('', `### ${check.name} failing region (full log: ${check.logPath})`, check.failingRegion);
    }
  }
  if (testCountRegression) lines.push('', caveatLine(testCountRegression));
  // #1837: a tests check whose counts didn't parse (with a count stamp in
  // play) silently disabled the regression comparison before this line
  // existed — make the skip visible instead of a fabricated non-regression.
  for (const check of results) {
    if (check.countsUnparsed) {
      lines.push('', `CAVEAT: tests counts unparsed (family ${check.countsUnparsed.family}) — count-stamp comparison skipped; see ${check.logPath}`);
    }
  }
  for (const line of flakyCaveatLines(results)) lines.push('', line);
  for (const e of flakyEscalation) lines.push('', escalationCaveatLine(e));
  lines.push('', `report: ${jsonPath}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = report.pass ? 0 : 1;
}

main().catch((err) => {
  process.stderr.write(`verify.js: ${String((err && err.stack) || err)}\n`);
  process.exitCode = 1;
});
