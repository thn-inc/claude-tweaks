#!/usr/bin/env node
// bin/materialize.js — record-to-build-time-file materialization in one command.
//   node bin/materialize.js <n> --run-dir <dir> [--repo owner/name] [--ceremony fast-lane|standard] [--multi-record-slug <n>] [--record-json <path>] [--help]
// Implements skills/flow/materialize.md's Resolution + Materialization hard
// gate + header composition + write, for `work-backend: github-issues`
// records — the CLI both `/flow` and `/build` invoke instead of hand-
// composing the header inline every run. `work-backend: local-files` is not
// yet wired into this CLI (its own read path differs enough — local-store.js
// vs. `gh issue view` — to warrant its own follow-up rather than a half-done
// branch here); that driver still uses the skill's own inline read.
// Prints one JSON envelope on success. Exit 0 on success; 1 when the
// record's own body fails the shape gate (points at /claude-tweaks:specify,
// same as the skill does); 2 on a malformed invocation, an unanchored
// --run-dir (#790/[IL-127] — a foreign-checkout shadow, or a path with no
// determinable git repository root; #959 — a --run-dir resolving INSIDE the
// current linked worktree is anchored-equivalent and accepted, since this
// CLI only ever writes to that worktree's own work/{n}-spec.md), an
// unresolved record, or when `gh` is absent. #1210: when cwd is itself
// inside a linked worktree but --run-dir resolves somewhere else — the main
// checkout (the standard $PIPELINE_RUN_DIR shape every other --run/--run-dir
// consumer expects, passed unmodified from inside a worktree) or a DIFFERENT
// linked worktree — the write target is rewritten to cwd's own worktree-local
// equivalent (same run-id, same relative structure) rather than trusting the
// caller, with an informational (non-fatal) stderr note naming both roots.
// #1459: --record-json <path> lets a gh-absent caller (one with MCP
// issue_read access instead) supply an already-fetched record — same JSON
// shape `gh issue view <n> --json number,title,body,labels,url` returns —
// in place of this CLI shelling out to `gh` itself. When passed,
// deps.ghAvailable()/deps.ghView() are never consulted; everything
// downstream (shapeGate, drift, liftMetadata, composeHeader, composeFile)
// is unchanged, since it already operates on the parsed `record` object
// regardless of how it arrived.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  parseRecordFacets, extractFingerprint, extractVerifiedAsOf, extractPremiseCheck, parseDependencies,
} = require('./lib/issues/record');
const { shapeGate, liftMetadata, composeHeader, composeFile } = require('./lib/issues/materialize-format');
const { findSiblingPremiseDisproof } = require('./lib/issues/sibling-premise');
const wtDetect = require('./lib/hooks/worktree-detect');
const { parseRepo, ghAvailable, repoSlug } = require('./lib/repo-resolve');
const { formatEntry, appendEntry, resolveTarget: resolveDecisionTarget } = require('./lib/log-decision/append');
const { resolveTarget: resolveStageTarget, writeStagedItem } = require('./lib/stage-item/write');

const USAGE = 'usage: materialize.js <n> --run-dir <dir> [--repo owner/name] [--ceremony fast-lane|standard] [--multi-record-slug <n>] [--record-json <path>] [--help]\n';

const isPos = (n) => Number.isInteger(n) && n > 0;

// #117 AC3: the threshold (commit distance from the record's own
// Verified-as-of: stamp to this checkout's current HEAD) past which
// materialize surfaces an explicit drift statement instead of staying
// silent. A judgment default, not a protocol constant — tune here if it
// proves noisy for a given project's commit cadence; no policy lever yet.
const DRIFT_THRESHOLD_COMMITS = 50;

