// bin/lib/hooks/pre-tool-use.js — E1: working-directory discipline (block tier)
// + the worktree-required policy gate (run-independent; see below).
// Denies ONLY on a provable mismatch. Ambiguity -> allow: a false-positive
// freeze in an unattended run is worse than a missed catch (E2 still records).
// "Provable" includes ownership: a deny requires the commit to come from the
// session that recorded the worktree (or identity to be unavailable on either
// side, which preserves the pre-stamp behavior). A commit from a DIFFERENT
// session — e.g. unrelated fix work in the main checkout while a pipeline runs
// elsewhere — is not provably this run's work: allow, warn, log.
//
// Deny signal: every return below — including a deny — sets `exit: 0`. A
// PreToolUse deny is communicated entirely via `hookSpecificOutput.
// permissionDecision: 'deny'` on stdout, not via the process exit code; exit
// 2 is a separate, cruder mechanism (Claude Code reads only stderr for the
// block reason and does not also parse stdout JSON), which would silently
// drop the custom permissionDecisionReason built below. This has been the
// behavior since this file's first commit (362e209). Do not "fix" this by
// setting a non-zero exit on deny — CLAUDE.md and bin/hooks.js's header
// comment both now correctly describe this (exit is always 0; the deny
// signal lives only in the stdout JSON) after correcting an earlier version
// of both that claimed "the only deliberate non-zero outcome is the
// pre-tool-use deny," which never actually matched this module's real
// contract.
'use strict';
const fs = require('fs');
const path = require('path');
const {
  gitTargets, gitTargetsFrom, resolvedGitSegments, fileWriteTargets, mkdirTargets, WRITE_SHAPES, forEachCommandSegment, resolveGitCommand,
} = require('./git-command');
const ctxLib = require('./context');
const policy = require('../policy');
const wtDetect = require('./worktree-detect');
const { resolveIntegrationBranch, preferRemoteTrackingRef } = require('./worktree-reap');
const { runGit, FAILURE } = require('./git-exec');
const { detectIntegrationModel, resolvePolicyConfig } = require('../policy-schema');
const { isPathContained } = require('../shared-primitives');

function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || '${CLAUDE_PLUGIN_ROOT}';
}

// The gate's two path-prefix/path-identity exemptions. `.claude-tweaks/pipelines/`
// holds plugin-owned pipeline bookkeeping — run config, the auto-decision log,
// staged proposals — which is gitignored (except *-tidy-standalone*/
// *-sweep-standalone* audit files, #1493/#1494 — the exemption is
// path-prefix-based either way) and is not
// the project work this gate exists to isolate. `.claude-tweaks/policy.yml` is the second: the one
// file a session legitimately needs to edit from a non-isolated checkout in
// order to CONFIGURE the very gate that would otherwise deny every other
// write there (spec #537) — see isPolicyFile below for how its comparison
// stays symlink-safe.
//
// Why the pipelines exemption is load-bearing TODAY: run directories are
// anchored to the MAIN checkout at creation (`_shared/pipeline-run-dir.md`,
// Anchoring), so a pipeline running inside a worktree writes config.yml /
// decisions.md / events.jsonl / staged/ to a path OUTSIDE its own isolated
// checkout, by design — that anchoring is what stops a worktree ever holding
// the only copy of a run's audit trail, and what makes automatic worktree
// reaping safe. Without this exemption the gate denies every one of those
// writes on every worktree-always project, and the audit trail is lost at the
// source rather than at teardown.
//
// The pipelines exemption's ORIGINAL justification (#138) was different:
// /wrap-up used to copy a run's audit state out of the worktree just before
// removing it, and that copy-out needed to write into the main checkout. That
// step was deleted once anchoring made it unnecessary. The reason changed;
// the exemption did not — do not read the dead justification as evidence this
// can be removed.
const PIPELINE_STATE_DIR = path.join('.claude-tweaks', 'pipelines');
const POLICY_FILE = path.join('.claude-tweaks', 'policy.yml');

// #959: the one documented worktree-local exception (_shared/pipeline-run-dir.md's
// Anchoring section, "work/{n}-spec.md is the exception"). Matches the tail of a
// pipeline-run-relative path (i.e. with the run-id segment already stripped) against
// either the single-record shape (`work[/{n}-spec.md]`) or the multi-record shape
// (`spec-{slug}/work[/{n}-spec.md]`) — the directory form covers a `mkdir -p` target,
// the file form covers the Write/heredoc target. Deliberately narrow: it does NOT match
// any other file inside `work/`, nor anything below `spec-{slug}/` besides `work/`,
// so the carve-out cannot be used to shadow-write arbitrary pipeline state into a
// worktree — only the one tracked, committed-on-branch artifact this section documents.
const WORK_SPEC_TAIL_RE = /^(?:spec-[^/\\]+[/\\])?work(?:[/\\]\d+-spec\.md)?$/;

// #1493/#1494: the second documented worktree-local exception — a
// `*-tidy-standalone*`/`*-sweep-standalone*` run's `decisions.md`, `report.md`,
// and `staged/**` are the exact three shapes `.gitignore`'s block un-ignores
// (top-level pipelines depth only, never spec-*/-nested — see that block's own
// comment) so `tidy/step-7-5-worktree-always.md`'s pr-first mirror-then-commit
// procedure can land the run's audit trail on the worktree's own branch instead
// of only the main-checkout copy. Keyed on the run-dir NAME (new for this
// guard, unlike WORK_SPEC_TAIL_RE which is tail-only) — anchored so a
// `spec-{slug}` nesting or an `archive/` parent can never match, since
// `runDirName` is always the top-level segment (relParts[0]) by construction.
const STANDALONE_AUDIT_RUN_RE = /-(?:tidy|sweep)-standalone/;
const STANDALONE_AUDIT_TAIL_RE = /^(?:decisions\.md|report\.md|staged(?:[/\\].+)?)$/;

// git always reports/accepts forward-slash paths regardless of platform —
// used for GATE_COVERAGE's prose-facing rendering and for comparing against
// `git diff --cached --name-only` output in isPolicyOnlyCommit below.
function toPosix(p) {
  return p.split(path.sep).join('/');
}

// The single machine-readable statement of what the worktree-always gate
// covers. `skills/_shared/policy-schema-coverage.md`'s `worktree-always`
// coverage block is its prose counterpart, and tests/hooks-gate-coverage.test.js
// asserts the two agree — so widening this constant fails a test until that
// block is updated. Every other skill file cites that block rather than
// restating the list.
//
// Why the binding exists: this set was widened twice on 2026-07-20 (push in
// c8f929e1, cp/mv/tee in cab6142b) and no commit swept the prose describing
// it. Four skill files went on documenting the pre-widening gate, two of them
// prescribing procedures that the widened gate denies (#138).
// Each field is read by the code below (or, for bashWriteShapes, re-exported
// from the module that implements it) — never a parallel hand-kept list, which
// is the drift this whole binding exists to prevent.
const GATE_COVERAGE = Object.freeze({
  tools: Object.freeze(['Edit', 'Write', 'NotebookEdit']),
  // #976 (IL-141): widened to include git-command.js's PLUMBING_WRITE_SUBCOMMANDS
  // (mv, rm, update-ref, apply) — see that constant's own header comment for
  // why these four and not a broader set. A git-plumbing write outside the
  // isolated worktree now trips the same E1/worktree-always enforcement a
  // commit/push would, closing the bypass IL-141 documented.
  gitActions: Object.freeze(['commit', 'push', 'mv', 'rm', 'update-ref', 'apply']),
  bashWriteShapes: WRITE_SHAPES,
  // These have their own prose-binding block — skills/_shared/policy-schema-coverage.md's
  // "Teardown gate coverage" section (tests/hooks-gate-coverage.test.js pins
  // the two) — deliberately separate from the worktree-always block above,
  // so widening either gate never requires touching the other's prose.
  teardownTools: Object.freeze(['ExitWorktree']),
  teardownGitCommands: Object.freeze(['worktree remove']),
  // The two exemptions above (paths) plus the allowlisted-commit rule (see
  // POLICY_COMMIT_ALLOWLIST / isPolicyOnlyCommit below). `paths[0]` carries a
  // trailing slash to mark it as a PREFIX; `paths[1]` is an exact-file match.
  // `target` (#1395) is a third kind again: not a fixed path at all, but a
  // per-write git query (isUntrackedOrIgnored) — see that function's own
  // header comment for exactly what it proves before exempting a target, and
  // for why this reads `gitignored` rather than the issue's originally-asked
  // `untracked-or-ignored`: the standalone untracked-but-not-ignored branch
  // was built, then reverted, after it proved unsafe against real tests.
  exemptions: Object.freeze({
    paths: Object.freeze([`${toPosix(PIPELINE_STATE_DIR)}/`, toPosix(POLICY_FILE)]),
    commit: 'policy-only',
    push: 'delete-only',
    target: 'gitignored',
  }),
});

// Fails CLOSED, deliberately: anything this cannot prove sits under the repo's
// own .claude-tweaks/pipelines/ is NOT exempt and falls through to the deny.
// A relative path is unprovable here (the cwd it would resolve against is not
// necessarily the one the write executes in), so it is never exempt — matching
// resolveWriteTarget's own "never fabricate a target you can't prove" posture
// in git-command.js.
function isPipelineBookkeeping(repoRoot, targetPath) {
  if (!repoRoot || typeof targetPath !== 'string' || !targetPath) return false;
  if (!path.isAbsolute(targetPath)) return false;
  return isPathContained(path.resolve(targetPath), path.join(repoRoot, PIPELINE_STATE_DIR));
}

// Resolves a write TARGET the way an already-existing file or symlink chain
// actually behaves: if something exists at this path, follow it all the way
// (fs.realpathSync follows every symlink, including the final component) —
// an Edit/Write through a symlink acts on whatever it ultimately points at.
// If nothing exists there yet (Write creating a brand-new file), there is no
// leaf to follow: resolve only the parent directory and keep the literal
// basename. A path that EXISTS but is an unresolvable (dangling/escaping)
// symlink is never treated as "doesn't exist yet" — that would let a symlink
// swap masquerade as a fresh Write and slip through the parent-only fallback
// meant for genuinely new files. Non-absolute/empty/non-string input is
// unprovable, matching isPipelineBookkeeping's own posture above.
function realTarget(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath || !path.isAbsolute(targetPath)) return null;
  const resolved = path.resolve(targetPath);
  const real = safeReal(resolved);
  if (real) return real;
  let isSymlink = false;
  try { isSymlink = fs.lstatSync(resolved).isSymbolicLink(); } catch { /* nothing at this path at all */ }
  if (isSymlink) return null;
  const parentReal = safeReal(path.dirname(resolved));
  if (!parentReal) return null;
  return path.join(parentReal, path.basename(resolved));
}

// Resolves the CANONICAL reference location for a repo-relative path —
// {repoRoot}/{relPath} — WITHOUT ever following a symlink that might have
// replaced the leaf itself; only the parent directory is realpath'd. This
// asymmetry against realTarget above (which follows everything) is what
// stops an attacker from replacing .claude-tweaks/policy.yml with a symlink
// to somewhere writable: if both sides resolved the leaf, they would
// trivially agree on the forged destination. This side always means
// "whatever is literally at {relPath}", never wherever a swapped-in symlink
// currently points.
function canonicalRepoPath(repoRoot, relPath) {
  if (!repoRoot) return null;
  const joined = path.join(repoRoot, relPath);
  const parentReal = safeReal(path.dirname(joined));
  if (!parentReal) return null;
  return path.join(parentReal, path.basename(joined));
}

// The gate's second exemption (see the header comment above
// PIPELINE_STATE_DIR): Edit/Write/NotebookEdit targeting the repo's own
// .claude-tweaks/policy.yml, compared as fully-resolved real paths — exact
// equality only, never containment — so a symlink ALIAS to policy.yml
// resolves to the same allow and policy.yml itself being SWAPPED for a
// symlink elsewhere resolves to the same deny (see canonicalRepoPath).
function isPolicyFile(repoRoot, targetPath) {
  const real = realTarget(targetPath);
  if (!real) return false;
  const canonical = canonicalRepoPath(repoRoot, POLICY_FILE);
  if (!canonical) return false;
  return real === canonical;
}

