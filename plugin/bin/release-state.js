#!/usr/bin/env node
// bin/release-state.js — the "reviewed through" marker /release keeps on the `release-state`
// branch (#5883): read it, advance it, create it, reset it. The marker only moves forward along
// the integration branch's first-parent line (lib/release-state/marker.js owns that rule and the
// compare-and-set writes); this CLI parses, resolves the repo, wires the transports and maps each
// operation's outcome to one exit code.
//
// usage: release-state.js marker read [--repo [host/]owner/name | --marker-json <path>]
//        release-state.js marker advance --to <sha> --run <id> [--branch <name>] [--repo [host/]owner/name | --marker-json <path> [--after-conflict]]
//        release-state.js marker init --to <sha> [--branch <name>] [--repo [host/]owner/name | --emit]
//        release-state.js marker reset --to <sha> --run <id> [--force (--reason <text> | --reason-file <path>)] [--branch <name>] [--repo [host/]owner/name | --marker-json <path>]
//        release-state.js [--help]
//
//   --reason-file <path> reads a forced reset's reason from a file (relative to the cwd; one
//   trailing line break is the file's), so a skill passes free text no shell ever expands. The
//   text meets every rule --reason does; an unreadable file or invalid text is exit 2.
//
//   Exit 0 ok, 1 refused, 2 usage, 3 unreadable, 4 contested, 5 insufficient-history, 6 orphaned.
//   Exit 3 also covers a write that failed for a non-contest reason (a refused push or contents-API
//   PUT, an uncreatable branch), the same overload release-block.js documents for its exit 3.
//   Stdout on exit 0 is one JSON line, except `--help`, which prints the usage text on exit 0.
//   Exits 1 and 3-6 print nothing on stdout and one stderr line, `release-state.js: {outcome} —
//   {reason}` (a `gh` that is absent adds a hint line). Exit 2 prints `release-state.js: {error}`
//   and then the usage text on stderr; an unresolvable or refused repo prints its one line alone.
//
//   gh path   Repo from --repo, else the gated origin. The local clone is used (git leg first,
//             then first-parent descent over a fetched snapshot) only when it is inside a work
//             tree and its origin gates to the same host, owner and repo as the target; any
//             other target (including a typed --repo naming a different repo) uses the contents
//             and compare APIs only, with no git call that could reach `origin`.
//   emit path --marker-json <path> (read, advance, reset) or --emit (init): for a `gh`-absent
//             firing. No gh call, no repo resolution; the descent check runs on the local clone
//             only. The file the agent fetched over MCP is `null` (no marker file), a
//             `{content, sha}` read (sha = the blob sha), or `{failure}`; any other shape, an
//             unreadable file or an unparseable one is exit 3, never absent and never a marker.
//             A write is captured, not made: stdout is
//             {"write":{"branch","path","content","sha"|null,"message"}} on exit 0, and the agent
//             makes that one contents-API PUT over MCP (sha = the lease; null creates). After a
//             rejected PUT the agent re-reads the file and re-runs `advance --after-conflict`:
//             a marker at or past --to is exit 0 at-or-past with no write, a vanished one is exit 4.
//
// The exit codes, the stdout shapes and the marker file are a stable contract: /release and
// _shared/release-state.md call them. Change them only by expand-contract. The vocabulary is the
// spec's own domain set, not one of the four base vocabularies in gh-api-module-pattern's
// cli-wrapper-contract.md.
'use strict';

const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const {
  parseRepo, gateOriginRepo, injectedGhDeps, pickInjected, ghOptions, remoteUrl,
  pinExplicitRepoHost, normalizeHost,
} = require('./lib/repo-resolve');
const { repoPinnedEnv } = require('./lib/hooks/git-exec');
const { resolveAgainst } = require('./lib/health-core/io');
const { isValidBranchName } = require('./lib/branch-name');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const { classifyGhApiError, ghErrorText, defaultSleep } = require('./lib/issues/claim-store');
const {
  RELEASE_STATE_BRANCH, classifyStateContent, isBareSlug, assertConditionalWrite, refuseInvalid,
} = require('./lib/release-state/store');
const {
  MARKER_FILE, SHA_RE, RUN_RE, REASON_RE, INIT_RUN, parseMarker, storeFacade,
  createLocalHistory, createCompareHistory, createHistory, advanceMarker, initMarker, resetMarker,
  resetMessageFits, recheckAfterConflict,
} = require('./lib/release-state/marker');