// sha -> { sha, commits, ageDays, stale } | null. null means "could not
// compute" (no stamp on the record, or the stamped sha isn't reachable from
// HEAD in this checkout — e.g. a shallow clone) — never an error; a
// consumer that can't compute drift simply says nothing about it, per
// [IL-71]'s own posture: absence of a stamp/computation is not itself
// evidence the body is fresh.
function computeDrift(sha, deps) {
  if (!sha) return null;
  let commits;
  try {
    commits = Number(String(deps.gitRevListCount(sha)).trim());
  } catch {
    return null;
  }
  if (!Number.isFinite(commits)) return null;
  let ageDays = null;
  try {
    const iso = String(deps.gitCommitDate(sha)).trim();
    const then = iso ? new Date(iso).getTime() : NaN;
    if (Number.isFinite(then)) ageDays = Math.max(0, Math.floor((Date.now() - then) / 86400000));
  } catch {
    // Elapsed time is supplementary — commit distance alone is enough to judge staleness.
  }
  return { sha, commits, ageDays, stale: commits >= DRIFT_THRESHOLD_COMMITS };
}

// #1829: the CLI's usual short timeout for a bound-but-arbitrary command a
// record body names (same order of magnitude as repo-resolve.js's
// GH_TIMEOUT_MS) — bound so a hostile or hung Premise-check: command can
// never stall materialize.
const PREMISE_CHECK_TIMEOUT_MS = 5000;

// Security fix (whole-branch pre-release review, base b9c8bbd86): a
// `Premise-check:` line is body text — anyone who can create or edit the
// record's issue can write one, regardless of whether it was actually
// composed by specShapedBody's premiseCheck param (record.js's own comment
// states that as a convention, never an enforced gate). Trust it only when
// GitHub itself attests the issue author has a real relationship to this
// repo (author_association, from the REST API — not body content, which is
// exactly the attacker-controlled surface). This is the same mitigation
// class GitHub Actions guidance uses for privileged automation triggered by
// issue/PR content. An untrusted or unresolvable association degrades to
// "no premise check" — never a hard stop, matching this feature's existing
// fail-open posture (computePremise's own degrade-to-null on a throwing
// runner).
const TRUSTED_AUTHOR_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const AUTHOR_ASSOCIATION_TIMEOUT_MS = 5000;

// command -> exit code, run from the checkout root. Distinguishes "the
// command ran and exited non-zero" (a normal outcome — execFileSync throws
// on any non-zero exit, so this unwraps err.status back into a plain
// return) from "the command could not be run at all" (ENOENT on /bin/sh,
// a timeout — no exit code exists, so this re-throws for computePremise's
// own catch to degrade to null).
function runPremiseCheckDefault(command) {
  try {
    execFileSync('/bin/sh', ['-c', command], { stdio: 'ignore', timeout: PREMISE_CHECK_TIMEOUT_MS });
    return 0;
  } catch (err) {
    if (typeof err.status === 'number') return err.status;
    throw err;
  }
}

// command -> { command, exit, satisfiedAtBase } | null. null means "no
// Premise-check: line" (the common case — every existing record behaves
// byte-identically) OR "the command could not be run at all" (mirrors
// computeDrift's own degrade-to-null-on-throw posture above — a hostile or
// broken command must never crash materialize). satisfiedAtBase is true
// when the command exits NON-zero: per specShapedBody's premiseCheck
// contract, the command is written to exit 0 while the premise (the
// record's Current State claim) still holds, so a non-zero exit means the
// claim no longer holds at this checkout's base — the record's work may
// already be done.
function computePremise(command, deps) {
  if (!command) return null;
  let exit;
  try {
    exit = deps.runPremiseCheck(command);
  } catch {
    return null;
  }
  return { command, exit, satisfiedAtBase: exit !== 0 };
}

function parseArgs(argv) {
  const opts = {
    n: null, runDir: null, repo: null, ceremony: null, multiRecordSlug: null, recordJson: null, help: false,
  };
  if (argv[0] === '--help' || argv[0] === '-h') { opts.help = true; return opts; }
  if (argv[0] === undefined || argv[0].startsWith('--')) return { error: 'missing <n> argument' };
  opts.n = Number(argv[0]);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--run-dir') {
      // A blank or whitespace-only value (the shape an unset
      // $PIPELINE_RUN_DIR expands to in shell) is treated as no value at
      // all — the existing `if (!opts.runDir)` check below already rejects
      // it before any guard or I/O runs (#1138).
      const v = next();
      opts.runDir = v && v.trim() !== '' ? v : null;
    }
    else if (a === '--repo') opts.repo = next();
    else if (a === '--ceremony') opts.ceremony = next();
    else if (a === '--multi-record-slug') opts.multiRecordSlug = next();
    else if (a === '--record-json') opts.recordJson = next();
    else return { error: `unknown argument: ${a}` };
  }
  return opts;
}