// The third path exemption (#1395): an exemptible write target (see
// `exemptible` in checkWorktreeRequired below — file-tool targets AND Bash
// write-shape targets both qualify, unlike isPolicyFile's fileTool-only
// scope) whose fully-resolved path is git-ignored in its OWN repo. Real-world
// motivation: a gitignored runtime `.env` a docker compose in the main
// checkout reads is not the project work this gate isolates, even though
// writing it looks identical, mechanically, to a genuine wrong-checkout code
// write. `cp realfile.js .env` still resolves correctly here because the
// caller passes only the write's TARGET path — `.env` — never the source; a
// tracked source file is never exempted by association with an untracked
// destination.
//
// git check-ignore -q's exit codes (verified empirically, since this file's
// header comment on the gotcha warns not to assume): 0 = ignored, a
// definitive positive. 1 with NO stderr = a normal negative ("not ignored" —
// not a git failure). Anything else — a non-zero exit that DID produce
// stderr, e.g. exit 128 "fatal: ... is outside repository" or "Invalid
// path" — is a real git failure, indeterminate about the answer this
// function needs: fails closed, matching isPipelineBookkeeping's own posture
// just above.
//
// DELIBERATELY NOT IMPLEMENTED: a standalone "untracked, but NOT git-ignored"
// branch via `git ls-files --error-unmatch`, despite the issue's (#1395)
// literal ask for one. Built and empirically tested during triage, then
// reverted after it broke three existing, deliberately-designed security
// tests (`tests/hooks-policy-exemption.test.js`'s "Edit to CLAUDE.md stays
// denied", "policy.yml SWAPPED for a symlink escaping elsewhere resolves to
// denied", and "a Bash WRITE SHAPE (tee/cp) targeting policy.yml stays
// denied") — proving the hazard is real, not hypothetical. The root cause:
// git has NO signal that distinguishes "a legitimate untracked deploy/scratch
// artifact" from "real, valuable project content that simply has not been
// `git add`ed yet" — both read back identically from `ls-files
// --error-unmatch` (a non-zero exit, no matching index entry), regardless of
// whether the path exists on disk. Trusting "untracked" alone as a signal
// would blanket-exempt (a) every not-yet-`git add`ed file created during
// ordinary iterative development — the single most common real-world state
// of new project work, not an edge case — and (b) any write whose LITERAL
// target path happens to coincide with an untracked enforcement-relevant
// file, including `.claude-tweaks/policy.yml` itself before its first commit
// (undermining both isPolicyFile's fileTool-only Bash-write-shape gating,
// spec #537 Non-Goals, and its symlink-swap identity defense, since neither
// check-ignore nor ls-files follow symlinks — they answer for the literal
// pathname, not the swapped-in target). No git-observable heuristic (parent
// directory has no tracked siblings, no history for the path, etc.) closes
// this gap without inventing arbitrary, unlisted logic. This finding is
// recorded on #1395 and in this build's PR description rather than silently
// narrowing the implementation without a trace — the issue's own
// conservatism directive ("fail closed on any ambiguity, never widen the
// exemption beyond exactly what the acceptance criteria specify") takes
// precedence over the literal "untracked-file allow" acceptance criterion
// where the two conflict.
//
// Absolute-path-only, like isPipelineBookkeeping and realTarget: a relative
// path is unprovable (the cwd it would resolve against is not necessarily
// the one the write executes in), so it is never exempt.
function isUntrackedOrIgnored(repoRoot, targetPath) {
  if (!repoRoot || typeof targetPath !== 'string' || !targetPath) return false;
  if (!path.isAbsolute(targetPath)) return false;
  const resolved = path.resolve(targetPath);

  const ignoreCheck = runGit(['check-ignore', '-q', resolved], repoRoot);
  if (ignoreCheck.failure === null) return true; // ignored
  // Not a clean "not ignored" negative -> indeterminate/fatal -> not exempt.
  if (ignoreCheck.failure !== FAILURE.GIT_ERROR || ignoreCheck.stderr) return false;
  return false; // not ignored -> not exempt (see the header comment above)
}

// The commit exemption's allowlist grammar (spec #537 Deliverables): admits
// EXACTLY `git commit` plus one-or-more -m/--message args and an optional
// --no-verify, in any order, nothing else — no other flag, no pathspec, no
// shell operator, no env-var prefix, no path to git. Default-deny by
// construction: there is no disqualifying-flag list to maintain, because
// anything not spelled out here simply fails to match.
const CQ_SINGLE = "'[^']*'";
const CQ_DOUBLE = '"[^"$`\\\\]*"'; // no $, backtick, or backslash inside
const CQ_BARE = '[A-Za-z0-9._:/#-]+';
const CQ_ARG = `(?:${CQ_SINGLE}|${CQ_DOUBLE}|${CQ_BARE})`;
const CQ_MSG = `(?:-m\\s*${CQ_ARG}|--message(?:=|\\s+)${CQ_ARG})`;
const CQ_TOKEN = `(?:${CQ_MSG}|--no-verify)`;
const POLICY_COMMIT_ALLOWLIST = Object.freeze(new RegExp(
  `^\\s*git\\s+commit(?:\\s+${CQ_TOKEN})*\\s+${CQ_MSG}(?:\\s+${CQ_TOKEN})*\\s*$`,
));

// Allowlist-match first (pure regex, no spawn); only a match pays for a git
// query, and only that query's result decides the exemption — a staged set
// of exactly one entry, .claude-tweaks/policy.yml, whose status is an Add,
// Modify, or Delete. `--name-status` rather than `--name-only`, deliberately:
// `--name-only` collapses a rename to its single destination line, so
// `git mv <tracked-file> .claude-tweaks/policy.yml` (ungated — neither a
// commit/push nor a WRITE_SHAPE) on a repo where policy.yml is not yet in
// HEAD reads as "exactly policy.yml staged" and smuggles arbitrary tracked
// content into the enforcement file (review finding). A rename renders as
// `R<score>\told\tnew` under --name-status and is rejected on its status
// letter; likewise Copy (C) and type-change (T). Wrapped so any exception
// from the git spawn can never propagate out of this hook (this file's
// header: never throw) — it falls through to "not exempt" instead.
const POLICY_COMMIT_STATUSES = new Set(['A', 'M', 'D']);
function isPolicyOnlyCommit(command, cwd) {
  if (typeof command !== 'string' || !POLICY_COMMIT_ALLOWLIST.test(command)) return false;
  try {
    const { stdout, failure } = runGit(['diff', '--cached', '--name-status'], cwd);
    if (failure !== null || typeof stdout !== 'string') return false;
    const rows = stdout.split('\n').filter(Boolean);
    if (rows.length !== 1) return false;
    const cols = rows[0].split('\t');
    // Exactly two columns — status + one path. A rename/copy row carries three.
    if (cols.length !== 2) return false;
    const [status, file] = cols;
    return POLICY_COMMIT_STATUSES.has(status) && file === toPosix(POLICY_FILE);
  } catch {
    return false;
  }
}

// The delete-only push exemption's allowlist grammar (spec #658, Deliverable
// 1's decision: EXEMPT): admits EXACTLY `git push <remote> --delete <branch>`
// or `git push <remote> :<branch>` — one remote, one branch, nothing else —
// no other flag, no shell operator (&&, ;, |, $(), backticks), no env-var
// prefix, no path to git other than the bare word. Mirrors
// POLICY_COMMIT_ALLOWLIST's whole-command, default-deny-by-construction
// discipline directly: a compound command or an extra flag/positional simply
// fails to match, the same way a compound commit does above. Unlike the
// commit exemption, this needs no extra git query — a branch-delete push's
// ref target is fully determined by the command text alone (a commit's
// staged content is not), so the regex match is the whole check.
const DELETE_ONLY_PUSH_ALLOWLIST = Object.freeze(new RegExp(
  `^\\s*git\\s+push\\s+${CQ_ARG}\\s+(?:--delete\\s+${CQ_ARG}|:${CQ_BARE})\\s*$`,
));

function isDeleteOnlyPush(command) {
  return typeof command === 'string' && DELETE_ONLY_PUSH_ALLOWLIST.test(command);
}

// Kept returning `string | null` — E1's own callers below compare toplevels for
// a PROVABLE mismatch and already resolve any falsy value to allow, so the
// indeterminate/negative distinction that repoInfo now draws would change no
// decision here. (The worktree gate is the caller that needed it.)
function toplevel(dir) {
  return runGit(['rev-parse', '--show-toplevel'], dir).stdout;
}

function safeReal(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

// Shared shape for every PreToolUse deny below (checkTeardownGate,
// checkWorktreeRequired, runInner's E1) — same hookEventName/
// permissionDecision wrapper each time, differing only in the reason text.
// exit stays 0 on a deny; see this file's header comment for why.
function denyResult(reason) {
  return {
    exit: 0,
    json: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    },
  };
}

// The write target named by a file-mutation tool (GATE_COVERAGE.tools), or
// null when the tool is not one of them or carries no string path. Only the
// input FIELD name varies per tool, so every gate below that inspects a file
// target resolves it through here rather than restating the NotebookEdit
// special case three times. Returns the string verbatim — including `''`,
// which each caller already treats as "no usable target" on its own.
function fileToolTargetPath(toolName, toolInput) {
  if (!GATE_COVERAGE.tools.includes(toolName)) return null;
  const field = toolName === 'NotebookEdit' ? 'notebook_path' : 'file_path';
  const target = toolInput && toolInput[field];
  return typeof target === 'string' ? target : null;
}

// Resolves the worktree path(s) a teardown call targets, or [] when none can
// be determined confidently — teardownTargets never fabricates a target;
// checkTeardownGate below treats an empty result as allow.
//
// ExitWorktree: Task 0 (spec #373) captured the real PreToolUse payload and
// cross-checked it against ToolSearch's own loaded schema for the tool —
// `tool_input` is exactly `{action, discard_changes}`, structurally with NO
// path field at all (not just absent from the one sampled call). A
// design sketch for this gate carried an explicit-path branch as a
// hedge against that being unmeasured; per the pinned findings it is
// dead code for the real payload, so it is dropped here rather than kept
// unreachable. The only usable signal is the hook's own `cwd`, which Task 0
// also confirmed fires INSIDE the worktree being exited — PreToolUse runs
// before the tool's effect takes place, so this is always the worktree in
// teardown, never a post-exit directory. Resolved to its containing toplevel.
// Gated on `action === 'remove'` only — `action: 'keep'` (or anything else)
// is non-destructive (the worktree stays on disk; only cwd is restored), so
// it must never even become a candidate target, let alone get denied with a
// deny reason that would be factually false for it (whole-branch review
// CRITICAL 2, spec #373).
//
// Bash: ONLY the narrow `git worktree remove [--force|-f|--] <path>` shape,
// parsed per shell segment via git-command.js's own forEachCommandSegment —
// which also tracks `cd` across segments, so `cd <dir> && git worktree
// remove <relative>` resolves against the post-cd cwd instead of being
// missed entirely (whole-branch review IMPORTANT 4). This deliberately does
// not extend the compound-command surface #174 tracks. Any other flags,
// multiple positionals, or parse doubt skip that segment; never fabricate a
// target — ambiguity resolves to allow.
// Each entry carries `source` ('exitworktree' | 'bash') alongside the
// resolved `path` — checkTeardownGate's own-cwd guard (#693) below applies
// ONLY to the 'bash' source: ExitWorktree always resolves to ctx.cwd's own
// toplevel (see the block comment above this function) and IS the sanctioned
// own-cwd removal path, so the same "target is my own cwd" shape must never
// deny it the way it denies a raw `git worktree remove`.
function teardownTargets(ctx) {
  const toolName = ctx.input && ctx.input.tool_name;
  const toolInput = ctx.input && ctx.input.tool_input;
  if (GATE_COVERAGE.teardownTools.includes(toolName)) {
    if (!toolInput || toolInput.action !== 'remove') return [];
    const top = toplevel(ctx.cwd || process.cwd());
    return top ? [{ path: top, source: 'exitworktree' }] : [];
  }
  if (toolName !== 'Bash' || !toolInput || typeof toolInput.command !== 'string') return [];
  const out = [];
  forEachCommandSegment(toolInput.command, ctx.cwd || process.cwd(), (toks, effCwd) => {
    // Shares gitTargets' own findGitLead -> skipGlobalFlags preamble via
    // resolveGitCommand: findGitLead walks past a leading NAME=value
    // assignment and/or the env builtin (with env's own flags, including
    // -C/--chdir) to find the real git/.../git lead token — a bare
    // `toks[0] !== 'git'` check misses every wrapped form (#1308) — and
    // skipGlobalFlags then walks past any global flag ahead of the
    // subcommand (-C, -c, --exec-path, --namespace, --git-dir, --work-tree,
    // or an unrecognized `-...` flag), which used to defeat this parser
    // entirely when it only checked for a literal `-C`, silently allowing
    // `git -c foo=bar worktree remove <path>` past the gate.
    const resolved = resolveGitCommand(toks, effCwd);
    if (!resolved) return; // not git, or unprovable, or cwd unknown with no provable -C
    const { index: i, dir } = resolved;
    // Derived from GATE_COVERAGE.teardownGitCommands rather than a hardcoded
    // comparison, so the constant stays load-bearing (see tools/gitActions
    // above) instead of a parallel hand-kept list nothing reads (#hooks-gate-coverage).
    if (typeof toks[i] !== 'string' || typeof toks[i + 1] !== 'string') return;
    const sub = `${toks[i]} ${toks[i + 1]}`;
    if (!GATE_COVERAGE.teardownGitCommands.includes(sub)) return;
    // `--`, like `--force`/`-f`, is a flag/terminator, never the path itself.
    const rest = toks.slice(i + 2).filter((t) => t !== '--force' && t !== '-f' && t !== '--');
    if (rest.length !== 1 || rest[0].startsWith('-')) return; // unconfident -> allow
    out.push({ path: path.resolve(dir, rest[0]), source: 'bash' });
  });
  return out;
}

