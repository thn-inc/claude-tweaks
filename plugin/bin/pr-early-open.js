#!/usr/bin/env node
// bin/pr-early-open.js — open (or reuse, or reopen) a pr-first run's draft PR
// at run start, in one call (#4027). The spec is
// skills/_shared/pr-early-run-lifecycle.md (gh-present Steps 1-4 and its
// Resume section); the procedure is lib/flow/pr-early-open.js.
//
//   node bin/pr-early-open.js --run <run-dir> --target "#N[,#M]" --fixes N[,M]
//     --title <text> --summary-file <path> [--worktree <path>] [--base <branch>]
//     [--next-step build] [--help]
//
// Resolves the branch (`git branch --show-current` in the worktree), the repo
// slug (`gh repo view`, host-qualified on GHE), and the base: --base verbatim
// when given; else the `integration-branch` key through resolve-policy's own
// lib (policy.yml, with the run's config.yml overlay), where a value holding
// whitespace is refused (exit 2) rather than silently replaced; else the
// GitHub default branch, rank 5's GitHub-default half of
// _shared/integration-branch.md (a worktree's current
// branch is a throwaway, never a base). --worktree defaults to run-state.json's
// `worktree`, then the cwd. The summary is read from a file (written with the
// Write tool), so record text never passes through a shell; one trailing
// newline is stripped. The body goes to the session temp path
// `pr-early-body-{run-id}.md` (lib/session-tmp.js, the keying
// bin/session-tmp-resolve.js uses). The PR is recorded as run-state.json's
// `pr: {number, url, branch}` through lib/hooks/context.js's writeRunState,
// the write `hooks.js record-pr` makes. Each decisions.md line lands under
// `## /build` exactly as bin/log-decision.js writes it.
//
// Stdout: one JSON line, {outcome, number?, url?, reason?, reopenRejected?};
// outcome is reused | reopened | opened | push-failed | create-failed.
// reopenRejected (a CLOSED PR number) appears when a reopen was refused and
// the run fell through to creation: the caller repoints an earlier attempt's
// issue pointer comment at the new PR, per the spec's "Reopen fails" paragraph.
// Exit 0 a PR is recorded (reused, reopened, opened).
//      3 a logged degrade (push-failed, create-failed): decisions.md carries the
//        FAILED line and the run proceeds local-only. A reused or reopened PR
//        whose push failed is still recorded, and its number is on stdout. A
//        stale recorded PR (Resume found it closed or gone) is cleared to
//        `pr: null` on a degrade, so nothing reads the closed PR as live.
//      2 malformed invocation; a --run that is missing, not anchored under the
//        main checkout (a worktree-local shadow, or outside every checkout), or
//        whose basename is not a run id; an unreadable --summary-file; an
//        integration-branch value holding whitespace; or gh absent — take the
//        MCP path in pr-early-run-lifecycle.md's "gh absent" row.
//      1 internal error (a gh/git read the procedure cannot do without failed,
//        unparseable output, an unwritable decisions.md or run-state.json). The
//        caller reads pr-early-run-lifecycle.md and finishes by hand.
// --run is anchored strictly, through lib/stage-item/write.js's resolveTarget
// (the sanctioned writers' predicate, reached through deps with mainRoot
// injectable), because the callers branch on this CLI's exit codes and nothing
// legitimately writes a run dir outside the main checkout. The refusal is
// exit 2, not the sanctioned writers' 3: here 3 is the logged degrade.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { openPrEarly } = require('./lib/flow/pr-early-open');
const { appendEntry } = require('./lib/log-decision/append');
const ctxLib = require('./lib/hooks/context');
const { resolveTarget } = require('./lib/stage-item/write');
const { resolvePolicyConfig } = require('./lib/policy-schema');
const { ghAvailable, parseRepo, repoSlug } = require('./lib/repo-resolve');
const { sessionTmpPath } = require('./lib/session-tmp');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS } = require('./lib/shared-primitives');

