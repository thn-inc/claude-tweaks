#!/usr/bin/env node
// bin/accept-park.js — the local-acceptance park (#4615). Under control mode a record whose
// acceptance target resolves to `local` is not merged: its PR stays open, its packet says
// `target: local` with the park-time head, `accept:pending` is on it, and the run is archived,
// its claim released and its worktree removed, so a human accepts it later with /accept. The
// decisions live in bin/lib/accept/ (target.js, park.js); this file reads the inputs, runs the
// steps and picks the exit code.
//
//   decide --record <n>[,<m>…] [--run <dir>] [--repo [host/]owner/name]
//          [--head <sha>] [--base <ref>] [--classification <file>]
//     One JSON line, decideSeries' result. Control mode off (isControlModeOn over
//     resolvePolicyKeys; control-mode is policyOnly (#5830), so the main checkout's policy.yml
//     alone decides it, with or without --run, which still anchors the AUTO lines) prints
//     `consulted: false` for every record and reads no record. On, each record's
//     body gives its kept risk flags (parseRiskFlags: ok -> flags, unclassified -> [], unknown
//     -> the widened flags, so it parks) and its Acceptance-target override; an invalid
//     acceptance-target value is passed as invalid (-> invalid-input, local).
//     The diff tripwire (#4619) runs here, control mode on only: the branch's diff (--head, 40 or
//     64 hex, fetched by oid when absent; --base, else integration-branch, else origin/HEAD's
//     branch, fetched first) read once through ctx.git, then each record's declared flags checked
//     against risk-path-globs and the agent's --classification (lib/accept/tripwire.js). A crossed
//     category nobody flagged is appended to the record body, read again right before the edit
//     (addTripwireRiskFlags, one `gh issue edit --body-file`; a failed write is a stderr line and the decision stays local through the
//     newFlags); a tripwire that could not run parks with reason `tripwire`. Each consulted
//     record's decision gains `tripwire: { …, appendFailed, lines }`; with --run, `lines` is also
//     written to {run}/packet-facts/tripwire-{n}.json, and a failed write exits 1 (decision printed).
//     Exit 0 printed; 1 policy.yml or config.yml unreadable (nothing printed), or a record body
//     that will not read (gh absent included) — its decision is still printed, failing closed
//     to local by invalid-input, and the caller must not merge — or a packet-facts write that
//     failed (decision printed too); 2 malformed invocation; 3 --run
//     refused (missing, or not anchored under the main checkout's .claude-tweaks/pipelines: a worktree-local shadow).
//   park --run <dir> --record <n>[,<m>…] --pr <n> --head <sha> --worktree <path>
//        [--claimed <n>[,<m>…]] [--worktree-mode remove|caller] [--repo [host/]owner/name]
//     --record names the records whose decision parks; --claimed every record the run claimed
//     (default: --record). Runs runPark's five steps: (1) per parked record, ensure the packet
//     and accept:pending — a found packet gets the label when no pending spelling is on it, no
//     packet gets one posted through acceptance-packet.js gather (deploy {"target":"local"}) ->
//     render (narrative {schemaVersion, claims: []}) -> post --label accept:pending, an
//     unreadable one fails; (2) per parked record, writeParkDeployStatus (--head, and the PR's
//     baseRefOid from one `gh pr view --json baseRefOid`, a failed read failing the step) and an
//     in-place comment edit (packet-post.js's graphql updateIssueComment); then one AUTO decisions.md line, then
//     (3) hooks.js close-run and archive-run, ok only on `claude-tweaks: archived`; (4)
//     releaseClaim for every --claimed record, ok on released or already-released; (5) remove:
//     `git -C <main checkout> worktree remove --force --force` (the driver locks its worktree),
//     `already gone` when `worktree list` no longer lists it; caller: the caller removes it.
//     One JSON line, runPark's result, plus `logFailed: true` only when the decisions.md append
//     failed (hand-log it). Exit 0 parked (a step 3-5 failure included, reported in `steps`);
//     1 park-failed (step 1 or 2, nothing archived); 2 malformed invocation or an unresolvable
//     repository; 3 --run refused; 4 gh absent, before any write.
//   parked --record <n> [--run <dir>] [--repo [host/]owner/name]
//     Prints parked / not-parked / unknown. control-mode resolves as decide resolves it (the
//     main checkout's policy.yml alone, #5830; a run's config.yml never overrides it): off
//     prints not-parked with no gh call, so a record parked under control mode is mergeable
//     once control mode is off (the accepted tradeoff, spec AC2a). On: isParkedForLocalAcceptance
//     over the record's labels and packet comment. Exit 0 parked, 5 not-parked, 6 unknown (a
//     record or policy read failure, or gh absent), 2 malformed invocation, 3 --run refused (as
//     decide). A caller treats 0 and 6 alike: do not merge, close or reap.
//   reenter --record <n> --pr <n> [--repo [host/]owner/name]
//     /accept's re-entry: bin/lib/accept/reentry.js adds `.claude/worktrees/accept-<n>` under the
//     main checkout from the PR branch's tip (never an existing directory). One JSON line:
//     { worktree, headRefName, prHead, prBase, parkHead, parkBase, moved, head } — parkHead and
//     parkBase are the packet's `park-head:` and `park-base:` (an unreadable or absent packet is
//     null, so moved); a moved base, or a pushed head since the PR view, is moved too. Exit 0 entered; 1 a git or
//     gh failure (including a PR view that will not read); 2 malformed invocation; 4 gh absent,
//     before any write; 7 stale directory, on disk or still registered with git (nothing touched;
//     reenter-remove clears it).
//   reenter-check --worktree <path> --expect-head <sha>
//     One JSON line { ok, head, dirty }. Exit 0 ok (HEAD is the expected commit, no tracked file
//     modified); 8 modified (HEAD moved or a tracked file differs); 1 a git failure; 2 malformed.
//   reenter-remove --worktree <path>
//     One JSON line { removed } (false: git no longer lists it). Only a direct child of
//     <main checkout>/.claude/worktrees named accept-<digits> is removed; it also clears the
//     registration of a deleted directory. Exit 0; 1 a git failure; 2 malformed or not an accept worktree.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { pinExplicitRepoHost } = require('./lib/repo-resolve');
const { appendStationEvent, toRepoName } = require('./lib/station-events/emit');
const { transitionsForLabel, releaseTransition } = require('./lib/station-events/stations');