// The teardown gate itself: denies (or, for a provably foreign-owned run,
// warns) an ExitWorktree/`git worktree remove` call that targets a worktree
// still assigned to a non-terminal pipeline run. Mirrors E1's own
// deny/foreign-session/allow shape below, at the teardown boundary instead of
// the commit boundary.
//
// `teardownWarnings` (out-parameter, mirrors `indeterminateTargets` on
// checkWorktreeRequired below): a foreign-owned hit is collected here and the
// loop CONTINUES rather than returning — an early return on the warn path
// used to short-circuit runInner entirely, so a compound `git worktree
// remove <foreign-wt> && git commit -m x` skipped the worktree-always check
// on the trailing commit (whole-branch review IMPORTANT 3). Only a genuine
// deny still returns early — a deny is the one outcome where evaluating
// anything further is pointless (the call is blocked).
function checkTeardownGate(ctx, teardownWarnings = []) {
  const targets = teardownTargets(ctx);
  if (!targets.length) return {};
  // A run whose recorded `worktree` IS the main checkout (a bad record, or a
  // current-branch-strategy run) must never deny an ExitWorktree/`worktree
  // remove` call issued AT the main checkout — there is no worktree to
  // orphan there, and the deny message's "remove the worktree" framing would
  // be nonsensical (whole-branch review MINOR 6). Computed only when there is
  // at least one target, since it costs an fs walk on every hook call
  // otherwise.
  const mainRoot = safeReal(wtDetect.mainCheckoutRoot(ctx.cwd || process.cwd()));
  // Own-cwd guard (#693): resolved once per call, reused across targets.
  const cwdReal = safeReal(ctx.cwd || process.cwd());
  for (const { path: target, source } of targets) {
    if (mainRoot && safeReal(target) === mainRoot) continue;

    // A raw Bash `git worktree remove` (never ExitWorktree — see teardownTargets'
    // header comment) whose target IS the session's own cwd, or a directory
    // containing it, deletes the shell's live working directory out from
    // under itself: the incident #693 documents. This fires independent of
    // any pipeline-run assignment below — a `close-run` already having run
    // (which lifts the assignment-based deny further down, see AC2 in
    // tests/teardown-gate.test.js) does nothing to stop the shell's own cwd
    // being pulled out from under it, which is exactly the gap that let the
    // incident's raw remove through. Ambiguity (unresolvable target or cwd)
    // still resolves to allow, matching this file's own posture throughout.
    if (source === 'bash') {
      const targetReal = safeReal(target);
      if (targetReal && cwdReal && isPathContained(cwdReal, targetReal, { orEqual: true })) {
        return denyResult(
          `claude-tweaks teardown gate: this \`git worktree remove\` targets ${target}, which is the ` +
          `current session's own working directory (or an ancestor of it). Removing it deletes the ` +
          `shell's live cwd and leaves the session with no git context. Use \`ExitWorktree\` instead — ` +
          `it is the only sanctioned way to remove the worktree a session is standing in ` +
          `(skills/wrap-up/cleanup-procedures.md Section C's Teardown ordering invariant).`,
        );
      }
    }

    let exists = false;
    try { fs.statSync(target); exists = true; } catch { /* gone */ }
    // Recorded-or-target path already gone from disk -> allow (fail-open).
    // Target and recorded assignment are the same path once matched, so
    // statting the target side covers both.
    if (!exists) continue;
    const hit = ctxLib.findRunByWorktreePath(ctx.cwd, target);
    if (!hit || !hit.state) continue;
    const status = hit.state.status;
    if (status !== 'active' && status !== 'interrupted') continue;
    const caller = ctx.input && typeof ctx.input.session_id === 'string' && ctx.input.session_id ? ctx.input.session_id : null;
    // #1099: classify the TARGET run (hit.state) against this caller via the
    // composite session+worktree-binding predicate instead of raw session-id
    // equality — a sibling of this same session, bound to a DIFFERENT live
    // worktree than hit.state records, must take the foreign branch (warn +
    // allow) rather than the same-session deny. 'mine' and 'indeterminate'
    // both preserve today's fall-through-to-deny behavior.
    const ownershipVerdict = ctxLib.classifyOwnership({ sessionId: caller, cwd: ctx.cwd || process.cwd() }, hit.state);
    if (ownershipVerdict === 'foreign') {
      // Provably foreign-owned: allow + warn, event to the TARGET run's dir
      // (the wd-foreign-session precedent — enforcement-target, not
      // ownedRun). Collected, not returned — see the function header.
      // #1431 audit: `hit.runDir` is neither ctx.runDir's session-agnostic
      // newest-non-terminal GUESS nor ctx.ownedRun — it's the specific run
      // findRunByWorktreePath just proved is bound to `target`, an
      // unambiguous match, not an attribution guess. Not the #1431 hazard
      // (a guessed run absorbing a foreign event); left as-is.
      ctxLib.appendEvent(hit.runDir, 'wd-foreign-teardown', { path: target });
      teardownWarnings.push(
        `claude-tweaks: worktree ${target} is assigned to run ${path.basename(hit.runDir)}, recorded by a different session — ` +
        `allowing this teardown, but if that pipeline is still live its state will be orphaned. ` +
        `Prefer closing the run first: node "${pluginRoot()}/bin/hooks.js" close-run --run "${hit.runDir}"`,
      );
      continue;
    }
    // Same session ('mine'), or identity/binding unprovable ('indeterminate') -> deny.
    // #2351: logged to THIS session's own run dir (never hit.runDir — that's
    // the unrelated TARGET run being torn down, bound to a different
    // worktree entirely; the friction being recorded belongs to the session
    // hitting this gate, not the run it's trying to tear down). A plain
    // `ownedRun.dir` is NOT trusted here when it carries `attribution:
    // 'fallback'` — resolveRun's newest-non-terminal guess, with no run dir
    // of this session's own to resolve, would otherwise frequently guess
    // exactly `hit.runDir` itself (the only run dir under this main
    // checkout at the moment a teardown gets denied is often the very one
    // being torn down), silently reproducing the same misattribution this
    // fix exists to close. Prefer a genuine ad-hoc stamp in that case; fall
    // back to the guess only if minting one fails outright (best-effort —
    // never lose the event entirely over this).
    const ownedRun = ctx.ownedRun || {};
    const trustedOwnedDir = (ownedRun.dir && ownedRun.attribution !== 'fallback') ? ownedRun.dir : null;
    // stampAdHocRunDirForDenial's own early-return guard short-circuits on
    // ANY truthy ctx.ownedRun.dir, fallback-attributed or not — pass it a
    // ctx with ownedRun stripped whenever the real one isn't trusted, so it
    // actually proceeds to mint instead of handing back the same guess.
    const stamped = trustedOwnedDir ? null : ctxLib.stampAdHocRunDirForDenial({ ...ctx, ownedRun: {} });
    const denialRunDir = trustedOwnedDir || stamped || ownedRun.dir;
    // A freshly minted stamp is this session's own, genuine ownership — never
    // 'fallback' (that would mislabel a real mint as an unreliable guess);
    // otherwise carry through whatever ownedRun.attribution already was.
    const denialAttribution = stamped ? undefined : ownedRun.attribution;
    ctxLib.appendEvent(denialRunDir, 'wd-deny', { path: target, assignedRun: path.basename(hit.runDir) }, denialAttribution);
    return denyResult(
      `claude-tweaks teardown gate: worktree ${target} is still assigned to non-terminal pipeline run ` +
      `${hit.runDir}. Tearing it down now skips the documented cleanup sequence (skills/wrap-up/cleanup-procedures.md ` +
      `Section C) and destroys the run's gitignored state. Finish via /claude-tweaks:wrap-up, or close the bookkeeping first: ` +
      `node "${pluginRoot()}/bin/hooks.js" close-run --run "${hit.runDir}", then retry.`,
    );
  }
  return {};
}

// Pipeline-shadow guard (#692): refuses to CREATE `.claude-tweaks/pipelines/`
// state inside a linked worktree at all — see _shared/pipeline-run-dir.md's
// Anchoring section, and `node bin/hooks.js resolve-run-dir`, the command that
// section now points callers at instead of composing $RUN_ROOT inline. Unlike
// checkWorktreeRequired below, this guard is UNCONDITIONAL: it does not check
// `worktree-always` policy, because run-dir anchoring is a plugin-architecture
// invariant every project gets, not something a project opts into.
//
// Flags only a NEW creation — the run-dir-level path (the first path segment
// under `.claude-tweaks/pipelines/`) does not already exist on disk. A
// pre-anchoring run directory already sitting in a worktree is left alone
// (tolerated transitionally by wrap-up/cleanup-procedures.md Section C step
// 3.5's copy-out guard, sunset 2026-11-07): that guard only ever READS from
// the worktree and WRITES to the main checkout, so it never trips this guard
// itself, and further writes into an already-existing worktree-trapped run
// dir (e.g. a still-running pre-anchoring pipeline appending events.jsonl)
// must not be newly denied by a guard shipped after that pipeline started.
//
// #959: also lets the one documented worktree-local exception through even
// when the run-id directory does NOT yet exist there — `work/{n}-spec.md`
// (or its multi-record `spec-{slug}/work/{n}-spec.md` form) is meant to be
// created and committed on the feature branch as the run's FIRST commit
// (materialize.md's "When this runs"), so requiring the run-dir to
// pre-exist made the sanctioned exception unreachable by any tool-mediated
// write. See WORK_SPEC_TAIL_RE above for exactly what this does and does
// not cover.
function shadowPipelineRunDir(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath || !path.isAbsolute(targetPath)) return null;
  const resolved = path.resolve(targetPath);
  const { repoRoot, isLinkedWorktree, indeterminate } = wtDetect.repoInfo(resolved);
  if (indeterminate || !repoRoot || !isLinkedWorktree) return null;
  const pipelinesDir = path.join(repoRoot, PIPELINE_STATE_DIR);
  // realTarget follows an existing symlink chain the same way the policy.yml
  // exemption does; falls back to the literal resolved path when nothing
  // exists yet (a brand-new mkdir target has no leaf, sometimes not even a
  // parent, to realpath).
  const real = realTarget(resolved) || resolved;
  const relFromPipelines = path.relative(pipelinesDir, real);
  if (!relFromPipelines || relFromPipelines.startsWith('..') || path.isAbsolute(relFromPipelines)) return null;
  const relParts = relFromPipelines.split(path.sep);
  const runDirName = relParts[0];
  const tail = relParts.slice(1).join(path.sep);
  if (WORK_SPEC_TAIL_RE.test(tail)) return null;
  if (STANDALONE_AUDIT_RUN_RE.test(runDirName) && STANDALONE_AUDIT_TAIL_RE.test(tail)) return null;
  const runDirCandidate = path.join(pipelinesDir, runDirName);
  let exists = false;
  try { exists = fs.statSync(runDirCandidate).isDirectory(); } catch { /* not there yet — a genuinely new shadow */ }
  if (exists) return null;
  return { worktreeRoot: repoRoot, runDirCandidate };
}