const NAME = 'release-state.js';
const EXIT = Object.freeze({
  OK: 0, REFUSED: 1, USAGE: 2, UNREADABLE: 3, CONTESTED: 4, INSUFFICIENT_HISTORY: 5, ORPHANED: 6,
});
// Each operation outcome (marker.js's OUTCOMES) -> its exit code.
const OUTCOME_EXIT = Object.freeze({
  ok: EXIT.OK,
  refused: EXIT.REFUSED,
  unreadable: EXIT.UNREADABLE,
  contested: EXIT.CONTESTED,
  'insufficient-history': EXIT.INSUFFICIENT_HISTORY,
  orphaned: EXIT.ORPHANED,
});

const USAGE = `usage: ${NAME} marker read [--repo [host/]owner/name | --marker-json <path>]\n`
  + `       ${NAME} marker advance --to <sha> --run <id> [--branch <name>] [--repo [host/]owner/name | --marker-json <path> [--after-conflict]]\n`
  + `       ${NAME} marker init --to <sha> [--branch <name>] [--repo [host/]owner/name | --emit]\n`
  + `       ${NAME} marker reset --to <sha> --run <id> [--force (--reason <text> | --reason-file <path>)] [--branch <name>] [--repo [host/]owner/name | --marker-json <path>]\n`
  + `       ${NAME} [--help]\n`
  + `  exit ${EXIT.OK} ok: one JSON line on stdout (a --marker-json or --emit write prints its write descriptor); --help prints this usage text instead\n`
  + `  exit ${EXIT.REFUSED} refused: the move is not allowed (no marker, a target off the first-parent line or behind the marker, a marker already exists)\n`
  + `  exit ${EXIT.USAGE} usage: a malformed invocation, or an unresolvable or refused repo\n`
  + `  exit ${EXIT.UNREADABLE} unreadable: the marker, the repo or the handoff file cannot be read, or a write failed for a non-contest reason\n`
  + `  exit ${EXIT.CONTESTED} contested: a competing writer changed the marker; read it again\n`
  + `  exit ${EXIT.INSUFFICIENT_HISTORY} insufficient-history: the first-parent history could not settle the question (a shallow clone, no local clone and no compare answer)\n`
  + `  exit ${EXIT.ORPHANED} orphaned: the marker is no longer on the integration branch's first-parent line (marker reset recovers)\n`;

const GH_ABSENT_HINT = 'gh not found — read over MCP and pass --marker-json (_shared/release-state.md)';
const BUDGET_NOTE = 'the 200-character commit-message budget';

// The value-taking flags and the boolean ones, then which each verb accepts.
const VALUE_FLAGS = Object.freeze({
  '--to': 'to', '--run': 'run', '--branch': 'branch', '--repo': 'repo', '--marker-json': 'markerJson', '--reason': 'reason', '--reason-file': 'reasonFile',
});
const BOOLEAN_FLAGS = Object.freeze({ '--force': 'force', '--emit': 'emit', '--after-conflict': 'afterConflict' });
const VERB_FLAGS = Object.freeze({
  read: ['--repo', '--marker-json'],
  advance: ['--to', '--run', '--branch', '--repo', '--marker-json', '--after-conflict'],
  init: ['--to', '--branch', '--repo', '--emit'],
  reset: ['--to', '--run', '--force', '--reason', '--reason-file', '--branch', '--repo', '--marker-json'],
});
const messageOf = (err) => (err && err.message ? err.message : String(err));
const oneLine = (text) => String(text || '').split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean).join('; ');

// A reset's reason rule and its composed commit message's budget -> an error text, or null.
// `source` names where the reason came from (`--reason`, or `--reason-file <path>`).
function resetReasonError({ run, force, reason }, source) {
  if (force && !REASON_RE.test(reason)) return `${source} must match ${REASON_RE} (one line of at most 200 characters, no "#")`;
  const fit = resetMessageFits({ run, force: Boolean(force), reason });
  if (!fit.fits) return `the reset commit message would be ${fit.length} characters, over ${BUDGET_NOTE} — shorten --run or ${source}`;
  return null;
}