const realDeps = {
  ghView: (owner, repo, n, host) => execFileSync('gh', ['issue', 'view', String(n), '--repo', repoSlug({ host, owner, repo }), '--json', 'number,title,body,labels,url'], { encoding: 'utf8' }),
  // #2590: closed PRs referencing this issue, searched by body text — used
  // to detect a sibling attempt that already reached this record's own
  // "premise disproved" conclusion. Read-only; no author-association gate
  // needed (unlike ghAuthorAssociation/runPremiseCheck, nothing here
  // executes body content — it only searches and pattern-matches it).
  ghSearchClosedPRs: (owner, repo, n, host) => execFileSync('gh', ['pr', 'list', '--repo', repoSlug({ host, owner, repo }), '--state', 'closed', '--search', `#${n} in:body`, '--json', 'number,url,body'], { encoding: 'utf8' }),
  // Security fix (see TRUSTED_AUTHOR_ASSOCIATIONS above): GitHub's REST API
  // computes author_association from the issue author's *current* repo
  // relationship — not body content, so it can't be spoofed by editing the
  // issue. `gh issue view --json` has no such field to request; the REST
  // endpoint does. Only called when a Premise-check: line is actually
  // present (the uncommon case) — every other record pays no extra call.
  ghAuthorAssociation: (owner, repo, n, host) => String(
    execFileSync(
      'gh',
      ['api', `repos/${owner}/${repo}/issues/${n}`, '--jq', '.author_association']
        .concat(host && host !== 'github.com' ? ['--hostname', host] : []),
      { encoding: 'utf8', timeout: AUTHOR_ASSOCIATION_TIMEOUT_MS },
    ),
  ).trim(),
  ghAvailable,
  remoteUrl: () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }),
  // #117: commit distance from a record's Verified-as-of: stamp to current
  // HEAD, and that commit's own date — both scoped to computeDrift above.
  gitRevListCount: (sha) => execFileSync('git', ['rev-list', '--count', `${sha}..HEAD`], { encoding: 'utf8' }),
  gitCommitDate: (sha) => execFileSync('git', ['show', '-s', '--format=%cI', sha], { encoding: 'utf8' }),
  // #1829: the Premise-check: command, run from the checkout root.
  runPremiseCheck: runPremiseCheckDefault,
  cwd: () => process.cwd(),
  mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
  isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
  // #959: this CLI only ever writes to `{run-dir}/work/{n}-spec.md` (or the
  // multi-record `{run-dir}/spec-{slug}/work/{n}-spec.md`) — see the workDir/
  // outFile composition below — so a --run-dir resolving inside a linked
  // worktree is the documented exception (_shared/pipeline-run-dir.md's
  // Anchoring section), not a shadow to reject. `isAnchoredUnderRoot` can't
  // answer this itself: it requires the nearest `.git` to be a DIRECTORY,
  // which a linked worktree's `.git` FILE pointer never is by construction.
  isInsideLinkedWorktree: (resolvedPath) => wtDetect.repoInfo(resolvedPath).isLinkedWorktree,
  // #1210: cwd's OWN worktree membership — distinct from isInsideLinkedWorktree
  // above, which classifies the resolved --run-dir, not cwd. Returns the
  // linked worktree's own root (repoInfo's --show-toplevel of cwd, which for
  // a linked worktree is that worktree's root, never the main checkout) when
  // cwd sits inside one, or null when cwd is the main checkout itself (or
  // worktree membership can't be determined).
  cwdWorktreeRoot: (cwd) => {
    const info = wtDetect.repoInfo(cwd);
    return info.isLinkedWorktree ? info.repoRoot : null;
  },
  // #1210 follow-up (review finding): the run-dir counterpart of
  // cwdWorktreeRoot above — the resolved --run-dir's own worktree root. Lets
  // the guard below tell "run-dir points at cwd's own worktree" (correct, no
  // rewrite) apart from "run-dir points at a DIFFERENT worktree entirely"
  // (the same silent stray write as the main-checkout case, just lateral).
  // Returns null on the same terms as cwdWorktreeRoot.
  runDirWorktreeRoot: (resolvedPath) => {
    const info = wtDetect.repoInfo(resolvedPath);
    return info.isLinkedWorktree ? info.repoRoot : null;
  },
  mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
  writeFile: (file, content) => fs.writeFileSync(file, content),
  // #1459: the --record-json read. A plain UTF-8 file read, seamed through
  // deps like every other filesystem/process touch in this file so tests
  // never hit the real filesystem for it either.
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch gh, git, or the filesystem.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!isPos(opts.n)) { deps.stderr('malformed <n> — must be a positive integer\n' + USAGE); return 2; }
  if (!opts.runDir) { deps.stderr('missing required --run-dir\n' + USAGE); return 2; }
  {
    // #790/[IL-127]: reject an unanchored --run-dir before any gh/git/fs
    // work. cwd/mainRoot are read through deps (not process.cwd()/wtDetect
    // directly) so this guard honors the "all I/O through deps" seam this
    // file's own header comment promises.
    const cwd = deps.cwd();
    const mainRoot = deps.mainRoot(cwd);
    if (!mainRoot) {
      // Distinct from the anchoring-rejection case below: no git repo could
      // be determined at all (not a repo, an unreadable ancestor, an
      // unparseable .git file) — misdiagnosing this as a worktree-shadow
      // rejection would send a reader hunting for the wrong problem.
      deps.stderr(`materialize.js: ${wtDetect.unanchoredRunDirNoRepoMessage(cwd)}\n`);
      return 2;
    }
    const resolvedRunDir = path.resolve(cwd, opts.runDir);
    // #959: a --run-dir resolving inside a linked worktree is not a shadow —
    // it's the documented route for this CLI's own write (work/{n}-spec.md),
    // which only ever lands under here. See isInsideLinkedWorktree above.
    const anchoredToMain = deps.isAnchored(resolvedRunDir, mainRoot);
    // Lazy, matching the original short-circuit: anchoredToMain and "inside
    // a linked worktree" are mutually exclusive by construction (a resolved
    // path is under the main checkout OR under some worktree, never both),
    // so isInsideLinkedWorktree is never called when anchoredToMain is
    // already true — preserves every existing fixture/deps object that,
    // like this file's own pre-#1210 shape, only ever defines
    // isInsideLinkedWorktree for the anchoredToMain:false path.
    const insideLinkedWorktree = anchoredToMain ? false : deps.isInsideLinkedWorktree(resolvedRunDir);
    if (!anchoredToMain && !insideLinkedWorktree) {
      deps.stderr(`materialize.js: ${wtDetect.unanchoredRunDirShadowMessage(opts.runDir, mainRoot)}\n`);
      return 2;
    }
    // #1210 (+ follow-up, same review pass): both checks above pass without
    // ever asking whether the run-dir points at cwd's OWN worktree. When cwd
    // sits inside a linked worktree and the run-dir resolves anywhere else —
    // the main checkout (a caller passing the ordinary $PIPELINE_RUN_DIR
    // shape unmodified from inside a worktree) or a different worktree (a
    // stale/foreign run dir from another worktree session) — writing there is
    // exactly the silent stray write materialize.md's own worktree-first-
    // ordering prose warns against; that ordering requires the write to land
    // on the feature branch instead. Rewrite the target to cwd's own
    // worktree-local equivalent (same run-id, same relative structure).
    const cwdWorktreeRoot = deps.cwdWorktreeRoot(cwd);
    if (cwdWorktreeRoot) {
      // Past the guard above, !anchoredToMain implies insideLinkedWorktree,
      // so the run-dir is anchored under exactly one of these two roots.
      const sourceRoot = anchoredToMain ? mainRoot : deps.runDirWorktreeRoot(resolvedRunDir);
      if (sourceRoot && sourceRoot !== cwdWorktreeRoot) {
        const rewritten = path.join(cwdWorktreeRoot, path.relative(sourceRoot, resolvedRunDir));
        const whereItResolves = anchoredToMain
          ? `resolves to the main checkout (${sourceRoot})`
          : `resolves inside a different worktree (${sourceRoot})`;
        deps.stderr(
          `materialize.js: --run-dir ${opts.runDir} ${whereItResolves} but cwd is `
          + `inside worktree ${cwdWorktreeRoot} — writing to the worktree-local equivalent (${rewritten}) instead.\n`,
        );
        opts.runDir = rewritten;
      }
    }
  }
  if (opts.ceremony && opts.ceremony !== 'fast-lane' && opts.ceremony !== 'standard') { deps.stderr('--ceremony must be fast-lane or standard\n' + USAGE); return 2; }

  let record;
  // Populated only on the gh-backed path below — carries owner/repo/host for
  // the author-association lookup the premise-check gate needs further down.
  let repoSpec = null;
  if (opts.recordJson) {
    // #1459: the gh-absent path — deps.ghAvailable()/deps.ghView() are never
    // consulted here, and no owner/repo resolution is needed since nothing
    // downstream of this branch calls gh.
    try {
      record = JSON.parse(deps.readFile(opts.recordJson));
    } catch (err) {
      deps.stderr(`materialize.js: Record #${opts.n} could not be resolved (--record-json ${opts.recordJson} could not be read or parsed). ${err && err.message ? err.message : ''}\n`);
      return 2;
    }
  } else {
    if (!deps.ghAvailable()) {
      deps.stderr('materialize.js: `gh` is required (work-backend: github-issues) — or pass --record-json <path> to supply an already-fetched record\n');
      return 2;
    }

    let remote = null;
    if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
    repoSpec = opts.repo ? parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`) : parseRepo(remote);
    if (!repoSpec) { deps.stderr('materialize.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
    const { host, owner, repo } = repoSpec;

    try {
      record = JSON.parse(deps.ghView(owner, repo, opts.n, host));
    } catch (err) {
      deps.stderr(`materialize.js: Record #${opts.n} could not be resolved (\`gh issue view ${opts.n}\` failed — check the issue exists in this repo). ${err && err.message ? err.message : ''}\n`);
      return 2;
    }
  }

  const gate = shapeGate(record.body);
  if (!gate.ok) {
    deps.stderr(`materialize.js: Record #${opts.n} is not spec-shaped (${gate.missing.join(', ')}) — run \`/claude-tweaks:specify #${opts.n}\` first.\n`);
    return 1;
  }

  // #117 AC3: this record's own Verified-as-of: stamp (present when it was
  // filed by one of the four health-sweep skills, absent otherwise — a
  // human-filed or /capture-originated record has nothing to compare). A
  // fresh stamp bounds drift; it never establishes correctness, so this is
  // an advisory line, not a gate — [IL-71]'s re-verification instruction
  // stays in force regardless of what this says.
  const verifiedAsOf = extractVerifiedAsOf(record.body);
  const drift = verifiedAsOf ? computeDrift(verifiedAsOf, deps) : null;
  if (drift && drift.stale) {
    const ageNote = drift.ageDays === null ? '' : `, ~${drift.ageDays}d old`;
    deps.stderr(
      `materialize.js: Record #${opts.n}'s premise is ${drift.commits} commits old${ageNote} `
      + `(verified-as-of ${drift.sha}) — re-derive facts against current HEAD before implementing.\n`,
    );
  }

  // #1829: a mechanical Premise-check: command — distinct from the
  // freshness-stamp drift above (which only says the record's premise MIGHT
  // be stale), this actually re-runs the record's own named check against
  // this checkout's base and can positively confirm the premise no longer
  // holds. Never a hard stop — an unattended run stages a close proposal for
  // the Review Console instead (auto-mode-contract.md's staging discipline).
  const premiseCommand = extractPremiseCheck(record.body);
  let premise = null;
  if (premiseCommand) {
    // Security gate (see TRUSTED_AUTHOR_ASSOCIATIONS above): only run the
    // command when GitHub itself attests the issue author is trusted.
    // gh-backed path -> a live REST lookup; --record-json path -> the
    // caller's own optional authorAssociation field, since there is no gh
    // call to make there (deps.ghView/ghAvailable are never consulted on
    // that path either, per the #1459 comment above) — an absent field
    // degrades to untrusted, matching the fail-open-to-skip posture below.
    let association = null;
    if (repoSpec) {
      try {
        association = deps.ghAuthorAssociation(repoSpec.owner, repoSpec.repo, opts.n, repoSpec.host);
      } catch {
        association = null;
      }
    } else if (typeof record.authorAssociation === 'string') {
      association = record.authorAssociation;
    }
    if (association && TRUSTED_AUTHOR_ASSOCIATIONS.has(association)) {
      premise = computePremise(premiseCommand, deps);
    } else {
      deps.stderr(
        `materialize.js: Record #${opts.n} has a Premise-check: line but its author's repo `
        + `association (${association || 'unresolvable'}) is not trusted — skipping the check.\n`,
      );
    }
  }
  if (premise && premise.satisfiedAtBase) {
    deps.stderr(
      `materialize.js: Record #${opts.n}'s premise already satisfied at base: `
      + `\`${premise.command}\` exited ${premise.exit}.\n`,
    );
    if (opts.runDir) {
      try {
        // resolveTarget (both the decision and staged-item variants) requires
        // the run dir to already exist as a directory — this CLI's own
        // work/{n}-spec.md write (below) would create it too, but that write
        // happens later in this function, so ensure it exists now rather
        // than reordering the whole premise-check block after it.
        deps.mkdirp(opts.runDir);
        const mainRoot = deps.mainRoot(deps.cwd());
        const decisionTarget = resolveDecisionTarget({ runDir: opts.runDir, cwd: deps.cwd(), mainRoot });
        if (decisionTarget.ok) {
          const entry = formatEntry({
            status: 'STAGED',
            now: Date.now(),
            step: 'materialize',
            text: `Record #${opts.n}'s Premise-check (\`${premise.command}\`) exited ${premise.exit} at base — staged a proposal to close #${opts.n} as already satisfied instead of planning a build.`,
            reversibility: 'high',
          });
          appendEntry({ runDir: opts.runDir, section: undefined, entry });
        }
        const stageTarget = resolveStageTarget({ runDir: opts.runDir, cwd: deps.cwd(), mainRoot });
        if (stageTarget.ok) {
          const note = `# Staged: close #${opts.n} as already satisfied\n\n`
            + `Premise-check \`${premise.command}\` exited ${premise.exit} at this checkout's base (HEAD) — `
            + `the record's own Current State claim no longer holds. Proposed action: close #${opts.n} `
            + 'without planning or building, citing this check as evidence.\n';
          writeStagedItem({
            runDir: stageTarget.dir, id: `premise-satisfied-${opts.n}`, sourcePath: 'note.md', content: note,
          });
        }
      } catch (err) {
        // Best-effort bookkeeping (per releaseLib/log-decision's own
        // never-block posture) — a failure to log/stage never changes
        // materialize's own success path or output.
        deps.stderr(`materialize.js: could not stage the premise-satisfied proposal (${err && err.message ? err.message : String(err)})\n`);
      }
    }
  }

  // #2590: sibling-PR premise-disproof scan — before planning a fresh
  // investigation, check whether a closed PR already reached the same
  // "premise disproved" conclusion for this record. gh-backed path only
  // (repoSpec is null on --record-json); best-effort, never blocks.
  let siblingPremiseDisproof = null;
  if (repoSpec && typeof deps.ghSearchClosedPRs === 'function') {
    try {
      const prs = JSON.parse(deps.ghSearchClosedPRs(repoSpec.owner, repoSpec.repo, opts.n, repoSpec.host));
      siblingPremiseDisproof = findSiblingPremiseDisproof(prs);
    } catch {
      siblingPremiseDisproof = null;
    }
    if (opts.runDir) {
      try {
        deps.mkdirp(opts.runDir);
        const mainRoot = deps.mainRoot(deps.cwd());
        const decisionTarget = resolveDecisionTarget({ runDir: opts.runDir, cwd: deps.cwd(), mainRoot });
        if (decisionTarget.ok) {
          const outcome = siblingPremiseDisproof
            ? `found closed PR #${siblingPremiseDisproof.number} already stating "${siblingPremiseDisproof.matchedPhrase}"`
            : 'no closed PR found stating the premise was already disproved';
          const entry = formatEntry({
            status: 'SCANNED',
            now: Date.now(),
            step: 'materialize',
            text: `Sibling-PR premise scan for #${opts.n}: searched closed PRs referencing #${opts.n} — ${outcome}.`,
            reversibility: 'n/a',
          });
          appendEntry({ runDir: opts.runDir, section: undefined, entry });
        }
        if (siblingPremiseDisproof) {
          const stageTarget = resolveStageTarget({ runDir: opts.runDir, cwd: deps.cwd(), mainRoot });
          if (stageTarget.ok) {
            const note = `# Staged: closed sibling PR already disproved #${opts.n}'s premise\n\n`
              + `PR #${siblingPremiseDisproof.number} (${siblingPremiseDisproof.url}) was closed without merging, but its body `
              + `already states "${siblingPremiseDisproof.matchedPhrase}" — a prior attempt already reached this record's `
              + `conclusion. Proposed action: review that PR before re-running a fresh full-suite investigation for #${opts.n}.\n`;
            writeStagedItem({
              runDir: stageTarget.dir, id: `sibling-premise-disproof-${opts.n}`, sourcePath: 'note.md', content: note,
            });
          }
        }
      } catch (err) {
        deps.stderr(`materialize.js: could not log/stage the sibling-premise scan (${err && err.message ? err.message : String(err)})\n`);
      }
    }
    if (siblingPremiseDisproof) {
      deps.stderr(
        `materialize.js: Record #${opts.n} — closed PR #${siblingPremiseDisproof.number} already states the premise `
        + `is disproved ("${siblingPremiseDisproof.matchedPhrase}") — review it before re-running the investigation.\n`,
      );
    }
  }

  const facets = parseRecordFacets(record.labels);
  const labelNames = (record.labels || []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean);
  const ceremony = facets.ceremony || opts.ceremony;
  if (!ceremony) {
    deps.stderr(`materialize.js: Record #${opts.n} carries no ceremony:* label — pass --ceremony fast-lane|standard (the caller resolves this via assess-agent-autonomy ceremony-check first).\n`);
    return 2;
  }
  const meta = liftMetadata(record.body);
  const header = composeHeader({
    record: opts.n,
    origin: facets.origin || 'human',
    risk: facets.risk,
    size: facets.size,
    ceremony,
    grants: facets.grants,
    fingerprint: extractFingerprint(record.body),
    blockedBy: parseDependencies(record.body),
    surface: meta.surface,
    designIntent: meta.designIntent,
    uiStack: meta.uiStack,
    designSeed: meta.designSeed,
    parkedAtShaping: labelNames.includes('parked'),
  });
  const fileContent = composeFile({ header, n: opts.n, title: record.title, body: record.body });

  const workDir = opts.multiRecordSlug
    ? path.join(opts.runDir, `spec-${opts.multiRecordSlug}`, 'work')
    : path.join(opts.runDir, 'work');
  const outFile = path.join(workDir, `${opts.n}-spec.md`);
  deps.mkdirp(workDir);
  deps.writeFile(outFile, fileContent);

  deps.stdout(JSON.stringify({
    record: opts.n, file: outFile, ceremonySource: facets.ceremony ? 'label' : 'override', surface: meta.surface || null, uiStack: meta.uiStack || null, drift, premise, siblingPremiseDisproof,
  }, null, 2) + '\n');
  return 0;
}

module.exports = { run, parseArgs, parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