function checkPipelineShadowGuard(ctx) {
  const toolName = ctx.input && ctx.input.tool_name;
  const toolInput = ctx.input && ctx.input.tool_input;
  const candidates = [];
  if (GATE_COVERAGE.tools.includes(toolName)) {
    const target = fileToolTargetPath(toolName, toolInput);
    if (target !== null) candidates.push(target);
  } else if (toolName === 'Bash' && toolInput && typeof toolInput.command === 'string') {
    const command = toolInput.command;
    for (const t of fileWriteTargets(command, ctx.cwd)) candidates.push(t.file);
    for (const t of mkdirTargets(command, ctx.cwd)) candidates.push(t.file);
  }
  for (const candidate of candidates) {
    const shadow = shadowPipelineRunDir(candidate);
    if (!shadow) continue;
    return denyResult(
      `claude-tweaks: refusing to create ${shadow.runDirCandidate} — a NEW pipeline run directory inside a ` +
      `linked worktree (${shadow.worktreeRoot}). Run directories are anchored to the main checkout ` +
      `(_shared/pipeline-run-dir.md's Anchoring section); creating one here would be a worktree-local shadow that ` +
      `a later \`git worktree remove\` can silently destroy ([IL-127]). Resolve the correct path instead: ` +
      `node "${pluginRoot()}/bin/hooks.js" resolve-run-dir --create (see pipeline-run-dir.md for the full flag set).`,
    );
  }
  return {};
}

// git-stash worktree-hazard warn gate (#1967, widened #2065): the stash
// stack is repository-wide, shared by every linked worktree of the same main
// checkout — `git stash` and every explicit stack-mutating spelling of it
// (`stash push`, `stash push -u`/`-m ...`, the flag-first bare forms
// `stash -u`/`stash -m ...`, and the deprecated-but-live `stash save`) run
// from inside a linked worktree can push onto, or pop, an entry a SIBLING
// worktree's session created and still expects to find. The #1864 review
// call proved this by popping a sibling worktree's WIP stash while comparing
// test discrimination against a baseline; #2065 closed the gap where only
// the bare/`pop` spellings were covered — the exact hazard, reachable
// through the equally common explicit `stash push`/`-u`/`-m` forms. This is
// a WARN, never a deny: unlike E1/worktree-required, there is no provable
// "whose stash entry is this" signal to gate on — only a heads-up pointing
// at a non-mutating alternative. `list`/`show`/`apply`/`drop`/`clear`/
// `branch` stay silent — mirroring git-command.js's own
// PLUMBING_WRITE_SUBCOMMANDS comment on why `stash` was deliberately
// excluded from its one-level subcommand check: a second token has to be
// resolved to tell the mutating shape from a read-only one; `next.startsWith('-')`
// also lets a harmless `git stash --help` warn (narrowing it would mean
// enumerating stash's flag set — left as-is, an extra warning, never a
// miss). Needs no pipeline run state — this fires regardless of whether a
// run is active, same as the worktree-required gate below. Consumes the
// segments run() already resolved once via resolvedGitSegments — no
// forEachCommandSegment/resolveGitCommand call of its own (#2065's second
// half: the second full traversal this file used to pay on every Bash call).
function checkGitStashWarn(segments, warnings) {
  // Caller only ever passes a real array here when ctx.input.tool_name is
  // already 'Bash' (runInner's own `segments` derivation) — re-checked
  // defensively rather than trusted, since a future caller could pass this
  // through from a different tool_name branch.
  if (!Array.isArray(segments)) return;
  for (const { tokens: t, index, dir } of segments) {
    if (t[index] !== 'stash') continue;
    const next = t[index + 1];
    const mutatesStack = next === undefined || next === 'pop' || next === 'push'
      || next === 'save' || (typeof next === 'string' && next.startsWith('-'));
    if (!mutatesStack) continue;
    if (!dir) continue;
    const { isLinkedWorktree, indeterminate } = wtDetect.repoInfo(dir);
    if (indeterminate || !isLinkedWorktree) continue;
    warnings.push(
      'claude-tweaks: git stash is repository-wide, shared by every linked worktree of this '
      + "checkout — running it here can push onto or pop a SIBLING worktree's stash entry. "
      + 'Compare against a baseline without mutating the tree instead: `git show <rev>:<path>`, '
      + 'or set your own work aside with a temporary WIP commit (`git commit -m wip`, then apply '
      + 'it elsewhere by SHA — `git show <sha>` / `git cherry-pick <sha>`) rather than stash.',
    );
  }
}

// worktree-required policy gate: unlike E1 below, this needs no pipeline run
// state at all — it fires on the first Edit/Write/NotebookEdit/commit of a
// session, before any skill has ever run, whenever the target repo has opted
// into `worktree-always: true` in its .claude-tweaks/policy.yml.
//
// `precomputedGitTargets` (Bash calls only) lets run() share the one
// gitTargets() parse of the command with its own later E1 loop instead of
// re-running git-command.js's quote-aware segment/token walk a second time
// over the same string.
// `indeterminateTargets` (optional, caller-supplied array) collects paths whose
// repo status could not be determined — see the branch below. An out-parameter
// rather than an extra return field so this function's return shape stays
// exactly `{}` | `{exit, json}`, leaving runInner's `if (gate.json) return gate`
// dispatch untouched.
function checkWorktreeRequired(ctx, precomputedGitTargets, indeterminateTargets = []) {
  const toolName = ctx.input && ctx.input.tool_name;
  const toolInput = ctx.input && ctx.input.tool_input;
  // Each entry is { path, exemptible, fileTool, action }. `exemptible` marks a
  // target that names a FILE being written, which is the only kind the
  // .claude-tweaks/pipelines/ exemption may apply to. A git commit/push target
  // is the command's working DIRECTORY, not a file — exempting those by prefix
  // would allow any commit merely ISSUED from inside .claude-tweaks/pipelines/,
  // which is precisely the isolation this gate enforces. `fileTool` is
  // narrower still: set ONLY for an Edit/Write/NotebookEdit target, never for a
  // Bash write shape (tee/cp/sed -i/…) — the .claude-tweaks/policy.yml
  // exemption is scoped to the three file tools by spec #537's Non-Goals (a
  // shell rewrite of an enforcement-relevant file stays gated), so it keys on
  // this flag, not on `exemptible`. `action` ('commit'/'push', only set for git
  // targets) is what lets the commit exemption below apply ONLY to a commit
  // target, never a push one. All three distinctions have to be carried from
  // where each target is resolved; none can be recovered later.
  let targetPaths = [];
  // The raw Bash command string, hoisted out of the branch below so the
  // per-target loop can reach it for the commit exemption's allowlist check
  // (isPolicyOnlyCommit needs the whole command, not just a resolved target).
  let bashCommand = null;

  // GATE_COVERAGE.tools decides WHETHER a tool is gated; only the input field
  // name varies per tool. Keep that list in sync with the Edit/Write/
  // NotebookEdit matchers in hooks/hooks.json — a new file-mutation tool must
  // be added to both or it silently bypasses this gate.
  if (GATE_COVERAGE.tools.includes(toolName)) {
    const target = fileToolTargetPath(toolName, toolInput);
    if (target !== null) targetPaths = [{ path: target, exemptible: true, fileTool: true }];
  } else if (toolName === 'Bash') {
    const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : null;
    if (command) {
      bashCommand = command;
      // Both commit AND push are covered by this policy (see the deny
      // message below and CLAUDE.md's Hooks section) — gitTargets already
      // detects both actions, so don't narrow to 'commit' only, or a bare
      // `git push` from a non-isolated checkout silently bypasses the gate.
      // Check EVERY target the command contains, not just the first — a
      // single compound Bash call can chain multiple independent
      // git/write targets (e.g. `git -C $A commit ... && git -C $B commit
      // ...`, or a git commit alongside a separate cp/mv/tee write), and
      // each one is checked on its own below: a violation later in the
      // chain must not be masked by an earlier, compliant target.
      const targets = precomputedGitTargets || gitTargets(command, ctx.cwd);
      const gitTargetPaths = targets
        .filter((t) => GATE_COVERAGE.gitActions.includes(t.action))
        .map((t) => ({ path: t.dir, exemptible: false, action: t.action }));
      // Non-git direct file writes (tee, cp, mv) — best-effort,
      // not exhaustive (see fileWriteTargets' own header comment).
      const writeTargetPaths = fileWriteTargets(command, ctx.cwd).map((t) => ({ path: t.file, exemptible: true }));
      targetPaths = [...gitTargetPaths, ...writeTargetPaths];
    }
  }
  if (!targetPaths.length) return {};

  for (const { path: targetPath, exemptible, fileTool, action } of targetPaths) {
    // Cheap fs-only pre-check: if no policy.yml exists anywhere in the
    // ancestor chain, there is definitely nothing to enforce for THIS
    // target — skip forking git entirely for the overwhelming majority of
    // projects that never opt into this policy. This is a fast-reject
    // filter ONLY: once it finds a policy file somewhere, the actual
    // enforcement check below still re-scopes to the target's own git repo
    // root, since a policy file belonging to an unrelated ANCESTOR
    // directory outside this repo's boundary must not leak into a nested
    // repo (e.g. a submodule) that never opted in itself.
    if (!wtDetect.findPolicyFile(targetPath)) continue;

    const { repoRoot, isLinkedWorktree, indeterminate } = wtDetect.repoInfo(targetPath);
    // TWO different conditions reach a null repoRoot, and they are not the same
    // fact (#134):
    //   indeterminate: false -> git ran and said "not a git repository". A real
    //     answer, and nothing to enforce: allow, silently, as before.
    //   indeterminate: true  -> git never answered (timed out under load, the
    //     fork was refused, git is missing, or realpath on its answer failed).
    //     We do not know whether this path is a repo, let alone whether it opted
    //     into the policy.
    // We still ALLOW the indeterminate case: CLAUDE.md's hooks contract is
    // "never break a session" and "ambiguity resolves to allow", and denying on
    // a transient load spike would freeze unattended runs. What changes is that
    // it is no longer SILENT — before, a load spike and a non-repo produced
    // byte-identical behavior, so an enforcement gap left no trace anywhere.
    if (indeterminate) {
      indeterminateTargets.push(targetPath);
      continue;
    }
    if (!repoRoot) continue; // git answered: not a git repo at all -> allow
    if (!policy.isWorktreeAlwaysOn(repoRoot)) continue;
    if (isLinkedWorktree) continue;
    // Placed here, immediately before the deny, so no earlier `continue` can
    // claim a path this was meant to exempt — the ordering defect [IL-83]
    // records. Only file-write targets are eligible; see `exemptible` above.
    if (exemptible && isPipelineBookkeeping(repoRoot, targetPath)) continue;
    // The second path exemption (#537): an Edit/Write/NotebookEdit write whose
    // fully-resolved real path IS the repo's own .claude-tweaks/policy.yml —
    // see isPolicyFile. Keyed on `fileTool`, NOT `exemptible`: a Bash write
    // shape (tee/cp/sed -i/…) targeting policy.yml is exemptible for the
    // pipelines/ prefix rule above but must stay gated here (spec #537
    // Non-Goals; review finding — a shell rewrite of the enforcement file).
    if (fileTool && isPolicyFile(repoRoot, targetPath)) continue;
    // The third path exemption (#1395): see isUntrackedOrIgnored's own header
    // comment for what it proves (and for why it checks ONLY git-ignored
    // status, not untracked status standalone). Keyed on `exemptible`, NOT
    // `fileTool` — unlike isPolicyFile just above, this must cover a Bash
    // write shape (cp/mv/tee/sed -i/…) targeting a gitignored path too, not
    // only Edit/Write/NotebookEdit. Leaves its own allow breadcrumb (distinct
    // from the deny breadcrumb below) so an operator can audit which writes
    // this exemption let through — the issue's explicit auditability ask,
    // since the two pre-existing path exemptions leave no breadcrumb at all.
    if (exemptible && isUntrackedOrIgnored(repoRoot, targetPath)) {
      const ownedRun = ctx.ownedRun || {};
      const testTag = process.env.CT_HOOKS_TEST_MODE === '1' ? { test: true } : null;
      ctxLib.appendEvent(
        ownedRun.dir, 'gate-exempt-gitignored', { tool: toolName, path: targetPath, ...testTag }, ownedRun.attribution,
      );
      continue;
    }
    // The commit exemption (#537): ONLY for a target this loop resolved from a
    // 'commit' action (never 'push' — see the field comment above), and only
    // when the allowlist-matched command's staged set is provably nothing but
    // policy.yml. `bashCommand` is the whole command string; `targetPath` here
    // is the command's working directory, not a file, so it plays no part in
    // this check beyond having produced `action === 'commit'`.
    if (action === 'commit' && isPolicyOnlyCommit(bashCommand, ctx.cwd)) continue;
    // The delete-only push exemption (#658): ONLY for a target this loop
    // resolved from a 'push' action, and only when the ENTIRE command
    // matches the allowlist grammar above.
    if (action === 'push' && isDeleteOnlyPush(bashCommand)) continue;

    // Breadcrumb for the residue sweep's judgment class (#185, Task 12) —
    // scoped to ctx.ownedRun, NEVER ctx.runDir: this gate fires before any
    // pipeline run necessarily exists for THIS session, so there is no
    // "run being enforced" the way E1's wd-deny below has. The only run this
    // may write to is the one the calling session itself owns (ctxLib.
    // resolveRun's session/env attribution) — writing to the unfiltered
    // newest-non-terminal ctx.runDir would risk stamping another session's
    // audit trail with this session's own denied write ([IL-96]). Ad-hoc work
    // with no owned run dir stamps one now (#2351's stampAdHocRunDirForDenial
    // — a denial is a safe, narrow trigger even in the main checkout, unlike
    // the periodic per-hook-call check that deliberately excludes it) so this
    // event has somewhere to land instead of appendEvent's null-runDir no-op
    // silently dropping it.
    const ownedRun = ctx.ownedRun || {};
    const denialRunDir = ownedRun.dir || ctxLib.stampAdHocRunDirForDenial(ctx);
    // #1337: the test suite exercises this exact deny path against synthetic
    // repos (tests/hooks-dispatcher.test.js's runHook sets CT_HOOKS_TEST_MODE
    // for every pre-tool-use invocation it spawns), and those denials landed
    // in whatever real run dir happened to be reachable from cwd — polluting
    // friction-events.js's aggregate gate-denial count with fixture noise the
    // reflect Friction Lens couldn't tell apart from a real operator denial.
    // Tag rather than skip the write: existing tests assert the event IS
    // written (this is the mechanism under test), so the write must stay —
    // only its downstream aggregation (friction-events.js's readEvents)
    // should exclude it.
    const testTag = process.env.CT_HOOKS_TEST_MODE === '1' ? { test: true } : null;
    ctxLib.appendEvent(denialRunDir, 'gate-denial', { tool: toolName, path: targetPath, ...testTag }, ownedRun.attribution);

    const retryGuidance = action === 'push'
      ? `If you're trying to delete a branch whose worktree is already gone, there is nothing to ` +
        `"retry inside a worktree" — use \`gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/{branch}\` ` +
        `or \`gh pr merge --delete-branch\` instead. Otherwise, set one up first: invoke ` +
        `/superpowers:using-git-worktrees, then follow \`_shared/worktree-setup.md\`'s post-creation ` +
        `catch-up before any other action, then retry this push inside the new worktree.`
      : `Set one up first: invoke /superpowers:using-git-worktrees, then follow ` +
        `\`_shared/worktree-setup.md\`'s post-creation catch-up before any other action, ` +
        `then retry this edit inside the new worktree.`;
    return denyResult(
      // Derived from GATE_COVERAGE rather than spelled out, so widening
      // the gate can never leave this message describing the old reach
      // — the failure this whole binding exists to prevent (#70, #138).
      `claude-tweaks: this project requires an isolated worktree for ` +
      `${GATE_COVERAGE.tools.join('/')}, git ${GATE_COVERAGE.gitActions.join('/')}, and Bash ` +
      `${GATE_COVERAGE.bashWriteShapes.join('/')} writes (not every possible Bash write shape — ` +
      `see _shared/policy-schema-coverage.md's worktree-always coverage block; exempt: ` +
      `${GATE_COVERAGE.exemptions.paths.join(', ')}, an allowlisted (${GATE_COVERAGE.exemptions.commit}) commit, ` +
      `an allowlisted (${GATE_COVERAGE.exemptions.push}) push, and a write target that is ` +
      `${GATE_COVERAGE.exemptions.target} in its own repo) ` +
      `(policy: worktree-always in .claude-tweaks/policy.yml). You're currently working in ` +
      `a non-isolated checkout (${repoRoot}). ${retryGuidance}`,
    );
  }
  return {};
}