const USAGE = [
  'usage: accept-park.js decide --record <n>[,<m>...] [--run <dir>] [--repo [host/]owner/name]',
  '         [--head <sha>] [--base <ref>] [--classification <file>]',
  '       accept-park.js park --run <dir> --record <n>[,<m>...] --pr <n> --head <sha> --worktree <path>',
  '         [--claimed <n>[,<m>...]] [--worktree-mode remove|caller] [--repo [host/]owner/name]',
  '       accept-park.js parked --record <n> [--run <dir>] [--repo [host/]owner/name]',
  '  decide: exit 0 printed; 1 policy or record read failure or a failed packet-facts write; 2 malformed; 3 --run refused',
  '  park:   exit 0 parked; 1 park-failed; 2 malformed or unresolvable repo; 3 --run refused; 4 gh absent',
  '  parked: exit 0 parked; 5 not-parked (control mode off included); 6 unknown; 2 malformed; 3 --run refused',
  '       accept-park.js reenter --record <n> --pr <n> [--repo [host/]owner/name]',
  '       accept-park.js reenter-check --worktree <path> --expect-head <sha>',
  '       accept-park.js reenter-remove --worktree <path>',
  '  reenter: exit 0 entered; 1 git or gh failure; 2 malformed; 4 gh absent; 7 stale directory',
  '  reenter-check: exit 0 ok; 8 modified; 1 git failure; 2 malformed',
  '  reenter-remove: exit 0 removed or already gone; 1 git failure; 2 malformed or not an accept-<n> worktree',
  '',
].join('\n');

const VERBS = Object.freeze({
  decide: { required: ['--record'], optional: ['--run', '--repo', '--head', '--base', '--classification'] },
  park: { required: ['--run', '--record', '--pr', '--head', '--worktree'], optional: ['--claimed', '--worktree-mode', '--repo'] },
  parked: { required: ['--record'], optional: ['--run', '--repo'] },
  reenter: { required: ['--record', '--pr'], optional: ['--repo'] },
  'reenter-check': { required: ['--worktree', '--expect-head'], optional: [] },
  'reenter-remove': { required: ['--worktree'], optional: [] },
});
const RECORD_LIST_RE = /^[1-9][0-9]*(?:,[1-9][0-9]*)*$/;
const POSITIVE_RE = /^[1-9][0-9]*$/;
// decide's --head is fetched by oid, which needs the full object name.
const FULL_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REF_NAME_RE = /^[A-Za-z0-9._/-]+$/;
const WORKTREE_MODES = Object.freeze(['remove', 'caller']);
const PARKED_EXIT = Object.freeze({ parked: 0, 'not-parked': 5, unknown: 6 });
const ARCHIVED = 'claude-tweaks: archived';
const LOG_STEP = 'accept-park.js park';

const flagKey = (flag) => flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const messageOf = (err) => (err && err.message ? err.message : String(err));
const isAbsentError = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
const firstLine = (text) => String(text || '').trim().split(/\r?\n/, 1)[0];

function recordList(flag, value) {
  if (!RECORD_LIST_RE.test(value)) return { error: `${flag} must be positive integers separated by commas, got: ${value}` };
  const numbers = value.split(',').map(Number);
  if (new Set(numbers).size !== numbers.length) return { error: `${flag} names a record twice: ${value}` };
  return { value: numbers };
}

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  if (verb === '--help' || verb === '-h') return { help: true };
  if (verb === undefined) return { error: 'a subcommand is required' };
  if (!Object.hasOwn(VERBS, verb)) return { error: `unknown subcommand: ${verb}` };
  const { required, optional } = VERBS[verb];
  const known = [...required, ...optional];
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!known.includes(flag)) return { error: `unknown argument: ${flag}` };
    const key = flagKey(flag);
    if (Object.hasOwn(opts, key)) return { error: `${flag} given more than once` };
    const value = rest[++i];
    // No value here starts with `-`: a path or ref that did would reach git as an option.
    if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) return { error: `${flag} requires a value` };
    if (flag === '--record' || flag === '--claimed') {
      const list = recordList(flag, value);
      if (list.error) return { error: list.error };
      opts[key] = list.value;
    } else if (flag === '--pr') {
      if (!POSITIVE_RE.test(value)) return { error: `--pr must be a positive integer, got: ${value}` };
      opts.pr = Number(value);
    } else if (flag === '--head' && verb === 'decide') {
      if (!FULL_OID_RE.test(value)) return { error: `--head must be 40 or 64 lowercase hex, got: ${value}` };
      opts.head = value;
    } else if (flag === '--base') {
      if (!REF_NAME_RE.test(value)) return { error: `--base must match ${REF_NAME_RE}, got: ${value}` };
      opts.base = value;
    } else if (flag === '--head' || flag === '--expect-head') {
      if (!require('./lib/accept/park').HEAD_SHA_RE.test(value)) return { error: `${flag} must be 7-64 lowercase hex, got: ${value}` };
      opts[key] = value;
    } else if (flag === '--worktree-mode') {
      if (!WORKTREE_MODES.includes(value)) return { error: `--worktree-mode must be one of ${WORKTREE_MODES.join('|')}, got: ${value}` };
      opts.worktreeMode = value;
    } else {
      opts[key] = value;
    }
  }
  const missing = required.find((flag) => !Object.hasOwn(opts, flagKey(flag)));
  if (missing) return { error: `${missing} is required` };
  if ((verb === 'parked' || verb === 'reenter') && opts.record.length !== 1) return { error: `${verb} takes one --record` };
  return { verb, opts };
}