// -> { help: true } | { error } | the parsed options. Pure: it reads nothing and calls nothing,
// so every usage failure here costs no gh or git call.
function parseArgs(argv) {
  const isHelp = (a) => a === '--help' || a === '-h';
  const [group, verb, ...rest] = argv;
  if (isHelp(group) || isHelp(verb)) return { help: true };
  if (group === undefined) return { error: 'a subcommand is required' };
  if (group !== 'marker') return { error: `unknown subcommand: ${group}` };
  if (verb === undefined) return { error: 'marker needs read, advance, init or reset' };
  if (!Object.hasOwn(VERB_FLAGS, verb)) return { error: `unknown marker subcommand: ${verb}` };
  const allowed = VERB_FLAGS[verb];
  const out = { verb };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    // Help only where a flag may stand: a value consumed by the flag before it is never help.
    if (isHelp(flag)) return { help: true };
    const isValue = Object.hasOwn(VALUE_FLAGS, flag);
    const isBoolean = Object.hasOwn(BOOLEAN_FLAGS, flag);
    if (!isValue && !isBoolean) return { error: `unknown argument: ${flag}` };
    if (!allowed.includes(flag)) return { error: `${flag} is not valid for marker ${verb}` };
    const key = isValue ? VALUE_FLAGS[flag] : BOOLEAN_FLAGS[flag];
    if (out[key] !== undefined) return { error: `${flag} given more than once` };
    if (isBoolean) { out[key] = true; continue; }
    const value = rest[++i];
    // A value-taking flag read past the end is undefined; a value that opens `-` is refused for
    // every flag, `--reason` included: an argv-level guard, like the run id's.
    if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) return { error: `${flag} requires a value` };
    out[key] = value;
  }
  if (out.markerJson !== undefined && out.repo !== undefined) return { error: '--marker-json and --repo are mutually exclusive' };
  if (out.emit && out.repo !== undefined) return { error: '--emit and --repo are mutually exclusive' };
  if (out.afterConflict && out.markerJson === undefined) return { error: '--after-conflict needs --marker-json (the emit path re-reads the marker the agent just fetched)' };
  if (verb !== 'read' && (out.to === undefined || !SHA_RE.test(out.to))) {
    return { error: '--to must be a 40-character lowercase hex commit sha' };
  }
  if (verb === 'advance' || verb === 'reset') {
    if (out.run === undefined) return { error: '--run is required' };
    if (!RUN_RE.test(out.run) || out.run === INIT_RUN) return { error: `--run must match ${RUN_RE} and is never "${INIT_RUN}"` };
  }
  if (out.branch !== undefined && !isValidBranchName(out.branch)) return { error: `--branch ${JSON.stringify(out.branch)} is not a valid branch name` };
  if (verb === 'reset') {
    if (out.reason !== undefined && out.reasonFile !== undefined) return { error: '--reason and --reason-file are mutually exclusive' };
    if (out.force && out.reason === undefined && out.reasonFile === undefined) return { error: '--force requires --reason or --reason-file' };
    if (!out.force && out.reason !== undefined) return { error: '--reason is only valid with --force' };
    if (!out.force && out.reasonFile !== undefined) return { error: '--reason-file is only valid with --force' };
    // --reason-file is read and validated in run(), where deps can read it.
    const invalid = out.reasonFile === undefined && resetReasonError(out, '--reason');
    if (invalid) return { error: invalid };
  }
  return { ...out, branch: out.branch === undefined ? 'main' : out.branch };
}

const realDeps = {
  cwd: () => process.cwd(),
  get env() { return process.env; },
  homeDir: () => os.homedir(),
  remoteUrl: ({ cwd, env } = {}) => remoteUrl({ cwd, env }),
  pinGhHost: (repoSpec, { env, cwd } = {}) => pinExplicitRepoHost(repoSpec, { env, cwd }),
  // Throwing. `{ cwd, env, stderr, homeDir }` is the injected process context.
  gh: (args, { cwd, env, stderr, homeDir } = {}) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES,
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
  }, injectedGhDeps({ env, stderr, homeDir }))),
  // Throwing; the store's gitRunner contract. The child's env is the injected one with the repo
  // pins stripped (a hook's GIT_DIR must not redirect it), `extraEnv` laid on top.
  git: (args, {
    cwd, env, input, extraEnv,
  } = {}) => execFileSync('git', args, {
    cwd,
    env: { ...repoPinnedEnv(env), ...extraEnv },
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES,
    windowsHide: true,
  }),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  now: () => new Date(),
  sleep: defaultSleep,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// One stderr line, `release-state.js: {outcome} — {reason}`, and the outcome's exit code. An