// Materialize-commit sentinel for the bookkeeping-stamps gate below: a
// committed `{run-dir}/work/{n}-spec.md` (or its multi-record
// `{run-dir}/spec-{slug}/work/{n}-spec.md` form) on the current branch is the
// signal that build/SKILL.md Spec Step 1's materialize commit already landed —
// the exact precondition build/worktree-setup.md Step 4.5 (record-worktree)
// and Step 6 (PR-early lifecycle) are documented to precede.
//
// Scoped to THIS RUN's own identity, not to "any work/ directory ever
// committed anywhere" (whole-branch review C1+C2). The canonical write
// location is `{run-dir}/work/{n}-spec.md` where `{run-dir}` is
// `.claude-tweaks/pipelines/{run-id}` — in worktree mode, the worktree-local
// mirror of that same relative path (flow/materialize.md's "worktree-local
// path" note), which is why the pathspec is built relative to `worktreeRoot`.
// A repo-root-relative `work` pathspec could therefore never match at all in
// a correctly-anchored project (the gate would be permanently inert), while a
// naively-widened `*/work/*` would match ANY legacy top-level `work/*-spec.md`
// still reachable in history — this repo alone carries ~100 of them from
// before run-dir anchoring existed — arming the gate universally on every
// branch. Threading `runDir` through is what makes the sentinel answer the
// only question worth asking: did THIS run's materialize commit land.
//
// #1688's third resolution source — scoped to THIS range bound alone, never
// to the shared `resolveIntegrationBranch` `hasMaterializeCommit` calls
// below. That function is also the reaper's and run-integrity.js's only
// source of an integration-branch name, and `_shared/integration-branch.md`'s
// per-consumer table restricts both of them to policy.yml and
// origin/HEAD — deliberately excluding any local-branch guess, because a
// probe there once reaped a worktree holding genuinely unmerged work (the
// file's own Anti-Patterns entry). Widening the shared resolver would import
// that exact hazard into two consumers that can delete or misreport state on
// a wrong answer.
//
// This call site carries none of that risk: an unresolved bound here falls
// back to the pre-#1674 UNBOUNDED walk (see hasMaterializeCommit's own
// comment below), never to `false` — so a wrong or missing guess only ever
// widens an already-conservative range, exactly like the "unresolved"
// case it stands in for. That asymmetry is what makes a local probe safe
// here and unsafe there.
//
// `main`/`master` are the two conventional default-branch names; a repo
// using neither leaves this returning null, same as before #1688 — no new
// failure mode, per AC3.
function resolveLocalDefaultBranchBound(repoRoot) {
  for (const candidate of ['main', 'master']) {
    const { failure } = runGit(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], repoRoot);
    if (!failure) return candidate;
  }
  return null;
}

// Read-only, best-effort: any git failure (no commits yet, git unavailable)
// and an unusable runDir both resolve to false — ambiguity never triggers the
// gate, same posture as every other check in this file.
function hasMaterializeCommit(worktreeRoot, runDir) {
  if (typeof runDir !== 'string' || !runDir) return false;
  const runId = path.basename(runDir);
  if (!runId || runId === '.' || runId === '..') return false;
  // PIPELINE_STATE_DIR (not a second hardcoded literal) + toPosix, since git
  // pathspecs are always forward-slash regardless of platform.
  const runRel = toPosix(path.join(PIPELINE_STATE_DIR, runId));
  // 'spec-*/work' (no trailing wildcard) does NOT match, empirically —
  // re-verified against a scratch repo with commits at both canonical shapes
  // after the run-id segment became a literal: git's default (non-glob-magic)
  // pathspec wildcard support only applies to the FINAL path component of a
  // pattern, so a wildcard directory component followed by a literal tail
  // never matches. 'spec-*/work/*' keeps the wildcard trailing so the
  // multi-record form ({run-dir}/spec-{slug}/work/{n}-spec.md) is reached.
  // Range-bound to this worktree's own commits (#1674). The unbounded walk
  // this replaces matched the run-id pathspec anywhere in HEAD's reachable
  // history — so once a run's materialize commit shipped and merged into the
  // integration branch, it became part of every LATER worktree's inherited
  // history and armed this gate against runs that had never materialized
  // anything of their own. `{integration}..HEAD` is "reachable from HEAD but
  // not from integration": exactly the commits unique to this worktree.
  //
  // When the integration branch can't be resolved, fall back to the
  // pre-#1674 UNBOUNDED walk rather than returning false.
  //
  // #1674's acceptance criteria asked for `false` here, reasoning that
  // "fail open" means "never a false denial". That reasoning does not hold
  // in this function: `false` means *the gate is not armed*, and this gate
  // is a protection (IL-131 — a build agent skipping mandatory bookkeeping),
  // not an alarm. Returning `false` would disable it outright for every repo
  // with no resolvable integration branch — which is every no-remote /
  // `local-merge` project, a permanently supported configuration
  // (`_shared/integration-model.md`). That trades a rare, self-correcting
  // false deny for the total loss of the guard in a whole project class.
  // Twenty pre-existing gate tests going red on the `false` version is the
  // measured evidence: they are ordinary repos with no `origin`.
  //
  // The fallback is strictly non-regressive — an unbounded walk is exactly the
  // behavior that shipped before #1674 — but it is NOT harmless, and an earlier
  // version of this comment overclaimed that it was. It said the #1674 false
  // positive "cannot arise where no integration branch exists". That is wrong,
  // and this record's own review caught it by reproduction: a no-remote
  // `local-merge` repo still has a real local integration branch (`main`) that
  // materialize commits merge into — it is merely not *resolvable* here, since
  // `resolveIntegrationBranch` needs either an `integration-branch:` policy key
  // (normally unset; `policy-schema.js` documents it as needed only when the
  // active branch is not the default) or an `origin/HEAD` (absent with no
  // remote). Unresolvable is not the same as nonexistent, so on this path the
  // pre-#1674 false positive genuinely persists.
  //
  // #1688 closed the no-remote gap described above: when the shared resolver
  // comes up empty, resolveLocalDefaultBranchBound (above) probes for a local
  // `main`/`master` — scoped to this call only, per that function's own
  // comment on why the shared resolver itself must not widen this way.
  //
  // Known limitation on the bounded path: a policy-configured or probed LOCAL
  // branch name can lag origin/{integration}. Usually that only widens the
  // range (the conservative false-deny direction) — but when HEAD has already
  // merged origin/{integration} in, as `_shared/worktree-setup.md`'s
  // post-creation catch-up does routinely, the lagging local ref can leave
  // those merged-in commits inside the range and reproduce the very
  // inherited-history arm this bound exists to stop. #1688 also fixed this
  // for the policy-configured case: `resolveIntegrationBranch` now upgrades a
  // resolved local name to its already-on-disk `origin/{name}` remote-tracking
  // ref when one exists (no fetch — see `preferRemoteTrackingRef` in
  // worktree-reap.js). The probed `main`/`master` fallback just below gets the
  // same upgrade for the same reason.
  const paths = ['--', `${runRel}/work`, `${runRel}/spec-*/work/*`];
  const bound = resolveIntegrationBranch(worktreeRoot) || resolveLocalDefaultBranchBound(worktreeRoot);
  const integration = bound ? preferRemoteTrackingRef(worktreeRoot, bound) : null;
  // Two distinct ways the bound can be unusable, and both must fall back the
  // same way. `null` is the obvious one. The other: `policy.readIntegrationBranch`
  // returns the raw `integration-branch:` string with no ref-existence check (it
  // only rejects whitespace), so a stale, renamed, or mistyped key yields a
  // TRUTHY name for which `git log {bogus}..HEAD` exits 128 (`fatal: bad
  // revision` — measured). Collapsing that into the blanket `if (failure) return
  // false` below would disarm IL-131 on a config typo: the same silent loss of
  // protection this comment rejects, reached by a different route.
  let res = integration
    ? runGit(['log', '--oneline', '-1', `${integration}..HEAD`, ...paths], worktreeRoot)
    : null;
  if (!res || res.failure) res = runGit(['log', '--oneline', '-1', ...paths], worktreeRoot);
  if (res.failure) return false;
  return Boolean(res.stdout && res.stdout.trim());
}

// Graceful-degrade exemption for the PR-stamp check below: pr-early-run-lifecycle.md
// mandates a "PR-early run lifecycle: ... FAILED" decisions.md log line whenever the
// push or `gh pr create` genuinely fails (Steps 2 and 3). A run that logged this
// legitimately has no PR to record and must not be denied for it — read-only,
// best-effort: a missing or unreadable decisions.md resolves to false (no exemption
// found), never throws.
function hasLoggedPrDegrade(runDir) {
  try {
    const body = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
    return /PR-early run lifecycle:.*FAILED/i.test(body);
  } catch {
    return false;
  }
}