const realDeps = {
  cwd: () => process.cwd(),
  get env() { return process.env; },
  homeDir: () => os.homedir(),
  // undefined: the main checkout is found from the working directory.
  mainRoot: undefined,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  removeFile: (p) => fs.unlinkSync(p),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  realpath: (p) => require('./lib/hooks/worktree-detect').safeReal(p),
  now: () => Date.now(),
  tmpPath: (name, env) => {
    try {
      return require('./lib/session-tmp').sessionTmpPath(env.CLAUDE_CODE_SESSION_ID, name) || path.join(os.tmpdir(), name);
    } catch {
      return path.join(os.tmpdir(), name);
    }
  },
  ghAvailable: ({ env, cwd } = {}) => require('./lib/repo-resolve').ghAvailable({ env, cwd }),
  pinGhHost: (repoSpec, { env, cwd } = {}) => pinExplicitRepoHost(repoSpec, { env, cwd }),
  // #5902: the station-event emitter; a caller that overrides it with undefined emits nothing.
  stationEvent: (e) => appendStationEvent(e),
  // `{ cwd, env, stderr, homeDir }` is the injected process context.
  gh: (args, { cwd, env, stderr, homeDir } = {}) => {
    const { ghOptions, injectedGhDeps } = require('./lib/repo-resolve');
    const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
    return execFileSync('gh', args, ghOptions(args, {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES,
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
    }, injectedGhDeps({ env, stderr, homeDir })));
  },
  git: (args, { cwd, env } = {}) => {
    const { GIT_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
    return execFileSync('git', args, {
      cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES,
    });
  },
  // A synchronous pause (the git-retry.js trick), injectable so a test never waits.
  sleep: (ms) => {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best-effort */ }
  },
  remoteUrl: ({ cwd, env } = {}) => execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }),
  // The claims-registry git-CAS runner release.js tries first; git only.
  gitRunner: (args, opts) => require('./lib/issues/claims-git-cas').defaultRunner(args, opts),
  releaseClaim: (opts) => require('./lib/release-claim/release').releaseClaim(opts),
  // A plugin node script as a child: { code, stdout, stderr }.
  spawn: (script, args, { cwd, env } = {}) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? messageOf(r.error) : '') };
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// The deps every verb shares, bound to the injected process context once.
function contextOf(opts, deps) {
  const absolute = (p) => (path.isAbsolute(p) ? path.resolve(p) : path.resolve(deps.cwd(), p));
  let mainRoot = null;
  const ctx = {
    absolute,
    mainRoot: () => {
      if (mainRoot === null) mainRoot = deps.mainRoot ?? require('./lib/hooks/worktree-detect').mainCheckoutRoot(deps.cwd());
      return mainRoot;
    },
    gh: (args) => deps.gh(args, { cwd: ctx.mainRoot(), env: deps.env, stderr: deps.stderr, homeDir: deps.homeDir }),
    // Every issue call carries --repo when given; `gh api` takes none.
    ghIssue: (args) => ctx.gh(opts.repo ? [...args, '--repo', opts.repo] : args),
    ghAvailable: () => deps.ghAvailable({ env: deps.env, cwd: ctx.mainRoot() }),
    git: (args) => deps.git(['-C', ctx.mainRoot(), ...args], { cwd: ctx.mainRoot(), env: deps.env }),
    gitRunner: (args, gitOpts = {}) => deps.gitRunner(args, { cwd: ctx.mainRoot(), env: deps.env, ...gitOpts }),
    node: (script, args) => deps.spawn(path.join(__dirname, script), args, { cwd: ctx.mainRoot(), env: deps.env }),
  };
  return ctx;
}

// The run dir when it is the main checkout's, else null with stderr saying why (exit 3).
function anchoredRun(runDir, deps) {
  const { resolveTarget } = require('./lib/log-decision/append');
  let target;
  try {
    // cwd is read only when the main checkout must be found from it.
    target = resolveTarget({ runDir, cwd: deps.mainRoot === undefined ? deps.cwd() : null, mainRoot: deps.mainRoot });
  } catch (err) {
    deps.stderr(`accept-park.js: ${messageOf(err)}\n`);
    return false;
  }
  if (target.ok) return true;
  if (target.reason === 'missing') deps.stderr(`accept-park.js: run dir does not exist: ${runDir}\n`);
  else if (target.reason === 'not-a-run-dir') deps.stderr(`accept-park.js: run dir is not a pipeline run directory (it must sit under .claude-tweaks/pipelines): ${runDir}\n`);
  else deps.stderr(`accept-park.js: run dir is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow): ${runDir} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section\n`);
  return false;
}

// The file's text, null when it is absent; any other failure throws.
function readOptional(deps, file) {
  try {
    return deps.readFile(file);
  } catch (err) {
    if (isAbsentError(err)) return null;
    throw err;
  }
}

function printJson(deps, value) {
  deps.stdout(`${JSON.stringify(value)}\n`);
}

// The main checkout's policy.yml and, given a run dir, its config.yml (absent -> null), or null
// with stderr saying which file would not read.
function readPolicySources(deps, ctx, runDir) {
  const root = ctx.mainRoot();
  if (!root) {
    deps.stderr('accept-park.js: could not find the main checkout to read its policy.yml\n');
    return null;
  }
  const sources = { policyRaw: null, runConfigRaw: null };
  const files = [['policyRaw', path.join(root, '.claude-tweaks', 'policy.yml')]];
  if (runDir !== null) files.push(['runConfigRaw', path.join(runDir, 'config.yml')]);
  for (const [key, file] of files) {
    try {
      sources[key] = readOptional(deps, file);
    } catch (err) {
      deps.stderr(`accept-park.js: could not read ${file} (${messageOf(err)})\n`);
      return null;
    }
  }
  return sources;
}

// ---- decide ----

function keptRiskFlags(parsed) {
  if (parsed.status === 'ok' || parsed.status === 'unknown') return parsed.flags;
  if (parsed.status === 'unclassified') return [];
  return null;
}

