#!/usr/bin/env node
// bin/planning-hold.js — does `/claude-tweaks:specify`'s planning step hold this record? (#6059)
//   node bin/planning-hold.js --comments-file <file> [--help]
//   node bin/planning-hold.js readback --record <n> --branch <answered|kept|re-held>
//     --readback-file <f> --body-file <f> [--labels-file <f>] --plan-line-file <f>
//     --plan-check-file <f> --resolved-ids <id[,id…]> --answered <k>
//     [--other-unresolved <m>] [--reheld-file <f>]   (#6100)
// A thin shell over bin/lib/issues/planning-hold.js's readPlanningHold: no selection or parse
// logic lives here. <file> is `gh issue view {n} --json comments` output (`{comments: [...]}`)
// or an MCP `get_comments` array.
// Stdout (exit 0, whatever the verdict): one JSON line, readPlanningHold's result —
// {verdict, reason, comment, otherUnresolved, supersededHolds, questions, skipped}
// (otherUnresolved and supersededHolds: see the lib module's header). --help or -h anywhere in
// argv prints usage and exits 0, ahead of every other argv check.
// The readback verb (argv[0] === 'readback') wraps readBack from the same lib module: it loads the
// re-fetched record state from files (--readback-file is `gh issue view {n} --json labels,body,comments`
// output or an MCP comments array; --labels-file, when given, wins over its labels; --plan-check-file
// is plan-store check's output, and an unreadable/empty/non-JSON one is a failed plan-check assertion,
// not exit 1) and prints one JSON line, readBack's {ok, branch, assertions, failed, outcome, next},
// exit 0 even when an assertion failed. --other-unresolved is required on answered and refused
// elsewhere; --reheld-file (a JSON array of question strings) likewise on re-held.
// Exit vocabulary follows bin/find-run-comment.js. Bare form: 0 = answered (held or not); 1 = payload
// failure, the file unreadable, not JSON, or not one of the two shapes; 2 = invocation
// failure, a malformed argv (unknown flag, missing or repeated value). Readback: 0 = the verdict was
// printed (pass or fail); 1 = a payload failure or the `readback failed:` catch-all; 2 = malformed argv. A relative path resolves
// against the injected cwd. The entry contract is
// .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md.
'use strict';

const fs = require('fs');
const { readPlanningHold, readBack, READBACK_BRANCHES } = require('./lib/issues/planning-hold');
const { resolveAgainst } = require('./lib/health-core/io');

const READBACK_USAGE = 'planning-hold.js readback --record <n> --branch <answered|kept|re-held> --readback-file <f> --body-file <f> [--labels-file <f>] --plan-line-file <f> --plan-check-file <f> --resolved-ids <id[,id…]> --answered <k> [--other-unresolved <m>] [--reheld-file <f>]';
const USAGE = `usage: planning-hold.js --comments-file <file> [--help]\n       ${READBACK_USAGE}\n`;

const READBACK_FLAGS = new Set([
  '--record', '--branch', '--readback-file', '--body-file', '--labels-file', '--plan-line-file',
  '--plan-check-file', '--resolved-ids', '--answered', '--other-unresolved', '--reheld-file',
]);
const READBACK_REQUIRED = ['--record', '--branch', '--readback-file', '--body-file', '--plan-line-file', '--plan-check-file', '--resolved-ids', '--answered'];
const isCountText = (v) => /^(0|[1-9][0-9]*)$/.test(v);

// -> { flags: Map<flag, value> } or { error }.
function parseReadbackArgs(argv) {
  const flags = new Map();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!READBACK_FLAGS.has(a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    if (flags.has(a)) return { error: `${a} given more than once` };
    flags.set(a, v);
    i++;
  }
  for (const f of READBACK_REQUIRED) if (!flags.has(f)) return { error: `${f} is required` };
  const branch = flags.get('--branch');
  if (!READBACK_BRANCHES.includes(branch)) return { error: `--branch must be one of ${READBACK_BRANCHES.join(', ')}` };
  if (!isCountText(flags.get('--record')) || Number(flags.get('--record')) === 0) return { error: '--record must be a positive integer' };
  if (!isCountText(flags.get('--answered'))) return { error: '--answered must be a non-negative integer' };
  if (flags.get('--resolved-ids').split(',').some((id) => id === '')) return { error: '--resolved-ids has an empty element' };
  if (flags.has('--other-unresolved')) {
    if (branch !== 'answered') return { error: '--other-unresolved is allowed only with --branch answered' };
    if (!isCountText(flags.get('--other-unresolved'))) return { error: '--other-unresolved must be a non-negative integer' };
  } else if (branch === 'answered') return { error: '--other-unresolved is required with --branch answered' };
  if (flags.has('--reheld-file') && branch !== 're-held') return { error: '--reheld-file is allowed only with --branch re-held' };
  if (!flags.has('--reheld-file') && branch === 're-held') return { error: '--reheld-file is required with --branch re-held' };
  return { flags };
}