// Chicken-and-egg escape hatch for the PR-stamp branch below (#989): a push
// that is establishing `dir`'s current branch on `origin` for the very first
// time (no upstream tracking ref configured yet) IS pr-early-run-lifecycle.md
// Step 2 itself — the one action a PR stamp cannot exist without. Without
// this, the PR-stamp deny fires on that very push (worktree stamp already
// landed, pr not yet recorded), making Step 6 structurally impossible: no run
// could ever produce the PR this gate demands. Ambiguous outcomes (timeout, no
// git, spawn failure) resolve to false — NOT exempt, the opposite of this
// file's usual "ambiguity resolves to allow" posture — because here ambiguity
// would silently widen a narrow, one-shot exemption into an unbounded one
// instead of merely allowing a single already-in-flight write through.
//
// #1860: `@{u}` failing with a git-error exit is NOT the only "never pushed"
// signal — it is also the state of a worktree branch created via
// `git worktree add -b {branch} {path} origin/{default}` (what
// `worktree.baseRef: fresh`, this plugin's own default, always does): git's
// `branch.autoSetupMerge` default inherits the branch-off point's tracking ref
// (`origin/{default}`) onto the new branch immediately, before it has ever
// been pushed under its own name. `@{u}` therefore resolves successfully —
// but to a DIFFERENT ref than this branch's own eventual remote — so the old
// git-error-only check misclassified every such worktree as "already tracked"
// and denied its first publish push. Comparing the resolved ref's name
// against `origin/{this-branch}` distinguishes the two: a match means a real
// prior push already established this branch's own remote tracking; anything
// else (a resolvable ref that isn't this branch's own, or resolution failing)
// means it has not. The branch-name lookup shares the same ambiguity posture
// as the upstream lookup above — a failure there is NOT exempt either.
// A single `git rev-parse` call resolving both revs, rather than two separate
// spawns — this is the common-case (already-tracked branch) hot path for
// every push, so it's worth one process instead of two. Safe to combine:
// empirically, when `@{u}` fails to resolve, git aborts before printing
// anything for EITHER arg (exit non-zero, empty stdout) — the exact shape
// the GIT_ERROR branch below already expects, and the one case that never
// needed the branch name anyway. When both resolve, git prints one line per
// arg in the given order (upstream, then HEAD).
function hasNoUpstreamYet(dir) {
  const combined = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}', 'HEAD'], dir);
  if (combined.failure === FAILURE.GIT_ERROR) return true;
  if (combined.failure) return false;
  const [upstream, branch] = combined.stdout.split('\n');
  return upstream !== `origin/${branch}`;
}

// The PRODUCTION integration-model read for the PR-stamp branch below.
// `_shared/integration-model.md`'s contract (and its "Re-detecting mid-run
// instead of reading the run's pin" anti-pattern) is that a run resolves the
// value ONCE at run start and every later read inside that run passes `--run`
// and gets the pin. The bare `resolveIntegrationModel(repoRoot)` this gate
// used to call reads policy.yml only (`runConfigRaw: null` internally), so a
// transient `gh` failure mid-run could flip the gate's own answer, and a run
// pinned `local-merge` in a repo whose bare forge detection says `pr-first`
// was denied for a PR it will legitimately never have (whole-branch review I3).
//
// Same overlay pathway bin/resolve-policy.js's own CLI uses — policy-schema's
// resolvePolicyConfig (policy.yml + {runDir}/config.yml) — with fresh forge
// detection kept ONLY as the fallback for a run that genuinely has not pinned
// anything yet, exactly mirroring that CLI's own integration-model branch.
// `readFile` is the small adapter that function's contract expects (returns
// null on any read failure). `git` is a no-spawn stub rather than a real
// adapter: resolvePolicyConfig calls it exactly once, with
// ['rev-parse', '--show-toplevel'], purely to learn the repo root it already
// received as `mainRoot` here (wtDetect.mainCheckoutRoot's fs-only result) —
// shelling out to re-derive a value the caller already has would undercut
// the spawn budget I5 exists to protect.
//
// This call site never passes detectIntegrationModel's mcpReachable override
// (see that function's own comment in policy-schema.js) — a lifecycle hook
// runs with no agent turn active, so there is no MCP call this gate could
// ever source a reachability signal from. This is a permanent, structural
// gap, not an oversight (docs/incident-log.md IL-63).
function resolveRunPinnedIntegrationModel(mainRoot, runDir) {
  const git = () => mainRoot;
  const readFile = (p) => {
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
  };
  const { root, result } = resolvePolicyConfig({ git, readFile, runDir, keys: ['integration-model'] });
  const entry = result['integration-model'];
  // 'run-config' or 'policy' — either is an explicit pin and wins outright.
  // 'default' (absent, or set-but-invalid) falls through to detection, the
  // same posture resolveIntegrationModel itself documents.
  if (entry && entry.source !== 'default') return entry.value;
  return detectIntegrationModel(root);
}

// True only on a PROVABLE ownership mismatch: this run's run-state.json was
// recorded by a session other than the one making this call. Mirrors E1's own
// owner-vs-caller comparison in runInner below — `ctx.runDir` reaches this
// gate WITHOUT session-id filtering (bin/hooks.js dispatches
// `ctxLib.resolveRunDir(cwd, process.env)` with no session id, deliberately,
// so E1 can enforce against the newest non-terminal run), which means the run
// this gate is about to name in a deny message may belong to a different,
// live sibling session. Identity missing on either side is not provable and
// is NOT foreign — it falls through to the deny, preserving prior behavior.
function isForeignSessionCall(ctx) {
  const owner = ctx.runState && typeof ctx.runState.sessionId === 'string' ? ctx.runState.sessionId : '';
  const caller = ctx.input && typeof ctx.input.session_id === 'string' ? ctx.input.session_id : '';
  return Boolean(owner && caller && owner !== caller);
}

// record-worktree-branch-only signal (#1259): on that branch ctx.runState.worktree
// is provably unset (checkBookkeepingStampsGate's own precondition for reaching
// it), and sessionId is stamped together with worktree by both record-worktree
// and post-tool-use.js's ad-hoc stamping — so ctx.runState.sessionId is almost
// always ALSO unset here, meaning isForeignSessionCall above can essentially
// never fire on this specific branch (owner is empty). ctx.ownedRun (bin/hooks.js's
// own session-scoped resolveRun call, resolved independently of this gate's
// session-agnostic ctx.runDir) supplies the signal that branch structurally
// cannot see: when the calling session already owns a DIFFERENT, already-recorded
// run than the one this gate is about to deny against, this run more plausibly
// belongs to a live sibling that hasn't stamped ownership yet than to the caller
// itself. Deliberately NOT folded into isForeignSessionCall — the PR-stamp branch
// keeps its existing, already-effective guard unchanged (see checkBookkeepingStampsGate).
function hasDistinctOwnedRun(ctx) {
  const owned = ctx.ownedRun && typeof ctx.ownedRun.dir === 'string' ? ctx.ownedRun.dir : '';
  return Boolean(owned && ctx.runDir && owned !== ctx.runDir);
}

// Path exemptions for the bookkeeping-stamps gate, reusing the very helpers
// checkWorktreeRequired's own carve-outs use (whole-branch review I2). Two
// reasons this is load-bearing rather than cosmetic:
//   1. The PR-stamp deny message's own escape hatch is "log the mandatory
//      PR-early run lifecycle FAILED line to decisions.md" — and decisions.md
//      lives inside the run dir, so without this exemption an Edit/Write to it
//      is denied by the very gate it is meant to unblock. (It happens to work
//      today only because this codebase logs via bin/log-decision.js, a Bash
//      CLI call this gate's Bash branch does not cover — an accident, not a
//      contract.)
//   2. .claude-tweaks/policy.yml is the file a session edits to CONFIGURE
//      gating; keeping it writable here matches spec #537's own carve-out.
// The target's OWN repo root is resolved per-target rather than assumed to be
// the worktree: run dirs are anchored to the MAIN checkout
// (_shared/pipeline-run-dir.md's Anchoring section), so decisions.md normally
// sits outside the worktree this gate is enforcing in. Anything unprovable
// (no target, indeterminate git, non-repo path) is simply not exempt and
// falls through — the same fail-closed posture isPipelineBookkeeping keeps.
function isStampsGateExemptTarget(ctx) {
  const targetPath = fileToolTargetPath(
    ctx.input && ctx.input.tool_name,
    ctx.input && ctx.input.tool_input,
  );
  if (!targetPath) return false;
  const { repoRoot, indeterminate } = wtDetect.repoInfo(targetPath);
  if (indeterminate || !repoRoot) return false;
  return isPipelineBookkeeping(repoRoot, targetPath) || isPolicyFile(repoRoot, targetPath);
}

// Shared outcome for both stamp checks in checkBookkeepingStampsGate below —
// each is an always-return branch (see the header comment there), so this
// returns the value the caller returns directly. A provably foreign-owned
// run (isForeignSessionCall above) downgrades the deny to an allow + warning;
// otherwise it denies. Only the stamp name and the two message bodies vary.
// #1431 audit: both appendEvent calls below deliberately use ctx.runDir, not
// ctx.ownedRun — checkBookkeepingStampsGate is entirely about "does the run
// assigned to THIS checkout carry its required stamps yet," a fact about the
// checkout/worktree, not about which run this session happens to own; every
// other signal in this function (ctx.runState, hasMaterializeCommit, the
// prExempt cache) is already scoped to ctx.runDir the same way. This is the
// session-agnostic worktree-bookkeeping comparison AC2 carves out, not the
// #1431 attribution-guess hazard (which is specific to resolveRun's
// 'fallback' arm guessing at an UNRELATED run with no worktree binding at
// all — ctx.runDir here is never that: it's the run this checkout's own
// binding names).
function stampCheckOutcome(ctx, stamp, wtRoot, warnings, warnText, denyText, isForeign) {
  if (isForeign) {
    ctxLib.appendEvent(ctx.runDir, 'wd-foreign-session', { stamp, worktree: wtRoot });
    warnings.push(warnText);
    return {};
  }
  ctxLib.appendEvent(ctx.runDir, 'bookkeeping-stamp-deny', { stamp, worktree: wtRoot });
  return denyResult(denyText);
}

