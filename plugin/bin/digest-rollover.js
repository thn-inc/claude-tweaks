#!/usr/bin/env node
// bin/digest-rollover.js — the reads behind a digest container rollover (#4848). The sweep
// (tidy/digest-sweep.md), Shape 1 (tidy/step-1-records.md) and the bare drain
// (specify/next-mode.md) call it, so none of them restates the fetch or the planner call. The
// decisions stay in lib/health-core/materiality-digest.js, which stays pure: this file reads,
// calls classifyRolloverResume or planCarryOver, writes the bodies to post, and prints.
//
// Usage:
//   digest-rollover.js verdict --old <n> --candidates <n>[,<n>...]
//   digest-rollover.js verdict --old-json <path> --candidates-json <path>
//   digest-rollover.js carry --old <n> --new <n>
//   digest-rollover.js carry --old <n> --new <n> --count <n> --old-json <path> --new-json <path>
//   digest-rollover.js --help
// The first form of each verb reads through `gh` from the cwd's repo: the verdict through REST
// (`gh api repos/{owner}/{repo}/issues/{n}`, the read carrying the author association), the carry
// through the paginated `gh issue view {n} --json comments --jq .comments` and the true count from
// REST `.comments`. The second form is the gh-absent path: a Node subprocess cannot call MCP, so
// the agent writes what it fetched and this CLI makes zero `gh` calls and no `gh` probe.
//   --old-json         verdict: the old issue, one object. carry: its comments, one flat array.
//   --candidates-json  every issue naming the old one, one flat array of issue objects.
//   --new-json         the replacement's comments, one flat array.
//   --count            the old issue's true comment count.
// Each entry is shape-checked by the planner, so an MCP error written as data is a refused read.
//
// Output: one JSON line at exit 0.
//   verdict: { state, replacement, extras } and, on `none` only, `orphan` when a trusted open
//     replacement of a closed old issue is there (classifyRolloverResume).
//   carry: { old, replacement, count, live, carried, pending, tombstones, tombstonesCarried,
//     tombstonesPending, unfingerprintedMarked, verified, skipped, paths, edits }. paths are the
//     comment bodies to post, edits the { commentId, path } marker edits to apply. A true count of
//     0 with an empty read prints `empty: true`, `verified: true` and nothing to post: the planner
//     refuses an empty read, so a truncated read can never pass as an empty issue.
// The bodies land in the session's temp root, under digest-carry-{old}/, created or overwritten
// with no lock. A second run for one old issue replaces them; only the printed paths count.
//
// Exit codes (Split-1/2):
//   1  malformed invocation; usage on stderr.
//   2  a `gh` form with `gh` absent, and only that, so a caller routes it to the file form.
//   3  a read was refused or failed: a `gh` call, an unreadable or unparseable file, a shape or
//      count the planner refuses, or a body that could not be written. Nothing on stdout. A file
//      problem shares this code, unlike materialize.js's exit 2, because its recovery is the same
//      as a failed `gh` read: read again and re-run.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  CarryOverInputError, classifyRolloverResume, planCarryOver,
} = require('./lib/health-core/materiality-digest');
const { ghAvailable, ghOptions } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const { resolvePrinted } = require('./session-tmp-resolve');

const USAGE = `usage: digest-rollover.js verdict --old <n> --candidates <n>[,<n>...]
       digest-rollover.js verdict --old-json <path> --candidates-json <path>
       digest-rollover.js carry --old <n> --new <n>
       digest-rollover.js carry --old <n> --new <n> --count <n> --old-json <path> --new-json <path>
exit: 0 printed, 1 malformed invocation, 2 gh absent (use the file form), 3 a read refused or failed
`;

const VERB_FLAGS = {
  verdict: ['--old', '--candidates', '--old-json', '--candidates-json'],
  carry: ['--old', '--new', '--count', '--old-json', '--new-json'],
};
const POSITIVE = /^[1-9]\d*$/;
const NUMBER_FLAGS = new Set(['--old', '--new']);
// A paged comment read of a full digest walks several pages, so it earns more than a single call's bound.
const PAGED_READ_TIMEOUT_MS = 30000;

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [verb, ...rest] = argv;
  if (!Object.hasOwn(VERB_FLAGS, verb || '')) return { error: `expected a verb, verdict or carry: ${String(verb)}` };
  const o = { verb };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!VERB_FLAGS[verb].includes(flag)) return { error: `unknown argument for ${verb}: ${flag}` };
    const value = rest[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) return { error: `${flag} requires a value` };
    if (NUMBER_FLAGS.has(flag) && !POSITIVE.test(value)) return { error: `${flag} requires a positive integer` };
    if (flag === '--count' && !/^\d+$/.test(value)) return { error: '--count requires a non-negative integer' };
    if (flag === '--candidates' && !value.split(',').every((n) => POSITIVE.test(n))) return { error: '--candidates requires positive integers, comma-separated' };
    o[flag.slice(2)] = value;
  }
  const has = (...keys) => keys.map((k) => o[k] !== undefined);
  const all = (flags) => flags.every(Boolean);
  const any = (flags) => flags.some(Boolean);
  if (verb === 'verdict') {
    const ghForm = has('old', 'candidates');
    const fileForm = has('old-json', 'candidates-json');
    const ghOnly = all(ghForm) && !any(fileForm);
    const fileOnly = all(fileForm) && !any(ghForm);
    if (!ghOnly && !fileOnly) {
      return { error: 'verdict takes either --old with --candidates, or --old-json with --candidates-json' };
    }
    o.fileForm = fileOnly;
  } else {
    if (!all(has('old', 'new'))) return { error: 'carry requires --old and --new' };
    if (o.old === o.new) return { error: '--old and --new name the same issue' };
    const fileForm = has('count', 'old-json', 'new-json');
    if (any(fileForm) && !all(fileForm)) return { error: '--count, --old-json and --new-json go together' };
    o.fileForm = all(fileForm);
  }
  return o;
}