// An absolute path (the main checkout's, a lock file's) never reaches a packet line: a quoted
// one goes whole, spaces included, then a bare one, which must follow a non-word character so
// refs/remotes/origin/main stays readable.
function redactPaths(text) {
  return text
    .replace(/(['"])(?:[A-Za-z]:)?[\\/][^'"]*\1/g, '<path>')
    .replace(/(?<![\w.-])(?:[A-Za-z]:)?[\\/][^\s'"`]*/g, '<path>');
}

// A failed call's first line: git's and gh's own stderr when they carry it, else its exit status,
// signal or code, else the first line of a plain Error's message (no argv rides on an error that
// carries none of those), every line with absolute paths redacted. execFileSync's own message
// holds the whole argv, the main checkout's path included, so it is never used when status, signal
// or code is present.
function failureText(err) {
  const said = firstLine(err?.stderr);
  if (said) return redactPaths(said);
  if (Number.isInteger(err?.status)) return `exit ${err.status}`;
  if (typeof err?.signal === 'string') return `signal ${err.signal}`;
  if (typeof err?.code === 'string') return err.code;
  const message = firstLine(err?.message);
  return message ? redactPaths(message) : 'unknown error';
}

// A sibling session's fetch in the shared main checkout can hold the ref's lock. One retry,
// after a pause, before the failure stands.
const REF_LOCK_RE = /cannot lock ref|unable to create '[^']*\.lock'/i;
const REF_LOCK_RETRY_MS = 1000;
function fetchRef({ ctx, deps }, ref) {
  const argv = ['fetch', '--no-tags', 'origin', ref];
  try {
    return ctx.git(argv);
  } catch (err) {
    if (!REF_LOCK_RE.test(String(err?.stderr ?? ''))) throw err;
    deps.sleep(REF_LOCK_RETRY_MS);
    return ctx.git(argv);
  }
}

// The branch's changed paths, read once per decide call: { changedPaths, diffError }, the paths
// null with the failed step named when any step fails (the tripwire then could not run).
function readBranchDiff({ opts, ctx, deps, integrationBranch }) {
  const { parseNameStatus } = require('./lib/accept/tripwire');
  const fail = (diffError) => ({ changedPaths: null, diffError });
  if (opts.head === undefined) return fail('no --head given');
  const hasHead = () => {
    try {
      ctx.git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${opts.head}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };
  if (!hasHead()) {
    // GitHub serves a reachable commit by oid: how a sweep run from the main checkout reaches a PR head it never fetched.
    try {
      fetchRef({ ctx, deps }, opts.head);
    } catch {
      // the second check below decides
    }
    if (!hasHead()) return fail(`head commit ${opts.head} not available locally`);
  }
  let base = opts.base;
  if (base === undefined) {
    let name = integrationBranch;
    if (name === null) {
      try {
        name = firstLine(ctx.git(['rev-parse', '--abbrev-ref', 'origin/HEAD']));
      } catch (err) {
        return fail(`git rev-parse of origin/HEAD failed: ${failureText(err)}`);
      }
      if (!name.startsWith('origin/')) return fail(`origin/HEAD resolved to ${name}`);
      name = name.slice('origin/'.length);
    }
    if (!REF_NAME_RE.test(name) || name.startsWith('-')) return fail(`integration branch name unusable: ${name}`);
    // A stale origin/{name} would widen the diff with paths already merged.
    try {
      fetchRef({ ctx, deps }, name);
    } catch (err) {
      return fail(`git fetch of ${name} failed: ${failureText(err)}`);
    }
    base = `origin/${name}`;
  }
  let mergeBase;
  try {
    mergeBase = firstLine(ctx.git(['merge-base', '--end-of-options', base, opts.head]));
  } catch (err) {
    // merge-base exits 1 and says nothing when the two commits share no history.
    const reason = err?.status === 1 && !firstLine(err?.stderr) ? 'no merge base' : failureText(err);
    return fail(`git merge-base failed: ${reason}`);
  }
  if (!FULL_OID_RE.test(mergeBase)) return fail('git merge-base failed: it printed no commit');
  let raw;
  try {
    raw = ctx.git(['diff', '--name-status', '-z', '-M', '--no-color', '--no-ext-diff', '--end-of-options', `${mergeBase}..${opts.head}`]);
  } catch (err) {
    return fail(`git diff failed: ${failureText(err)}`);
  }
  const changedPaths = parseNameStatus(raw);
  return changedPaths === null ? fail('git diff output unparseable') : { changedPaths, diffError: undefined };
}

// --classification: undefined when not given, the parsed JSON, or 'unreadable' (which
// evaluateTripwire reports as a malformed classification) when the file will not read or parse.
function readClassification(opts, deps, ctx) {
  if (opts.classification === undefined) return undefined;
  try {
    const parsed = JSON.parse(deps.readFile(ctx.absolute(opts.classification)));
    return parsed === null ? 'unreadable' : parsed;
  } catch {
    return 'unreadable';
  }
}

// Writes the crossed flags into the record body, read again right before the edit so a body edit
// (a flag included) made since the first read is kept; returns the failure's first line, or undefined.
function appendTripwireFlags({ record, newFlags, extraCategories, deps, ctx }) {
  const { addTripwireRiskFlags } = require('./lib/issues/record');
  const file = deps.tmpPath(`accept-park-${record}-${process.pid}-tripwire.md`, deps.env);
  try {
    // A re-read that gives no usable body names its own reason, never err.message (it can carry a path).
    let body;
    try {
      body = JSON.parse(ctx.ghIssue(['issue', 'view', String(record), '--json', 'body']))?.body;
    } catch (err) {
      if (err instanceof SyntaxError) throw Object.assign(new Error(), { stderr: 'issue view output unparseable' });
      throw err;
    }
    if (typeof body !== 'string') throw Object.assign(new Error(), { stderr: 'issue view returned no body' });
    const next = addTripwireRiskFlags(body, newFlags, { extraCategories });
    if (next === body) return undefined;
    deps.writeFile(file, next);
    ctx.ghIssue(['issue', 'edit', String(record), '--body-file', file]);
    return undefined;
  } catch (err) {
    const text = failureText(err);
    deps.stderr(`accept-park.js: could not write the tripwire flags to #${record} (${text}) — this run is local\n`);
    return text;
  } finally {
    removeQuietly(deps, file);
  }
}

// The tripwire lines for the packet, one file per consulted record whose body read; false when a write failed.
function writeTripwireFacts({ runDir, tripwires, deps }) {
  const dir = path.join(runDir, 'packet-facts');
  let ok = true;
  for (const [record, tripwire] of tripwires) {
    const file = path.join(dir, `tripwire-${record}.json`);
    try {
      deps.mkdir(dir);
      deps.writeFile(file, `${JSON.stringify({ record, lines: tripwire.lines })}\n`);
    } catch (err) {
      ok = false;
      deps.stderr(`accept-park.js: could not write ${file} (${messageOf(err)}) — the packet would lose the tripwire's reason\n`);
    }
  }
  return ok;
}

function runDecide(opts, deps, ctx) {
  const { resolvePolicyKeys, BUILTIN_RISK_CATEGORIES } = require('./lib/policy-schema');
  const { isControlModeOn, extraCategoriesOf } = require('./lib/policy');
  const { decideSeries } = require('./lib/accept/park');
  // Without --run the repo-root policy.yml is the authority, as parked reads it.
  let runDir = null;
  if (opts.run !== undefined) {
    runDir = ctx.absolute(opts.run);
    if (!anchoredRun(runDir, deps)) return 3;
  }

  const sources = readPolicySources(deps, ctx, runDir);
  if (sources === null) return 1;
  const { policyRaw, runConfigRaw } = sources;
  const resolved = resolvePolicyKeys(['control-mode', 'acceptance-target'], { policyRaw, runConfigRaw });
  if (!isControlModeOn(resolved['control-mode'].value)) {
    printJson(deps, decideSeries(opts.record.map((record) => ({ record, input: { controlMode: false } }))));
    return 0;
  }

  const { parseRiskFlags, parseAcceptanceTarget, itemOverrideOf, parseTripwireFlags } = require('./lib/issues/record');
  const { evaluateTripwire, removalLogSlugs, tripwireLines } = require('./lib/accept/tripwire');
  const { isTrustedComment } = require('./lib/issues/comment-trust');
  const target = resolved['acceptance-target'];
  // Unset is the resolver's `default`; a set but invalid value is invalid, never the schema default.
  // No factoryRaw reaches the acceptance-target and risk-path-globs reads yet (#6007); a factory value, once
  // passed, is set like policy.yml's.
  let policyDefault = target.value;
  if (target.invalid) policyDefault = null;
  else if (target.source === 'default') policyDefault = undefined;
  // Gated by the control-mode result above (policy.yml alone, as readRiskPolicy gates, #5830). The two
  // risk keys resolve from policy.yml only; integration-branch takes the run's config.yml over policy.yml.
  const tripwirePolicy = resolvePolicyKeys(['risk-categories', 'risk-path-globs', 'integration-branch'], { policyRaw, runConfigRaw });
  const extraCategories = extraCategoriesOf(tripwirePolicy['risk-categories'].value);
  const categories = [...BUILTIN_RISK_CATEGORIES, ...extraCategories];
  const globsEntry = tripwirePolicy['risk-path-globs'];
  let globs = globsEntry.value;
  if (globsEntry.invalid) globs = null;
  else if (globsEntry.source === 'default') globs = undefined;
  const branchValue = tripwirePolicy['integration-branch'].value;
  const integrationBranch = typeof branchValue === 'string' && branchValue.trim() !== '' ? branchValue.trim() : null;
  const agentClassification = readClassification(opts, deps, ctx);

  // Read once, before any record body: the window from a body's read to its edit holds no git call.
  const { changedPaths, diffError } = readBranchDiff({ opts, ctx, deps, integrationBranch });

  const available = ctx.ghAvailable();
  const unread = [];
  const tripwires = new Map();
  const records = opts.record.map((record) => {
    let body;
    let comments;
    try {
      if (!available) throw new Error('gh is absent');
      const view = JSON.parse(ctx.ghIssue(['issue', 'view', String(record), '--json', 'body,comments']));
      body = view.body;
      comments = view.comments;
      if (typeof body !== 'string') throw new Error('the issue view has no body');
    } catch (err) {
      unread.push(record);
      deps.stderr(`accept-park.js: could not read #${record}'s body (${messageOf(err)}) — it resolves local by invalid-input\n`);
      return { record, input: { controlMode: true, keptRiskFlags: null, policyDefault } };
    }
    const declaredFlags = keptRiskFlags(parseRiskFlags(body, { extraCategories }));
    const result = evaluateTripwire({
      changedPaths,
      diffError,
      declaredFlags,
      tripwireFlags: parseTripwireFlags(body).flags,
      removedFlags: Array.isArray(comments) ? removalLogSlugs(comments.filter(isTrustedComment).map((comment) => comment.body)) : null,
      globs,
      agentClassification,
      categories,
    });
    const appendFailure = result.newFlags.length > 0
      ? appendTripwireFlags({ record, newFlags: result.newFlags, extraCategories, deps, ctx })
      : undefined;
    tripwires.set(record, {
      ...result,
      appendFailed: appendFailure !== undefined,
      lines: tripwireLines(result, appendFailure === undefined ? {} : { appendFailure }),
    });
    return {
      record,
      input: {
        controlMode: true,
        keptRiskFlags: declaredFlags,
        itemOverride: itemOverrideOf(parseAcceptanceTarget(body)),
        policyDefault,
        tripwire: { status: result.status, newFlags: result.newFlags },
      },
    };
  });
  const series = decideSeries(records);
  printJson(deps, { ...series, decisions: series.decisions.map((decision) => (tripwires.has(decision.record) ? { ...decision, tripwire: tripwires.get(decision.record) } : decision)) });
  const factsWritten = runDir === null || writeTripwireFacts({ runDir, tripwires, deps });
  return unread.length > 0 || !factsWritten ? 1 : 0;
}

// ---- parked ----

// Control mode off: nothing is parked, and no record is read — the merge path is today's. A
// record parked while control mode was on therefore reads not-parked, and is mergeable, once
// control mode is turned off: the accepted tradeoff (spec AC2a). An unreadable policy is unknown.
function runParked(opts, deps, ctx) {
  const { resolvePolicyKeys } = require('./lib/policy-schema');
  const { isControlModeOn } = require('./lib/policy');
  const { readPacket } = require('./lib/wrap-up/packet-gather');
  const { isParkedForLocalAcceptance } = require('./lib/accept/park');
  const [record] = opts.record;
  let runDir = null;
  if (opts.run !== undefined) {
    runDir = ctx.absolute(opts.run);
    if (!anchoredRun(runDir, deps)) return 3;
  }
  const sources = readPolicySources(deps, ctx, runDir);
  if (sources === null) {
    deps.stdout('unknown\n');
    return PARKED_EXIT.unknown;
  }
  if (!isControlModeOn(resolvePolicyKeys(['control-mode'], sources)['control-mode'].value)) {
    deps.stdout('not-parked\n');
    return PARKED_EXIT['not-parked'];
  }
  let labels = [];
  let packet = { status: 'unreadable' };
  if (ctx.ghAvailable()) {
    try {
      const view = JSON.parse(ctx.ghIssue(['issue', 'view', String(record), '--json', 'labels,comments']));
      if (!Array.isArray(view.labels) || !Array.isArray(view.comments)) throw new Error('labels or comments is not a list');
      const read = readPacket(view.comments);
      labels = view.labels;
      packet = read.status === 'found' ? { status: 'found', body: read.comment.body } : { status: read.status };
    } catch (err) {
      deps.stderr(`accept-park.js: could not read #${record} (${messageOf(err)})\n`);
    }
  } else {
    deps.stderr('accept-park.js: gh is absent — the park state is unknown\n');
  }
  const verdict = isParkedForLocalAcceptance({ labels, packet });
  deps.stdout(`${verdict}\n`);
  return PARKED_EXIT[verdict];
}

// ---- park ----

function resolveRepoSpec(opts, deps, ctx) {
  const { parseRepo, gateOriginRepo, injectedGhDeps, pickInjected } = require('./lib/repo-resolve');
  if (opts.repo !== undefined) return { spec: parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`) };
  let remote = null;
  try {
    remote = deps.remoteUrl({ cwd: ctx.mainRoot(), env: deps.env });
  } catch {
    remote = null;
  }
  const gated = gateOriginRepo(remote, injectedGhDeps(pickInjected(deps)));
  return { spec: gated.spec, refusal: gated.refusal };
}

function removeQuietly(deps, file) {
  try {
    deps.removeFile(file);
  } catch (err) {
    if (!isAbsentError(err)) deps.stderr(`accept-park.js: could not remove ${file} (${messageOf(err)})\n`);
  }
}

function parkSteps({ opts, deps, ctx, runDir, repoSpec, log }) {
  const { readComments, EDIT_COMMENT_QUERY } = require('./lib/wrap-up/packet-post');
  const { readPacket } = require('./lib/wrap-up/packet-gather');
  const { SCHEMA_VERSION } = require('./lib/wrap-up/packet-contract');
  const { LABELS, acceptanceOf, normalizeLabelNames } = require('./lib/issues/record-vocabulary');
  const { PARK_REASON, HEAD_SHA_RE, writeParkDeployStatus } = require('./lib/accept/park');
  const tmp = (n, suffix) => deps.tmpPath(`accept-park-${n}-${process.pid}-${suffix}`, deps.env);
  const perRecord = async (records, fn) => {
    const details = [];
    for (const n of records) {
      try {
        details.push(`#${n}: ${await fn(n)}`);
      } catch (err) {
        return { ok: false, detail: [...details, `#${n}: ${messageOf(err)}`].join('; ') };
      }
    }
    return { ok: true, detail: details.join('; ') };
  };
  const child = (script, args) => {
    const r = ctx.node(script, args);
    if (r.code !== 0) throw new Error(`${script} ${args[0]} exited ${r.code}: ${firstLine(r.stderr) || firstLine(r.stdout)}`);
    return r;
  };

  // A record with no packet comment still parks: gather, render with no claims, post labelled.
  const postFreshPacket = (n) => {
    const files = { deploy: tmp(n, 'deploy.json'), facts: tmp(n, 'facts.json'), narrative: tmp(n, 'narrative.json'), body: tmp(n, 'packet.md') };
    try {
      deps.writeFile(files.deploy, `${JSON.stringify({ target: 'local' })}\n`);
      deps.writeFile(files.narrative, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, claims: [] })}\n`);
      child('acceptance-packet.js', ['gather', '--record', String(n), '--run', runDir, '--deploy', files.deploy, '--out', files.facts]);
      child('acceptance-packet.js', ['render', '--facts', files.facts, '--narrative', files.narrative, '--out', files.body]);
      child('acceptance-packet.js', ['post', '--record', String(n), '--body-file', files.body, '--label', LABELS.ACCEPT_PENDING,
        ...(opts.repo ? ['--repo', opts.repo] : [])]);
    } finally {
      for (const file of Object.values(files)) removeQuietly(deps, file);
    }
    return 'packet posted';
  };

  const readFoundPacket = (n) => {
    const packet = readPacket(readComments(ctx.ghIssue, n));
    if (packet.status === 'unreadable') throw new Error(`the packet comment is unreadable (schemaVersion ${packet.version})`);
    return packet;
  };

  // The PR's base oid, read once for every parked record's `park-base:` line.
  let baseOid = null;
  const prBase = () => {
    if (baseOid !== null) return baseOid;
    const { baseRefOid } = JSON.parse(ctx.ghIssue(['pr', 'view', String(opts.pr), '--json', 'baseRefOid']));
    if (typeof baseRefOid !== 'string' || !HEAD_SHA_RE.test(baseRefOid)) throw new Error(`PR #${opts.pr} has no usable baseRefOid`);
    baseOid = baseRefOid;
    return baseOid;
  };

  // The tripwire lines `decide` wrote for this record (packet-facts/tripwire-{n}.json): absent is no
  // lines; anything unreadable fails step 2, so a stated reason is never silently lost.
  const tripwireNotes = (n) => {
    let text;
    try {
      text = deps.readFile(path.join(runDir, 'packet-facts', `tripwire-${n}.json`));
    } catch (err) {
      if (isAbsentError(err)) return [];
      throw new Error(`tripwire lines unreadable: ${messageOf(err)}`);
    }
    let facts;
    try {
      facts = JSON.parse(text);
    } catch (err) {
      throw new Error(`tripwire lines unreadable: ${messageOf(err)}`);
    }
    if (facts?.record !== n) throw new Error(`tripwire lines unreadable: the file is for record ${JSON.stringify(facts?.record ?? null)}, not #${n}`);
    const lines = facts.lines;
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === 'string')) throw new Error('tripwire lines unreadable: lines is not a list of strings');
    return lines;
  };

  const claimed = opts.claimed ?? opts.record;
  const prUrl = `https://${repoSpec.host || 'github.com'}/${repoSpec.owner}/${repoSpec.repo}/pull/${opts.pr}`;
  const worktree = ctx.absolute(opts.worktree);
  const runId = path.basename(runDir) || null;
  const repoName = toRepoName(`${repoSpec.owner}/${repoSpec.repo}`);
  const sessionId = deps.env?.CLAUDE_CODE_SESSION_ID || null;
  // #5902: optional dep (absent = none), each emission wrapped so a throwing
  // emitter never changes a step's detail, stdout or the exit code.
  const emit = (event) => {
    if (typeof deps.stationEvent !== 'function' || !repoName) return;
    try {
      deps.stationEvent({ repoName, sessionId, lane: 'unknown', ...event });
    } catch { /* best-effort: the park stands */ }
  };

  return {
    postPacket: () => perRecord(opts.record, (n) => {
      const added = (said) => {
        for (const t of transitionsForLabel(LABELS.ACCEPT_PENDING, 'added')) {
          emit({ ...t, recordNumber: n, runId, payload: { label: LABELS.ACCEPT_PENDING }, discriminator: `accept-pending:${n}:${runId || ''}` });
        }
        return said;
      };
      const packet = readFoundPacket(n);
      if (packet.status !== 'found') return added(postFreshPacket(n));
      const { labels } = JSON.parse(ctx.ghIssue(['issue', 'view', String(n), '--json', 'labels']));
      if (!Array.isArray(labels)) throw new Error('labels is not a list');
      if (acceptanceOf(normalizeLabelNames(labels)) === 'pending') return 'pending label present';
      ctx.ghIssue(['issue', 'edit', String(n), '--add-label', LABELS.ACCEPT_PENDING]);
      return added(`${LABELS.ACCEPT_PENDING} added`);
    }),
    writeDeployStatus: () => perRecord(opts.record, (n) => {
      const packet = readFoundPacket(n);
      if (packet.status !== 'found') throw new Error('no packet comment to write the park state into');
      const { body, changed } = writeParkDeployStatus(packet.comment.body, { headSha: opts.head, baseSha: prBase(), notes: tripwireNotes(n) });
      if (!changed) return 'park state already written';
      const file = tmp(n, 'parked.md');
      try {
        deps.writeFile(file, body);
        ctx.gh(['api', 'graphql', '-f', EDIT_COMMENT_QUERY, '-f', `id=${packet.comment.id}`, '-F', `body=@${file}`]);
      } finally {
        removeQuietly(deps, file);
      }
      return `park state written, head ${opts.head}, base ${prBase()}`;
    }),
    archiveRun: async () => {
      log();
      const closed = ctx.node('hooks.js', ['close-run', '--run', runDir]);
      if (closed.code !== 0) return { ok: false, detail: `close-run exited ${closed.code}: ${firstLine(closed.stderr) || firstLine(closed.stdout)}` };
      const archived = ctx.node('hooks.js', ['archive-run', '--run', runDir]);
      const said = firstLine(archived.stdout) || firstLine(archived.stderr) || `archive-run exited ${archived.code}`;
      return { ok: archived.code === 0 && archived.stdout.includes(ARCHIVED), detail: said };
    },
    releaseClaim: async () => {
      const details = [];
      let ok = true;
      for (const n of claimed) {
        const r = deps.releaseClaim({
          owner: repoSpec.owner, repo: repoSpec.repo, host: repoSpec.host, issueNumber: n, runId: path.basename(runDir),
          reason: PARK_REASON, link: prUrl, runner: ctx.gh, gitRunner: ctx.gitRunner, now: deps.now(),
        });
        // Only a real release ends the build visit; `already-released` is a repeat.
        // lane stays 'unknown' (the emit default): park cannot know the lane, and lane is no eventKey input.
        const transition = releaseTransition(PARK_REASON);
        if (r.outcome === 'released' && transition) {
          emit({
            ...transition, recordNumber: n,
            runId, payload: { ...transition.payload, reason: PARK_REASON }, discriminator: `release:${runId || ''}:${r.claimedAt || ''}`,
          });
        }
        const released = r.outcome === 'released' || r.outcome === 'already-released';
        if (!released) ok = false;
        details.push(`#${n}: ${r.outcome}${r.error ? ` (${r.error})` : ''}${r.holder ? ` (held by ${r.holder})` : ''}`);
      }
      return { ok, detail: details.join('; ') };
    },
    removeWorktree: async () => {
      if ((opts.worktreeMode ?? 'remove') === 'caller') return { ok: true, detail: `caller-removes ${worktree}` };
      const { parseWorktreeList, findWorktreeEntry } = require('./lib/hooks/worktree-reap');
      const { canonicalWorktreePath } = require('./lib/driver/settle');
      const listed = parseWorktreeList(ctx.git(['worktree', 'list', '--porcelain']));
      if (!findWorktreeEntry(listed, canonicalWorktreePath(worktree, deps.realpath, path))) return { ok: true, detail: 'already gone' };
      // --force twice: a locked worktree (the driver creates its own locked) is removed only so.
      ctx.git(['worktree', 'remove', '--force', '--force', '--end-of-options', worktree]);
      return { ok: true, detail: `removed ${worktree}` };
    },
  };
}