// Bookkeeping-stamps gate: build/SKILL.md Spec Step 1 marks record-worktree
// (Common Step 1 Step 4.5) and, under integration-model: pr-first, the
// PR-early lifecycle's draft-PR open (Step 6) as non-skippable — a build
// agent's own "already satisfied by prior work" judgment has twice (IL-131,
// its recurrence on record #893) swept past both anyway despite the bolded
// prose. This is the mechanical backstop: once THIS run's materialize commit
// has landed (hasMaterializeCommit above — the exact precondition both
// sub-steps are documented to precede), a covered call is denied while either
// stamp is still missing — EXCEPT the PR-stamp branch's own one-shot
// exemption (#989, hasNoUpstreamYet above) for the initial publish push that
// pr-early-run-lifecycle.md Step 2 itself performs: without it, that push is
// indistinguishable from any other pre-PR write and gets denied by this same
// gate, making Step 6 structurally impossible to ever complete.
//
// Four checks now compose here, in this order:
//   1. Coverage + cheap outs — the tool isn't covered, `ctx.runDir` itself
//      never resolved (a run dir that resolved but has no run-state.json yet
//      is NOT this case — see #1456 below), the run is already clean, BOTH
//      stamps are already present OR the worktree stamp is present and the
//      PR stamp is durably not required
//      (`runState.prExempt` — the common case once a run's first covered call
//      after the worktree stamp has resolved its PR posture, and the one
//      that must never pay for a git/gh spawn again for the rest of the
//      run), or the call site is outside a linked worktree.
//   2. Scoping — a Bash git target in an unrelated repository is not this
//      run's business (mirrors E1's own mainRoot/actualMainRoot foreign-repo
//      check below), an Edit/Write/NotebookEdit whose own target resolves
//      outside this run's repository entirely is likewise not this run's
//      business (the file-tool branch's own foreign-target scoping, #1678),
//      and a write to the pipeline-bookkeeping tree or policy.yml is exempt
//      (isStampsGateExemptTarget above).
//   3. This run's materialize commit hasn't landed yet (hasMaterializeCommit
//      above) — Common Step 1 is still legitimately in progress.
//   4. The two stamp checks themselves — record-worktree unconditionally,
//      record-pr only under a run pinned `integration-model: pr-first`
//      (resolveRunPinnedIntegrationModel above) and with no logged degrade.
//      The first time this branch proves no further PR-stamp denial is
//      possible (model resolved cleanly to non-pr-first, or pr-first with
//      the degrade already logged), it persists `prExempt: true` to
//      run-state.json so every later covered call short-circuits at check 1
//      instead of re-paying repoInfo + hasMaterializeCommit + this
//      resolution — each hook invocation is a fresh process, so an in-memory
//      cache would not survive between calls; run-state.json is the durable
//      store already threaded through `ctx.runState` on every call. Both
//      cached conditions are permanent for the life of the run (the model is
//      pinned once at run start per `_shared/integration-model.md` and never
//      re-derived mid-run; decisions.md is append-only, so a logged degrade
//      line never disappears), so the cache can never produce a false allow
//      later. See the PR-stamp branch below for the one case that must NOT
//      be cached (a caught resolution exception).
// Ambiguity resolves to allow throughout, same posture as E1.
//
// A provably foreign-owned run (isForeignSessionCall above) downgrades either
// deny to an allow + warning collected into `warnings`, exactly as E1 does —
// the deny's own remediation command (`record-worktree --run "{ctx.runDir}"`)
// would otherwise instruct the agent to overwrite a live sibling session's
// run-state.json, which docs/hooks.md names as a corruption hazard. Collected
// rather than returned early so a warn never short-circuits runInner past E1
// (the IMPORTANT-3 lesson checkTeardownGate already records); run() attaches
// every collected note to whatever outcome runInner reaches.
//
// `deps.resolveIntegrationModel` is a full test-only override of the PR-stamp
// branch's model resolution, bypassing resolveRunPinnedIntegrationModel
// entirely when provided — a sandboxed test fixture repo has no real
// GitHub-backed remote, so real resolution can only ever return 'local-merge'
// in a test; injecting it is what lets the pr-first deny path be exercised at
// all (gh-api-module-pattern's injectable-runner convention). Unused by the
// worktree-stamp check.
function checkBookkeepingStampsGate(ctx, commandGitTargets, deps = {}, warnings = []) {
  const toolName = ctx.input && ctx.input.tool_name;
  const isFileTool = GATE_COVERAGE.tools.includes(toolName);
  const isGitWrite = toolName === 'Bash' && Array.isArray(commandGitTargets) && commandGitTargets.length > 0;
  if (!isFileTool && !isGitWrite) return {};
  if (!ctx.runDir) return {};
  // ctx.runState is null both when no run resolved (already excluded above)
  // AND when a real, adopted run dir exists but record-worktree never ran
  // yet (bin/hooks.js: `runState = runDir ? ctxLib.readRunState(runDir) :
  // null`, and readRunState returns null on a missing run-state.json the
  // same way it does on a missing run dir). Only the first case is "nothing
  // to gate" — the second is exactly the materialize-then-implement-directly
  // shortcut this gate exists to catch (#1456), so it must fall through to
  // the same stamp checks below as an explicit `runState.worktree` unset,
  // not no-op here.
  const runState = ctx.runState || {};
  if (runState.status === 'clean') return {};
  // Both stamps already recorded, OR the worktree stamp is recorded and the
  // PR stamp is durably exempt (`prExempt`, memoized by the PR-stamp branch
  // below the first time it proves no further denial is possible): neither
  // deny branch below can fire, so reach the same `{}` here instead of
  // paying for repoInfo's git spawn, hasMaterializeCommit's git spawn, and
  // (on the PR branch) a possible network-touching `gh` call — on EVERY
  // covered tool call of the run, including a `local-merge` run's steady
  // state, which never sets `runState.pr` and previously never reached this
  // short-circuit at all. Purely an optimization; it changes no deny/allow
  // outcome.
  if (runState.worktree && (runState.pr || runState.prExempt)) return {};

  const { repoRoot: wtRoot, isLinkedWorktree, indeterminate } = wtDetect.repoInfo(ctx.cwd || process.cwd());
  if (indeterminate || !wtRoot || !isLinkedWorktree) return {};

  // Foreign-repo scoping for the Bash branch (whole-branch review I2.2):
  // `git -C /some/other/repo commit` issued from inside this worktree targets
  // an entirely unrelated repository, and this run's bookkeeping has nothing
  // to say about it. Compares each target's own main-checkout root against
  // this worktree's — the identical mainRoot/actualMainRoot shape E1 uses in
  // runInner below, including its posture on the unprovable cases: an
  // unresolvable mainRoot here skips the check entirely (prior behavior
  // preserved), and a target whose own main root can't be resolved is not a
  // match. Only if NOT ONE target belongs to this project does the call go
  // un-gated — one in-project target is enough to keep the gate armed.
  if (isGitWrite) {
    const mainRoot = safeReal(wtDetect.mainCheckoutRoot(wtRoot));
    if (mainRoot) {
      const ownsATarget = commandGitTargets.some(
        (t) => safeReal(wtDetect.mainCheckoutRoot(t.dir)) === mainRoot,
      );
      if (!ownsATarget) return {};
    }
  }

  // Foreign-target scoping for the file-tool branch (#1678): an
  // Edit/Write/NotebookEdit whose OWN target path resolves outside any git
  // repository at all (a session scratchpad, e.g. under
  // /private/tmp/claude-*/.../scratchpad/**) — or inside an unrelated repo
  // entirely — is not this run's implementation work, mirroring the
  // Foreign-repos rule the isGitWrite branch already applies above. The
  // isFileTool branch previously gated on `ctx.cwd` (the calling session)
  // being inside a linked worktree, with no check that the write's own
  // TARGET was anywhere near that worktree — this closes that gap. Fails
  // CLOSED on an unprovable target (`indeterminate: true`), matching every
  // other file-tool exemption in this file (isPipelineBookkeeping,
  // isStampsGateExemptTarget): only a DEFINITIVE "not a repo" or "different
  // repo" answer exempts; an unresolvable target falls through to the
  // existing (denying) checks below, unchanged. Two more fail-closed layers
  // (whole-branch review findings 1+2, #1678):
  //   - `fileTargetPath` must be ABSOLUTE, mirroring isPipelineBookkeeping /
  //     realTarget / isUntrackedOrIgnored's own guard above — a relative
  //     path resolves against the HOOK PROCESS's cwd (repoInfo's internal
  //     path.resolve), not the calling session's `ctx.cwd`, so a relative
  //     target is unprovable here and must fall through unchanged, exactly
  //     like an indeterminate one.
  //   - `mainCheckoutRoot` returning null is NOT itself a "different repo"
  //     signal — it also means "the answer is unknown" (an EACCES/ELOOP/EIO
  //     stat, an unreadable/unparseable .git file, a gitdir outside
  //     .git/worktrees/ — see that function's own header). Only a
  //     resolved-AND-different targetMainRoot exempts; an unresolvable one
  //     falls through. A target that repoInfo itself already proved has NO
  //     repo root at all (the scratchpad case, targetRoot null but NOT
  //     indeterminate) still exempts on its own, unconditionally.
  if (isFileTool) {
    const fileTargetPath = fileToolTargetPath(toolName, ctx.input && ctx.input.tool_input);
    if (fileTargetPath && path.isAbsolute(fileTargetPath)) {
      // Resolve a symlink AT THE LEAF before asking repoInfo where the target
      // lives -- otherwise a symlink whose own location sits outside any repo
      // (e.g. a session scratchpad) but whose target resolves inside this
      // run's protected worktree would let the write bypass this gate
      // entirely, the same bypass class `realTarget()` (above) already
      // exists to close for `isPolicyFile`. A path with nothing at the leaf
      // yet (an ordinary new-file Write) is passed through UNRESOLVED on
      // purpose -- repoInfo's own nearestExistingDir already walks up to the
      // nearest existing ancestor correctly for that case, and resolving
      // only the parent here too would narrow that walk-up to one level.
      let resolvedTargetPath = fileTargetPath;
      let danglingSymlink = false;
      try {
        if (fs.lstatSync(fileTargetPath).isSymbolicLink()) {
          const real = safeReal(fileTargetPath);
          if (real) resolvedTargetPath = real;
          else danglingSymlink = true; // exists but unresolvable -> unprovable, fail closed
        }
      } catch { /* nothing at this path yet -- ordinary new-file case, use the literal path */ }
      if (!danglingSymlink) {
        const { repoRoot: targetRoot, indeterminate: targetIndeterminate } = wtDetect.repoInfo(resolvedTargetPath);
        if (!targetIndeterminate) {
          if (!targetRoot) return {}; // provably not a repo at all -- unconditional, matches the comment above
          const mainRoot = safeReal(wtDetect.mainCheckoutRoot(wtRoot));
          const targetMainRoot = mainRoot && safeReal(wtDetect.mainCheckoutRoot(targetRoot));
          if (targetMainRoot && targetMainRoot !== mainRoot) return {}; // provably a different repo
        }
      }
    }
  }

  if (isStampsGateExemptTarget(ctx)) return {};

  if (!hasMaterializeCommit(wtRoot, ctx.runDir)) return {};

  if (!runState.worktree) {
    return stampCheckOutcome(
      ctx, 'record-worktree', wtRoot, warnings,
      `claude-tweaks: pipeline run ${path.basename(ctx.runDir)} has a landed materialize commit but no recorded ` +
      `worktree assignment; allowing this call because it comes from a different session than the one that ` +
      `recorded the run. If this IS that pipeline's work, record it from the owning session — never with a bare ` +
      `record-worktree, which would target this run's state from outside it (docs/hooks.md).`,
      `claude-tweaks: a materialize commit already landed in ${wtRoot} but this run's worktree assignment was never ` +
      `recorded — build/worktree-setup.md Step 4.5 (record-worktree) is non-skippable, even when Spec Step 2 judges no ` +
      `further implementation is needed [IL-131]. Run: node "${pluginRoot()}/bin/hooks.js" record-worktree --run "${ctx.runDir}" "${wtRoot}"`,
      isForeignSessionCall(ctx) || hasDistinctOwnedRun(ctx),
    );
  }

  if (!runState.pr) {
    // #989: exempt an in-flight initial publish (see hasNoUpstreamYet above)
    // before doing anything else in this branch — this is a narrow, one-shot
    // allowance for THIS call only, never persisted as `prExempt`, so a push
    // to an already-tracked branch (Step 2 already ran once, `gh pr create`
    // never followed it) still falls through to the deny below, preserving
    // the "keep pushing forever, never open the PR" case IL-131 exists to
    // close. Applies only to the Bash/git branch (`commandGitTargets`) — an
    // Edit/Write/NotebookEdit call (`commandGitTargets` null) is never a
    // push and always continues past this check.
    if (Array.isArray(commandGitTargets) && commandGitTargets.length > 0
      && commandGitTargets.every((t) => t.action === 'push' && hasNoUpstreamYet(t.dir))) {
      return {};
    }
    const override = deps && deps.resolveIntegrationModel;
    const mainRoot = wtDetect.mainCheckoutRoot(wtRoot) || wtRoot;
    let model;
    // Tracks whether `model` came from a genuine resolution vs. the catch's
    // fail-open fallback — only a genuine resolution is a provable verdict
    // safe to cache below; a caught exception is a transient failure (e.g. a
    // flaky `gh` call) that a later, unmemoized call might resolve
    // differently, including to `pr-first`.
    let modelResolved = true;
    try {
      model = override ? override(mainRoot) : resolveRunPinnedIntegrationModel(mainRoot, ctx.runDir);
    } catch {
      model = 'local-merge'; // fail open: an unresolvable model is not provably pr-first
      modelResolved = false;
    }
    if (model === 'pr-first' && !hasLoggedPrDegrade(ctx.runDir)) {
      return stampCheckOutcome(
        ctx, 'record-pr', wtRoot, warnings,
        `claude-tweaks: pipeline run ${path.basename(ctx.runDir)} resolves integration-model: pr-first and has a ` +
        `landed materialize commit but no recorded PR; allowing this call because it comes from a different session ` +
        `than the one that recorded the run. If this IS that pipeline's work, open and record the PR from the ` +
        `owning session rather than stamping another session's run state (docs/hooks.md).`,
        `claude-tweaks: this project resolves integration-model: pr-first and a materialize commit already landed in ` +
        `${wtRoot}, but no PR is recorded for this run — build/worktree-setup.md Step 6 (the PR-early lifecycle draft-PR ` +
        `open, _shared/pr-early-run-lifecycle.md) is non-skippable, even when Spec Step 2 judges no further ` +
        `implementation is needed [IL-131]. Open it now, or — if the push/PR-create genuinely failed — log the ` +
        `mandatory "PR-early run lifecycle: ... FAILED" line to decisions.md per pr-early-run-lifecycle.md with: ` +
        `node "${pluginRoot()}/bin/log-decision.js" --run "${ctx.runDir}" --section "/build" --status AUTO ` +
        `--reversibility "n/a" --text "PR-early run lifecycle: <push|gh pr create> of <branch> FAILED (<reason>); ` +
        `run proceeds local-only, no PR opened"`,
        isForeignSessionCall(ctx),
      );
    }
    // No further PR-stamp denial is possible for the rest of this run: model
    // resolved cleanly to something other than pr-first (the run's pin is
    // fixed at run start and never re-derived — `_shared/integration-model.md`
    // — so it cannot later flip to pr-first), or it resolved pr-first but the
    // degrade line already landed in decisions.md (append-only — once present
    // it is permanent). Persist the verdict so every later covered call for
    // this run hits the check-1 short-circuit above instead of re-paying
    // repoInfo + hasMaterializeCommit + this same resolution. Skipped when
    // `modelResolved` is false (the catch above fired) — see its comment.
    if (modelResolved) {
      ctxLib.writeRunState(ctx.runDir, { prExempt: true });
    }
  }

  return {};
}