function defaultGh(args) {
  return execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: Math.max(GH_TIMEOUT_MS, PAGED_READ_TIMEOUT_MS),
    maxBuffer: LARGE_MAX_BUFFER_BYTES,
    windowsHide: true,
  }));
}

const realDeps = {
  ghAvailable,
  gh: defaultGh,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  carryDir: (old) => resolvePrinted(`digest-carry-${old}`),
  writeFile: (p, body) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// A read that failed: mapped to exit 3. Anything else that throws is a bug and stays loud.
class ReadRefused extends Error {}

function attempt(what, fn) {
  try {
    return fn();
  } catch (e) {
    throw new ReadRefused(`${what}: ${String((e && (e.stderr || e.message)) || e).trim()}`);
  }
}

const parseJson = (what, text) => attempt(what, () => JSON.parse(text));
const readJsonFile = (deps, file) => parseJson(file, attempt(file, () => deps.readFile(file)));
const readIssue = (deps, n) => parseJson(
  `issue #${n}`,
  attempt(`issue #${n}`, () => deps.gh(['api', `repos/{owner}/{repo}/issues/${n}`])),
);
const readComments = (deps, n) => parseJson(
  `issue #${n} comments`,
  attempt(`issue #${n} comments`, () => deps.gh(['issue', 'view', n, '--json', 'comments', '--jq', '.comments'])),
);

function readTrueCount(deps, n) {
  const text = attempt(`issue #${n} count`, () => deps.gh(['api', `repos/{owner}/{repo}/issues/${n}`, '--jq', '.comments'])).trim();
  if (!/^\d+$/.test(text)) throw new ReadRefused(`issue #${n} count: not a number: ${text.slice(0, 80)}`);
  return Number(text);
}

function runVerdict(opts, deps) {
  let candidates;
  let old;
  if (opts.fileForm) {
    old = readJsonFile(deps, opts['old-json']);
    candidates = readJsonFile(deps, opts['candidates-json']);
  } else {
    old = readIssue(deps, opts.old);
    candidates = [...new Set(opts.candidates.split(','))].map((n) => readIssue(deps, n));
  }
  deps.stdout(`${JSON.stringify(classifyRolloverResume(candidates, old))}\n`);
  return 0;
}

const EMPTY_PLAN = {
  live: 0,
  carried: 0,
  pending: 0,
  tombstones: 0,
  tombstonesCarried: 0,
  tombstonesPending: 0,
  unfingerprintedMarked: 0,
  verified: true,
  skipped: [],
  paths: [],
  edits: [],
};

function runCarry(opts, deps) {
  const old = Number(opts.old);
  const replacement = Number(opts.new);
  // The count first: an append between the two reads makes the array longer than the count, which
  // the planner refuses, so it can never hide behind a matching pair.
  const count = opts.fileForm ? Number(opts.count) : readTrueCount(deps, opts.old);
  const oldComments = opts.fileForm ? readJsonFile(deps, opts['old-json']) : readComments(deps, opts.old);
  if (count === 0 && Array.isArray(oldComments) && oldComments.length === 0) {
    deps.stdout(`${JSON.stringify({ old, replacement, count, empty: true, ...EMPTY_PLAN })}\n`);
    return 0;
  }
  const newComments = opts.fileForm ? readJsonFile(deps, opts['new-json']) : readComments(deps, opts.new);
  const plan = planCarryOver(oldComments, newComments, { oldCommentCount: count });
  const dir = attempt('carry directory', () => deps.carryDir(old));
  const write = (name, body) => {
    const file = `${dir}/${name}`;
    attempt(`writing ${file}`, () => deps.writeFile(file, body));
    return file;
  };
  const paths = plan.bodies.map((b, k) => write(`carry-${k}.md`, b));
  const edits = plan.markerEdits.map((e, k) => ({ commentId: e.commentId, path: write(`edit-${k}.md`, e.body) }));
  deps.stdout(`${JSON.stringify({
    old,
    replacement,
    count,
    live: plan.live,
    carried: plan.carried,
    pending: plan.pending.length,
    tombstones: plan.tombstones,
    tombstonesCarried: plan.tombstonesCarried,
    tombstonesPending: plan.tombstonesPending.length,
    unfingerprintedMarked: plan.unfingerprintedMarked,
    verified: plan.verified,
    skipped: plan.skipped,
    paths,
    edits,
  })}\n`);
  return 0;
}

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (opts.error) { deps.stderr(`digest-rollover.js: ${opts.error}\n${USAGE}`); return 1; }
  if (!opts.fileForm) {
    let available = false;
    try { available = deps.ghAvailable(); } catch { /* a probe that throws reads as absent */ }
    if (!available) {
      deps.stderr('digest-rollover.js: gh CLI not found on PATH — fetch through MCP and use the file form\n');
      return 2;
    }
  }
  try {
    return opts.verb === 'verdict' ? runVerdict(opts, deps) : runCarry(opts, deps);
  } catch (e) {
    if (!(e instanceof ReadRefused) && !(e instanceof CarryOverInputError)) throw e;
    deps.stderr(`digest-rollover.js: refused — ${e.message}\n`);
    return 3;
  }
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