const USAGE = 'usage: pr-early-open.js --run <run-dir> --target "#N[,#M]" --fixes N[,M] --title <text> --summary-file <path>\n'
  + '         [--worktree <path>] [--base <branch>] [--next-step build] [--help]\n'
  + '  opens (or reuses/reopens) the run\'s draft PR: _shared/pr-early-run-lifecycle.md Steps 1-4 + Resume\n'
  + '  prints {outcome, number?, url?, reason?}; outcome: reused | reopened | opened | push-failed | create-failed\n'
  + '  exit 0 PR recorded (reused, reopened, opened)\n'
  + '       3 logged degrade (push-failed, create-failed) — run proceeds local-only\n'
  + '       2 malformed invocation, bad --run, unreadable --summary-file, or gh absent (take the MCP path)\n'
  + '       1 internal error — read _shared/pr-early-run-lifecycle.md and finish by hand\n';

const FLAGS = {
  '--run': 'run', '--target': 'target', '--fixes': 'fixes', '--title': 'title',
  '--summary-file': 'summaryFile', '--worktree': 'worktree', '--next-step': 'nextStep', '--base': 'base',
};
const REQUIRED = ['--run', '--target', '--fixes', '--title', '--summary-file'];
const OK_OUTCOMES = new Set(['reused', 'reopened', 'opened']);

function parseArgs(argv) {
  const o = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

const realDeps = {
  cwd: () => process.cwd(),
  ghAvailable: () => ghAvailable(),
  gh: (args, { cwd } = {}) => execFileSync('gh', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
  }),
  // GIT_TIMEOUT_MS bounds the one network call here, the push.
  git: (args, { cwd } = {}) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, windowsHide: true,
  }),
  sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  now: () => Date.now(),
  mainRoot: undefined, // resolveTarget derives the main-checkout anchor from cwd
  resolveTarget,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readRunState: (runDir) => ctxLib.readRunState(runDir),
  writeRunState: (runDir, patch) => ctxLib.writeRunState(runDir, patch),
  appendEntry,
  writeBodyFile: (name, text) => {
    const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, name) || path.join(os.tmpdir(), name);
    fs.writeFileSync(p, text);
    return p;
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function errText(e) {
  return [e && e.message, e && e.stderr].filter(Boolean).map((s) => String(s).trim()).join(' — ') || String(e);
}