function parseArgs(argv) {
  if (argv.some((a) => a === '--help' || a === '-h')) return { help: true, commentsFile: null };
  const o = { help: false, commentsFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== '--comments-file') return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    if (o.commentsFile !== null) return { error: `${a} given more than once` };
    o.commentsFile = v;
    i++;
  }
  return o;
}

function commentList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload !== null && typeof payload === 'object' && Array.isArray(payload.comments)) return payload.comments;
  return null;
}

// Payload failure (exit 1) for a flag's file, naming the argument spelling as typed.
class PayloadError extends Error {}
const payloadFail = (flag, file, why) => new PayloadError(`could not read or parse ${flag}: ${file} (${why})`);

function runReadback(flags, deps) {
  const file = (flag) => flags.get(flag);
  const load = (flag) => {
    try { return deps.readFile(resolveAgainst(deps.cwd(), file(flag))); } catch (err) { throw payloadFail(flag, file(flag), err && err.message); }
  };
  const loadJson = (flag) => {
    const text = load(flag);
    try { return JSON.parse(text); } catch (err) { throw payloadFail(flag, file(flag), err && err.message); }
  };
  const names = (flag, list) => list.map((l) => {
    if (typeof l === 'string') return l;
    if (l !== null && typeof l === 'object' && typeof l.name === 'string') return l.name;
    throw payloadFail(flag, file(flag), 'a label is neither a string nor an object with a string name');
  });
  try {
    const rb = loadJson('--readback-file');
    const comments = commentList(rb);
    if (comments === null) throw payloadFail('--readback-file', file('--readback-file'), 'neither a comments array nor an object with a comments array');
    const body = load('--body-file');
    const planLine = load('--plan-line-file').replace(/[\r\n]+$/, '');
    if (planLine === '') throw payloadFail('--plan-line-file', file('--plan-line-file'), 'empty');
    let labels;
    if (flags.has('--labels-file')) {
      const l = loadJson('--labels-file');
      if (!Array.isArray(l)) throw payloadFail('--labels-file', file('--labels-file'), 'not an array');
      labels = names('--labels-file', l);
    } else if (rb !== null && !Array.isArray(rb) && Array.isArray(rb.labels)) {
      labels = names('--readback-file', rb.labels);
    } else {
      throw new PayloadError('no labels: pass --labels-file or a --readback-file object with a labels array');
    }
    // Deliberately not exit 1: plan-store check treats an undeterminable read as invalid, so an
    // unreadable, empty or non-JSON plan-check file becomes a failed plan-check assertion.
    let planCheck = null;
    try { planCheck = JSON.parse(load('--plan-check-file')); } catch { planCheck = null; }
    const input = {
      record: Number(file('--record')), branch: file('--branch'), labels, body, comments, planLine, planCheck,
      resolvedIds: file('--resolved-ids').split(','), answered: Number(file('--answered')),
    };
    if (flags.has('--other-unresolved')) input.otherUnresolved = Number(file('--other-unresolved'));
    if (flags.has('--reheld-file')) {
      const q = loadJson('--reheld-file');
      if (!Array.isArray(q) || !q.every((x) => typeof x === 'string')) throw payloadFail('--reheld-file', file('--reheld-file'), 'not an array of strings');
      input.reheldQuestions = q;
    }
    deps.stdout(`${JSON.stringify(readBack(input))}\n`);
    return 0;
  } catch (err) {
    deps.stderr(err instanceof PayloadError ? `planning-hold.js: ${err.message}\n` : `planning-hold.js: readback failed: ${err && err.message}\n`);
    return 1;
  }
}

function run(argv, deps = realDeps) {
  const usageError = (message) => { deps.stderr(`planning-hold.js: ${message}\n${USAGE}`); return 2; };
  if (argv[0] === 'readback') {
    if (argv.some((a) => a === '--help' || a === '-h')) { deps.stdout(USAGE); return 0; }
    const r = parseReadbackArgs(argv);
    return r.error ? usageError(r.error) : runReadback(r.flags, deps);
  }
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.commentsFile === null) return usageError('--comments-file is required');

  let payload;
  try {
    payload = JSON.parse(deps.readFile(resolveAgainst(deps.cwd(), o.commentsFile)));
  } catch (err) {
    deps.stderr(`planning-hold.js: could not read or parse --comments-file: ${o.commentsFile} (${err && err.message})\n`);
    return 1;
  }
  const comments = commentList(payload);
  if (comments === null) {
    deps.stderr(`planning-hold.js: --comments-file ${o.commentsFile} is not a comments list\n`);
    return 1;
  }
  deps.stdout(`${JSON.stringify(readPlanningHold(comments))}\n`);
  return 0;
}

const realDeps = {
  cwd: () => process.cwd(),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