async function runParkVerb(opts, deps, ctx) {
  const { runPark, PARK_REASON } = require('./lib/accept/park');
  const { formatEntry, appendEntry } = require('./lib/log-decision/append');
  const runDir = ctx.absolute(opts.run);
  if (!anchoredRun(runDir, deps)) return 3;
  if (!ctx.ghAvailable()) {
    deps.stderr("accept-park.js: gh is absent — nothing parked; follow _shared/github-write-transport.md's MCP path\n");
    return 4;
  }
  const { spec: repoSpec, refusal } = resolveRepoSpec(opts, deps, ctx);
  if (!repoSpec) {
    deps.stderr(`accept-park.js: ${refusal || 'could not resolve owner/repo — pass --repo [host/]owner/name'}\n`);
    return 2;
  }
  if (opts.repo !== undefined) deps.pinGhHost(repoSpec, { env: deps.env, cwd: ctx.mainRoot() });

  let logFailed = false;
  // Before step 3: the run dir is archived there, and its record of why goes with it.
  const log = () => {
    try {
      const entry = formatEntry({
        status: 'AUTO', now: deps.now(), step: LOG_STEP, reversibility: 'medium',
        text: `park: target local (${PARK_REASON}), head ${opts.head}; archiving run, releasing claim, removing worktree`,
      });
      appendEntry({ runDir, entry, createParent: false });
    } catch (err) {
      logFailed = true;
      deps.stderr(`accept-park.js: could not append the decisions.md entry (${messageOf(err)}) — hand-log it\n`);
    }
  };
  const result = await runPark(parkSteps({ opts, deps, ctx, runDir, repoSpec, log }));
  printJson(deps, logFailed ? { ...result, logFailed: true } : result);
  for (const step of result.steps.filter(({ ok }) => !ok)) deps.stderr(`accept-park.js: step ${step.step} ${step.name} failed: ${step.detail}\n`);
  return result.outcome === 'parked' ? 0 : 1;
}