async function run(argv, overrides = {}) {
  // Tests pass only the seams they fake; the rest stay real.
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`pr-early-open.js: ${message}\n${USAGE}`); return 2; };
  const internal = (message) => { deps.stderr(`pr-early-open.js: ${message}\n`); return 1; };

  // 1. Parse and validate; --help answers before any probe.
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  for (const flag of REQUIRED) if (!o[FLAGS[flag]]) return usageError(`${flag} is required`);
  const fixes = o.fixes.split(',').map((s) => s.trim().replace(/^#/, ''));
  if (!fixes.every((n) => /^[1-9]\d*$/.test(n))) return usageError(`--fixes takes record numbers, comma-separated: ${o.fixes}`);

  // 2. The run dir: an existing directory anchored under the main checkout
  // (strict), named by a run id (the PR body's marker).
  let target;
  try {
    const cwd = deps.cwd();
    target = deps.resolveTarget({ runDir: path.resolve(cwd, o.run), cwd, mainRoot: deps.mainRoot });
  } catch (e) {
    return usageError(errText(e));
  }
  if (!target.ok) {
    return usageError(target.reason === 'missing'
      ? `--run dir does not exist or is not a directory: ${o.run}`
      : `--run ${o.run} is not anchored under the main checkout (a worktree-local shadow, or outside every checkout) — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }
  const runDir = target.dir;
  const runId = path.basename(runDir);
  if (!ctxLib.RUN_ID_RE.test(runId)) return usageError(`--run basename is not a run id (a spec- subdir answers for its parent run): ${runId}`);

  let summary;
  try { summary = deps.readFile(o.summaryFile).replace(/\r?\n$/, ''); } catch (e) {
    return usageError(`could not read --summary-file: ${o.summaryFile} (${errText(e)})`);
  }

  // 3. gh absent is not a degrade (#929): the MCP path is the fallback.
  if (!deps.ghAvailable()) {
    deps.stderr('pr-early-open.js: gh is not available — open the draft PR through mcp__github__create_pull_request, '
      + 'per the "gh absent" row of _shared/pr-early-run-lifecycle.md (same dual-marker body, same decisions.md lines)\n');
    return 2;
  }

  try {
    let state = null;
    try { state = deps.readRunState(runDir); } catch { state = null; }
    const worktree = o.worktree || (state && typeof state.worktree === 'string' && state.worktree) || deps.cwd();
    const gh = (args) => deps.gh(args, { cwd: worktree });
    const git = (args, opts) => deps.git(args, { cwd: (opts && opts.cwd) || worktree });

    // The base: --base verbatim, else the configured key. The schema rejects
    // a value with whitespace (no branch name git accepts) and resolves it to
    // null; refuse it rather than quietly opening the PR against the GitHub
    // default instead. The raw value rides onInvalid, as in resolve-policy.js.
    let configured = null;
    if (!o.base) {
      let rejected = null;
      const { result } = resolvePolicyConfig({
        git: (args) => git(args), readFile: readFileSafe, runDir, keys: ['integration-branch'],
        onInvalid: (key, raw) => { rejected = raw; },
      });
      const entry = result['integration-branch'];
      const raw = entry && entry.value;
      configured = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      if ((entry && entry.invalid) || (configured && /\s/.test(configured))) {
        return usageError(`integration-branch value "${rejected ?? configured}" is not a branch name (it contains whitespace) — fix .claude-tweaks/policy.yml (or the run's config.yml), or pass --base <branch>`);
      }
    }

    const branch = String(git(['branch', '--show-current'])).trim();
    if (!branch) return internal(`no current branch in ${worktree} (detached HEAD?)`);

    const view = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef']));
    const spec = parseRepo(view && view.url);
    const repo = spec ? repoSlug(spec) : (view && view.nameWithOwner);
    if (!repo) return internal('gh repo view returned no repository');

    const base = o.base || configured || (view && view.defaultBranchRef && view.defaultBranchRef.name) || null;
    if (!base) return internal('could not resolve the integration branch (no --base, no integration-branch key, no GitHub default branch)');

    const res = await openPrEarly({
      runDir, worktree, branch, repo, base, target: o.target, fixes, title: o.title, summary,
      nextStep: o.nextStep || 'build',
    }, {
      gh,
      git,
      sleep: deps.sleep,
      now: deps.now,
      appendDecision: (entry) => deps.appendEntry({ runDir, section: '/build', entry }),
      recordPr: ({ number, url }) => {
        const written = deps.writeRunState(runDir, { pr: { number, url, branch } });
        if (!written) {
          throw new Error(`PR #${number} (${url}) is live but run-state.json could not be written — record it with: `
            + `node "\${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-pr --run "${runDir}" ${number} ${url}`);
        }
      },
      // A stale recorded PR on a degrade: `pr: null` reads as absent to
      // hasPrNumber and every `!state.pr` check.
      clearPr: () => {
        if (!deps.writeRunState(runDir, { pr: null })) {
          throw new Error(`run-state.json still records a closed PR and could not be cleared — run ${runDir} is PR-less (see decisions.md)`);
        }
      },
      readRunState: () => state,
      readDecisions: () => readFileSafe(path.join(runDir, 'decisions.md')) || '',
      writeBodyFile: deps.writeBodyFile,
      readFile: deps.readFile,
    });
    deps.stdout(`${JSON.stringify(res)}\n`);
    return OK_OUTCOMES.has(res.outcome) ? 0 : 3;
  } catch (e) {
    return internal(errText(e));
  }
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`pr-early-open.js: ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}