// `warnings` collects every allow-but-warn note raised anywhere in this pass
// (checkTeardownGate's foreign-owned teardown, checkBookkeepingStampsGate's
// foreign-owned run); run() attaches them all to whatever outcome is reached.
// `deps` is run()'s own pass-through of its test-only override bag — see
// run()'s header comment below — forwarded verbatim to
// checkBookkeepingStampsGate as its own `deps` parameter. No other gate in
// this pass currently takes an override.
function runInner(ctx, indeterminateTargets, warnings, deps) {
  const teardown = checkTeardownGate(ctx, warnings);
  if (teardown.json) return teardown;

  const shadow = checkPipelineShadowGuard(ctx);
  if (shadow.json) return shadow;

  const command = ctx.input && ctx.input.tool_name === 'Bash' && ctx.input.tool_input
    && typeof ctx.input.tool_input.command === 'string' ? ctx.input.tool_input.command : null;

  // #2065: the one resolvedGitSegments walk shared by checkGitStashWarn,
  // checkWorktreeRequired's Bash branch above, and the E1 loop below —
  // parsing the same command/cwd through a quote-aware segment/token walk
  // three times per invocation (once per consumer) was pure repeated work.
  const segments = command ? resolvedGitSegments(command, ctx.cwd) : null;
  checkGitStashWarn(segments, warnings);
  const commandGitTargets = segments ? gitTargetsFrom(segments) : null;

  const gate = checkWorktreeRequired(ctx, commandGitTargets, indeterminateTargets);
  if (gate.json) return gate;

  const stamps = checkBookkeepingStampsGate(ctx, commandGitTargets, deps, warnings);
  if (stamps.json) return stamps;

  if (!ctx.runDir || !ctx.runState || !ctx.runState.worktree) return {};
  if (ctx.runState.status === 'clean') return {};
  if (ctx.input.tool_name !== 'Bash') return {};
  if (typeof command !== 'string' || !command) return {};
  const assigned = safeReal(ctx.runState.worktree);
  if (!assigned) return {};

  // Multi-run project: the fallback resolver in bin/hooks.js always picks the
  // newest non-terminal run, so a terminal committing in its OWN assigned
  // worktree can land here with ctx.runDir pointing at a DIFFERENT (newer)
  // run. Build the full set of live worktrees (this run's plus every other
  // non-terminal run's) so such a commit is allowed rather than false-denied.
  const otherWorktrees = new Map(); // realpath (excluding this run's own) -> run dir
  for (const { dir, state } of ctxLib.listRunDirsWithState(ctx.cwd)) {
    if (!state || !state.worktree) continue;
    const real = safeReal(state.worktree);
    if (!real || real === assigned) continue;
    if (!otherWorktrees.has(real)) otherWorktrees.set(real, dir);
  }

  // #861: this run's assigned worktree is a linked worktree of some main
  // checkout — mainCheckoutRoot(assigned) resolves it via the fs-only
  // gitdir-pointer check (no git spawn needed, since `assigned`'s own `.git`
  // is always the worktree-marker FILE). The loop below compares it against
  // each target's own main-checkout root; the guard used to skip that step,
  // and so denied a commit in an out-of-repo scratch fixture repo exactly as
  // it denied one in the wrong in-project checkout.
  const mainRoot = safeReal(wtDetect.mainCheckoutRoot(assigned));

  // #1431 audit: every appendEvent call in this loop (wd-ambiguous,
  // wd-push-mismatch, wd-foreign-session, wd-deny below) deliberately uses
  // ctx.runDir, not ctx.ownedRun. E1 is, by this whole function's own header
  // comment, about "this checkout['s]" assigned pipeline run — a fact of the
  // WORKTREE, resolved the same session-agnostic way regardless of who is
  // calling (bin/hooks.js's own resolveRunDir(cwd, env) call for `runDir`
  // carries no session id at all, deliberately — see main()'s comment on
  // `runDir`/`runState`). Every event here documents what E1 decided about
  // THAT run, not an audit trail belonging to this session's own work — the
  // session-agnostic worktree-bookkeeping comparison AC2 carves out, not the
  // #1431 attribution-guess hazard (resolveRun's 'fallback' arm guessing at
  // an unrelated, unbound run — not what E1 resolves against here).
  for (const target of commandGitTargets || []) {
    const top = toplevel(target.dir);
    if (!top) continue; // cannot prove the target -> allow
    const actual = safeReal(top);
    if (!actual) continue;
    if (actual === assigned) continue;
    if (otherWorktrees.has(actual)) {
      // Matches a DIFFERENT live run's worktree -> allow, but a commit isn't
      // provably in the run this hook resolved, so flag it for review.
      if (target.action !== 'push') {
        ctxLib.appendEvent(ctx.runDir, 'wd-ambiguous', { matched: actual });
      }
      continue;
    }
    if (mainRoot) {
      // actual's OWN main-checkout root: for a repo that is genuinely part of
      // this project (the main checkout itself, or another of its linked
      // worktrees), this resolves to the same mainRoot as `assigned`. For a
      // foreign repo (e.g. a scratch fixture repo elsewhere), it resolves to
      // that repo's own root instead — provably a different repository, so
      // this gate has nothing to enforce there. An unresolvable actualMainRoot
      // is unprovable, not a match, and also allows here (ambiguity -> allow).
      // Checked AFTER otherWorktrees so a genuinely sibling worktree (already
      // provably this project's own, via its live run-state record) is never
      // reclassified as foreign merely because its own mainCheckoutRoot lookup
      // is inconclusive.
      const actualMainRoot = safeReal(wtDetect.mainCheckoutRoot(actual));
      if (actualMainRoot !== mainRoot) continue;
    }
    if (target.action === 'push') {
      ctxLib.appendEvent(ctx.runDir, 'wd-push-mismatch', { expected: assigned, actual, command: command.slice(0, 200) });
      continue;
    }
    const owner = typeof ctx.runState.sessionId === 'string' ? ctx.runState.sessionId : '';
    const caller = typeof ctx.input.session_id === 'string' ? ctx.input.session_id : '';
    // #1099: classify the caller's OWN resolved run (ctx.runState) via the
    // composite session+worktree-binding predicate instead of raw session-id
    // equality — a sibling of this same session, committing from a DIFFERENT
    // live worktree than ctx.runState records, must take the foreign branch
    // (allow + systemMessage) rather than falling through to wd-deny.
    // 'mine' and 'indeterminate' both preserve today's fall-through-to-deny.
    const ownershipVerdict = ctxLib.classifyOwnership({ sessionId: caller, cwd: ctx.cwd || process.cwd() }, ctx.runState);
    if (ownershipVerdict === 'foreign') {
      ctxLib.appendEvent(ctx.runDir, 'wd-foreign-session', { expected: assigned, actual, owner, caller, command: command.slice(0, 200) });
      return {
        exit: 0,
        json: {
          systemMessage:
            `claude-tweaks: pipeline run ${path.basename(ctx.runDir)} is active in worktree ${assigned}; ` +
            `allowing this commit because it comes from a different session. ` +
            `If this IS that pipeline's work, run it inside the worktree (git -C "${assigned}").`,
        },
      };
    }
    ctxLib.appendEvent(ctx.runDir, 'wd-deny', { expected: assigned, actual, session: caller || undefined, command: command.slice(0, 200) });
    const others = [...otherWorktrees.keys()];
    const othersNote = others.length ? ` Other active runs' worktrees: ${others.join(', ')}.` : '';
    return denyResult(
      `claude-tweaks working-directory discipline: this run's assigned worktree is ${assigned} but the commit targets ${actual}.` +
      othersNote +
      ` Re-run inside the worktree (cd "${assigned}") or use git -C "${assigned}". ` +
      `If this checkout is intentionally correct (e.g. finishing the branch), clear the assignment first: node "${pluginRoot()}/bin/hooks.js" close-run`,
    );
  }
  return {};
}

// Attaching the worktree-gate's indeterminate warning (and any collected
// allow-but-warn note — a foreign-owned teardown, a foreign-owned run's
// missing bookkeeping stamp) is done HERE, once, on whatever runInner
// returned — not at runInner's own return sites. runInner has a dozen of them
// and grows more over time; enumerating them to add a message is the exact
// shape `[IL-14]` records (an enumeration silently misses a path, and no test
// notices because the omission is invisible). This wrapper states the
// unconditional rule instead: every outcome, deny or allow, carries every
// collected note.
// `deps` (optional, default `{}`) is the ONE injection point run() offers a
// caller: a bag of test-only overrides forwarded verbatim to whichever inner
// gate declares its own `deps` parameter (today, only
// checkBookkeepingStampsGate's `resolveIntegrationModel` override — see that
// function's header comment). The production call site
// (bin/hooks.js's `main()`) calls `mod.run({...})` with a single argument, so
// `deps` is always `{}` there; only a test passes a second argument. Adding
// this parameter is what lets a test exercise checkBookkeepingStampsGate's
// pr-first branch through run()'s own dispatch instead of calling the gate
// function directly, bypassing every gate ahead of it in runInner (record #1268).
function run(ctx, deps = {}) {
  const indeterminateTargets = [];
  const warnings = [];
  const out = runInner(ctx, indeterminateTargets, warnings, deps) || {};

  const notes = [...warnings];
  if (indeterminateTargets.length) {
    // Deliberately says the check could not RUN, not that a policy was
    // skipped. Reaching here means findPolicyFile found a policy.yml
    // somewhere up the ancestor chain, which is not the same as
    // worktree-always being on for this repo — that check needs a repoRoot
    // we never obtained. Claiming "the gate was not applied" would assert a
    // policy applied that may not exist.
    notes.push(
      `claude-tweaks: could not determine the git repo status of `
      + `${indeterminateTargets.join(', ')} (git did not answer — timeout under load, refused fork, or missing git). `
      + `The worktree-always check could not run for ${indeterminateTargets.length > 1 ? 'these paths' : 'this path'}, so `
      + `${indeterminateTargets.length > 1 ? 'they were' : 'it was'} allowed rather than denied, per the never-break-a-session rule. `
      + `If this project requires an isolated worktree, verify manually.`,
    );
  }
  if (!notes.length) return out;

  const json = { ...(out.json || {}) };
  json.systemMessage = json.systemMessage ? [json.systemMessage, ...notes].join(' ') : notes.join(' ');
  // exit stays 0 on every path, deny included — the deny signal is the stdout
  // JSON's permissionDecision, never the exit code (see this file's header).
  return { ...out, exit: 0, json };
}

module.exports = {
  run,
  GATE_COVERAGE,
  PIPELINE_STATE_DIR,
  POLICY_FILE,
  isPipelineBookkeeping,
  isPolicyFile,
  isUntrackedOrIgnored,
  hasMaterializeCommit,
  isPolicyOnlyCommit,
  POLICY_COMMIT_ALLOWLIST,
  isDeleteOnlyPush,
  DELETE_ONLY_PUSH_ALLOWLIST,
  shadowPipelineRunDir,
  checkPipelineShadowGuard,
  // Exported for post-tool-use.js's post-teardown re-anchor backstop (#703)
  // to reuse rather than reimplement — the same target-resolution logic
  // this file's own checkTeardownGate already relies on.
  teardownTargets,
  toplevel,
  checkBookkeepingStampsGate,
  hasLoggedPrDegrade,
  // Exported for check-pr-bookkeeping.js's phase-boundary precondition check
  // (#2472) to reuse rather than reimplement — the same integration-model
  // resolution checkBookkeepingStampsGate's own PR-stamp branch already uses.
  resolveRunPinnedIntegrationModel,
};