function validRepo(repo) {
  if (repo === undefined) return true;
  const { parseRepo } = require('./lib/repo-resolve');
  const spec = parseRepo(repo.split('/').length >= 3 ? repo : `github.com/${repo}`);
  return spec !== null && !['.', '..'].includes(spec.owner) && !['.', '..'].includes(spec.repo);
}

// ---- reenter, reenter-check, reenter-remove ----

const REENTER_EXIT = Object.freeze({ staleDir: 7, modified: 8 });

// reentry.js hands its git runner the whole argv, `-C <dir>` included.
const reentryGit = (deps, ctx) => (args) => deps.git(args, { cwd: ctx.mainRoot(), env: deps.env });

// The packet's park-head and park-base for the record, both null when the packet is absent or
// will not read.
function parkShasOf(record, deps, ctx) {
  const { readPacket } = require('./lib/wrap-up/packet-gather');
  const { parkStateOf } = require('./lib/accept/park');
  try {
    const view = JSON.parse(ctx.ghIssue(['issue', 'view', String(record), '--json', 'comments']));
    if (!Array.isArray(view.comments)) throw new Error('comments is not a list');
    const read = readPacket(view.comments);
    if (read.status !== 'found') throw new Error(`the packet is ${read.status}`);
    const { headSha, baseSha } = parkStateOf(read.comment.body);
    return { parkHead: headSha, parkBase: baseSha };
  } catch (err) {
    deps.stderr(`accept-park.js: could not read #${record}'s park head (${messageOf(err)}) — the PR counts as moved\n`);
    return { parkHead: null, parkBase: null };
  }
}