// outcome outside the table fails closed as unreadable.
function failure(deps, outcome, reason, { ghAbsent = false } = {}) {
  const known = Object.hasOwn(OUTCOME_EXIT, outcome) && outcome !== 'ok';
  const label = known ? outcome : 'unreadable';
  deps.stderr(`${NAME}: ${label} — ${oneLine(reason)}\n`);
  if (ghAbsent) deps.stderr(`${NAME}: ${GH_ABSENT_HINT}\n`);
  return known ? OUTCOME_EXIT[outcome] : EXIT.UNREADABLE;
}

const printLine = (deps, value) => { deps.stdout(`${JSON.stringify(value)}\n`); return EXIT.OK; };

// The exit-0 stdout shape of each verb's ok result.
function successLine(verb, r) {
  if (verb === 'advance') {
    return r.advanced ? { advanced: true, from: r.from, to: r.to } : { advanced: false, sha: r.sha, reason: r.reason };
  }
  if (verb === 'init') return { initialized: true, sha: r.sha };
  return {
    reset: true, from: r.from, to: r.to, basis: r.basis,
  };
}

// The marker file's read as a stdout line, or a failure. `read` is the store's answer.
function reportRead(deps, read, flags) {
  if (read.state === 'absent') return printLine(deps, { absent: true });
  if (read.state === 'unreadable') return failure(deps, 'unreadable', read.reason, flags);
  const parsed = parseMarker(read.value);
  if (parsed.error) return failure(deps, 'unreadable', parsed.error, flags);
  return printLine(deps, parsed.marker);
}

// Runs the verb over `wiring` ({ store, newHistory, now }); `captured` is the emit path's write slot.
// Every operation gets its own fresh history from `newHistory()`: a history refreshes its branch
// snapshot once, and an operation must start with that refresh unspent (marker.js's header), so
// no history is ever shared between two operations. A throw is a caller bug (every argument was
// validated before this point), reported as unreadable rather than left to exit 1, the code that
// means refused.
function runVerb(opts, deps, wiring, captured, flags) {
  const ctx = () => ({ store: wiring.store, history: wiring.newHistory(), now: wiring.now });
  let result;
  try {
    if (opts.verb === 'read') return reportRead(deps, wiring.store.read(), flags);
    if (opts.verb === 'advance') {
      // --after-conflict: the agent's PUT lost, and the handoff file is its re-read. Apply the same
      // at-or-past check advanceMarker runs after a lost write; otherwise advance as usual, on a
      // history of its own.
      result = (opts.afterConflict && recheckAfterConflict(ctx(), { to: opts.to }))
        || advanceMarker(ctx(), { to: opts.to, run: opts.run });
    } else if (opts.verb === 'init') {
      result = initMarker(ctx(), { to: opts.to });
    } else {
      result = resetMarker(ctx(), {
        to: opts.to, run: opts.run, force: Boolean(opts.force), reason: opts.reason,
      });
    }
  } catch (err) {
    return failure(deps, 'unreadable', messageOf(err), flags);
  }
  if (result.outcome !== 'ok') return failure(deps, result.outcome, result.reason, flags);
  if (captured && captured.write) return printLine(deps, { write: captured.write });
  return printLine(deps, successLine(opts.verb, result));
}

// ---- the gh path ----

// The origin remote, read once through deps.remoteUrl (the one origin read); null on a failure.
function readOrigin(deps) {
  try {
    return deps.remoteUrl({ cwd: deps.cwd(), env: deps.env });
  } catch {
    return null;
  }
}