function runReenter(opts, deps, ctx) {
  const { reenter } = require('./lib/accept/reentry');
  const [record] = opts.record;
  const repoRoot = ctx.mainRoot();
  if (!repoRoot) {
    deps.stderr('accept-park.js: could not find the main checkout\n');
    return 1;
  }
  if (!ctx.ghAvailable()) {
    deps.stderr('accept-park.js: gh is absent — nothing entered; follow _shared/github-write-transport.md\'s MCP path\n');
    return 4;
  }
  try {
    const result = reenter({
      record, pr: opts.pr, repoRoot, ...parkShasOf(record, deps, ctx),
      git: reentryGit(deps, ctx), gh: (args) => ctx.ghIssue(args),
    });
    printJson(deps, result);
    return 0;
  } catch (err) {
    deps.stderr(`accept-park.js: reenter: ${messageOf(err)}\n`);
    return err.code === 'stale-dir' ? REENTER_EXIT.staleDir : 1;
  }
}

function runReenterCheck(opts, deps, ctx) {
  const { reenterCheck } = require('./lib/accept/reentry');
  try {
    const result = reenterCheck({ worktree: ctx.absolute(opts.worktree), expectHead: opts.expectHead, git: reentryGit(deps, ctx) });
    printJson(deps, result);
    return result.ok ? 0 : REENTER_EXIT.modified;
  } catch (err) {
    deps.stderr(`accept-park.js: reenter-check: ${messageOf(err)}\n`);
    return 1;
  }
}

function runReenterRemove(opts, deps, ctx) {
  const { reenterRemove } = require('./lib/accept/reentry');
  const repoRoot = ctx.mainRoot();
  if (!repoRoot) {
    deps.stderr('accept-park.js: could not find the main checkout\n');
    return 1;
  }
  try {
    printJson(deps, reenterRemove({ worktree: ctx.absolute(opts.worktree), repoRoot, git: reentryGit(deps, ctx), realpath: deps.realpath }));
    return 0;
  } catch (err) {
    deps.stderr(`accept-park.js: reenter-remove: ${messageOf(err)}\n`);
    return err.code === 'not-accept-worktree' ? 2 : 1;
  }
}

const HANDLERS = Object.freeze({
  decide: runDecide, park: runParkVerb, parked: runParked,
  reenter: runReenter, 'reenter-check': runReenterCheck, 'reenter-remove': runReenterRemove,
});

async function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const parsed = parseArgs(argv);
  if (parsed.help) {
    deps.stdout(USAGE);
    return 0;
  }
  if (!parsed.error && !validRepo(parsed.opts.repo)) parsed.error = `malformed --repo: ${parsed.opts.repo}`;
  if (parsed.error) {
    deps.stderr(`accept-park.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const ctx = contextOf(parsed.opts, deps);
  try {
    return await HANDLERS[parsed.verb](parsed.opts, deps, ctx);
  } catch (err) {
    // An unexpected throw fails closed: decide and park on 1 (no merge), parked on unknown.
    deps.stderr(`accept-park.js: ${parsed.verb}: ${messageOf(err)}\n`);
    if (parsed.verb !== 'parked') return 1;
    deps.stdout('unknown\n');
    return PARKED_EXIT.unknown;
  }
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