// -> { spec } | { exit }. --repo wins and pins its host for every gh call; otherwise the gated
// origin. A refusal, no resolvable repo, or a malformed owner/repo is a usage failure.
function resolveRepoOrFail(opts, deps, gated) {
  let spec;
  if (opts.repo !== undefined) {
    spec = parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`);
  } else {
    if (gated.refusal) { deps.stderr(`${NAME}: ${gated.refusal}\n`); return { exit: EXIT.USAGE }; }
    spec = gated.spec;
  }
  if (!spec) { deps.stderr(`${NAME}: could not resolve owner/repo — pass --repo [host/]owner/name\n`); return { exit: EXIT.USAGE }; }
  // The store's own slug rule, so a slug it would reject is a usage failure here, not a TypeError.
  const ok = isBareSlug(`${spec.owner}/${spec.repo}`) && !spec.host.startsWith('-');
  if (!ok) { deps.stderr(`${NAME}: ${spec.host}/${spec.owner}/${spec.repo} is not a valid [host/]owner/name\n`); return { exit: EXIT.USAGE }; }
  if (opts.repo !== undefined) deps.pinGhHost(spec, { env: deps.env, cwd: deps.cwd() });
  return { spec };
}

const sameRepo = (a, b) => normalizeHost(a.host) === normalizeHost(b.host)
  && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();

// Whether the local clone may serve the target: it must sit inside a work tree and its gated
// origin must be the target itself. A typed --repo naming another repo gets no local history and
// no git call at all, so nothing can reach a different repo's `origin`.
function localClone(spec, gated, deps) {
  if (!gated.spec || !sameRepo(gated.spec, spec)) return false;
  try {
    return String(deps.git(['rev-parse', '--is-inside-work-tree'], { cwd: deps.cwd(), env: deps.env })).trim() === 'true';
  } catch {
    return false;
  }
}

// The never-throwing `gh api` adapter the store and the compare history take. Off github.com
// every call carries a trailing --hostname; a REST path keeps the bare slug. `state.ghAbsent`
// records a missing gh for the stderr hint.
function makeGhApi(deps, host, state) {
  const hostArgs = normalizeHost(host) === 'github.com' ? [] : ['--hostname', normalizeHost(host)];
  const context = {
    cwd: deps.cwd(), env: deps.env, stderr: deps.stderr, homeDir: deps.homeDir,
  };
  return (args) => {
    try {
      const out = deps.gh(['api', ...args, ...hostArgs], context);
      return { stdout: typeof out === 'string' ? out : String(out ?? ''), failure: null, status: null };
    } catch (e) {
      const { failure: kind, status } = classifyGhApiError(e);
      if (kind === 'gh-absent') state.ghAbsent = true;
      return {
        stdout: null, failure: kind, status, error: ghErrorText(e),
      };
    }
  };
}

function runGh(opts, deps) {
  const origin = readOrigin(deps);
  const gated = gateOriginRepo(origin, injectedGhDeps(pickInjected(deps)));
  const resolved = resolveRepoOrFail(opts, deps, gated);
  if (resolved.exit !== undefined) return resolved.exit;
  const { spec } = resolved;
  const slug = `${spec.owner}/${spec.repo}`;
  const state = { ghAbsent: false };
  const ghApi = makeGhApi(deps, spec.host, state);
  const useLocal = localClone(spec, gated, deps);
  const gitRunner = useLocal
    ? (args, { input, extraEnv } = {}) => deps.git(args, {
      cwd: deps.cwd(), env: deps.env, input, extraEnv,
    })
    : undefined;
  const storeDeps = { ghApi, sleep: deps.sleep, ...(gitRunner ? { gitRunner } : {}) };
  const newHistory = () => createHistory({
    ...(gitRunner ? { local: createLocalHistory({ git: gitRunner, branch: opts.branch }) } : {}),
    compare: createCompareHistory({ ghApi, slug, branch: opts.branch }),
  });
  const wiring = { store: storeFacade(storeDeps, slug), newHistory, now: deps.now };
  return runVerb(opts, deps, wiring, null, { get ghAbsent() { return state.ghAbsent; } });
}

// ---- the emit path ----

// The agent's handoff file -> { file: null | { content, sha } } | { error }. Every shape other
// than `null` (no marker file) and a well-formed `{content, sha}` read is an error, never absent.
function loadHandoff(opts, deps) {
  const asTyped = opts.markerJson;
  const resolved = resolveAgainst(deps.cwd(), asTyped);
  let text;
  try {
    text = String(deps.readFile(resolved));
  } catch (err) {
    return { error: `could not read ${asTyped} (${messageOf(err).split(resolved).join(asTyped)})` };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { error: `${asTyped} is not valid JSON (${messageOf(err)})` };
  }
  if (value === null) return { file: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { error: `${asTyped} is not null, a {content, sha} read or a {failure}` };
  if (Object.hasOwn(value, 'failure')) {
    return { error: `the MCP read recorded in ${asTyped} failed${typeof value.failure === 'string' ? ` (${value.failure})` : ''}` };
  }
  if (typeof value.content !== 'string' || typeof value.sha !== 'string' || !SHA_RE.test(value.sha)) {
    return { error: `${asTyped} is not null, a {content, sha} read (sha 40 lowercase hex) or a {failure}` };
  }
  return { file: { content: value.content, sha: value.sha } };
}

// The store the emit path hands the operations: reads come from the handoff file, classified
// exactly as the contents-API leg classifies them (so a malformed marker keeps its content and
// lease, and a forced reset can overwrite it); writes are captured, not made. It accepts the
// call shapes writeStateFile and createStateFile accept, and checks them with the store's own
// validators (assertConditionalWrite, refuseInvalid), so the write rules live in one place.
function emitStore(file, captured) {
  const capture = (content, sha, message) => {
    captured.write = {
      branch: RELEASE_STATE_BRANCH, path: MARKER_FILE, content, sha, message,
    };
  };
  return {
    read: () => (file === null
      ? {
        state: 'absent', lease: null, via: 'contents-api', branchMissing: false,
      }
      : classifyStateContent(file.content, { lease: file.sha, via: 'contents-api' })),
    write: ({
      content, lease, via, expectedContent, message,
    } = {}) => {
      assertConditionalWrite({ lease, via, expectedContent }, ['contents-api']);
      const refused = refuseInvalid(content, message);
      if (refused) return refused;
      capture(content, lease, message);
      return { ok: true, via: 'contents-api' };
    },
    create: ({ content, message } = {}) => {
      const refused = refuseInvalid(content, message);
      if (refused) return refused;
      capture(content, null, message);
      return { ok: true, created: true, via: 'contents-api' };
    },
  };
}

function runEmit(opts, deps) {
  let file = null;
  if (opts.markerJson !== undefined) {
    const loaded = loadHandoff(opts, deps);
    if (loaded.error) return failure(deps, 'unreadable', loaded.error);
    ({ file } = loaded);
  }
  const captured = { write: null };
  const gitRunner = (args, { input, extraEnv } = {}) => deps.git(args, {
    cwd: deps.cwd(), env: deps.env, input, extraEnv,
  });
  const wiring = {
    store: emitStore(file, captured),
    newHistory: () => createHistory({ local: createLocalHistory({ git: gitRunner, branch: opts.branch }) }),
    now: deps.now,
  };
  return runVerb(opts, deps, wiring, captured, {});
}

// The reason text from --reason-file: a skill writes the operator's free text to a file so no
// shell ever expands it (docs/skill-authoring.md's "Untrusted text into a shell or paste command").
// One trailing line break is the file's, not the reason's; the rest meets every rule --reason
// meets, the argv guard (not blank, no leading `-`) included. -> { reason } | { error }.
function readReasonFile(opts, deps) {
  const source = `--reason-file ${opts.reasonFile}`;
  let text;
  try {
    text = String(deps.readFile(resolveAgainst(deps.cwd(), opts.reasonFile)));
  } catch (err) {
    return { error: `could not read ${source} (${messageOf(err)})` };
  }
  const reason = text.replace(/\r?\n$/, '');
  if (!reason.trim() || reason.startsWith('-')) return { error: `${source} must hold a reason that is not blank and does not start with "-"` };
  const invalid = resetReasonError({ ...opts, reason }, source);
  return invalid ? { error: invalid } : { reason };
}

function run(argv, deps) {
  let opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return EXIT.OK; }
  if (opts.error) { deps.stderr(`${NAME}: ${opts.error}\n${USAGE}`); return EXIT.USAGE; }
  // Read the working directory once, inside a try: process.cwd() throws when it was deleted, and
  // an uncaught throw exits 1, the code that means refused. Every later deps.cwd() reuses it.
  let cwd;
  try {
    cwd = deps.cwd();
  } catch (err) {
    return failure(deps, 'unreadable', `working directory unavailable (${messageOf(err)})`);
  }
  const pinned = { ...deps, cwd: () => cwd };
  if (opts.reasonFile !== undefined) {
    const read = readReasonFile(opts, pinned);
    if (read.error) { deps.stderr(`${NAME}: ${read.error}\n${USAGE}`); return EXIT.USAGE; }
    opts = { ...opts, reason: read.reason };
  }
  return opts.markerJson !== undefined || opts.emit ? runEmit(opts, pinned) : runGh(opts, pinned);
}

module.exports = {
  run, realDeps, parseArgs, EXIT, OUTCOME_EXIT, USAGE,
};

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
