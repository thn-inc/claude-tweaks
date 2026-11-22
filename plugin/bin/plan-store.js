#!/usr/bin/env node
// bin/plan-store.js — store a reviewed plan on a hidden ref and check it is still valid (#6052).
//   node bin/plan-store.js write --record <n> --plan-file <f> --base <sha> --spec-file <f>
//   node bin/plan-store.js read  --record <n> --commit <sha> --out <dir>
//   node bin/plan-store.js check (--line <Plan: line> | --line-file <f>) --spec-file <f> --base <sha> [--repo-root <dir>]
// --line-file reads the line from a file (one trailing newline dropped), so a line copied from an
// editable record body never reaches a shell command line (#6056).
// A plan lives on `refs/claude-tweaks/plans/{n}` (ref.js owns the name; this file re-exports it for
// #6055). The CLI is a thin shell over plugin/bin/lib/plan-store/ (store.js write/read, check.js) and
// plugin/bin/lib/issues/plan-line.js (the `Plan:` line and the spec hash).
// Transport: the git root is `rev-parse --show-toplevel` of the root (--repo-root, else the cwd).
// write pushes and read/check fetch unless that root's CLAUDE.md says `work-backend: local-files`,
// where the ref stays local (a reader in another clone then gets `failed: ref`, by design).
// Stdout, one JSON line: write {ref, commit, specHash, line}; read {path}; check {valid, failed}.
// `read` creates --out and writes the plan file there, create-or-overwrite, with no lock.
// Exit family: Payload-1/Invocation-2 plus one CLI-own code (cli-wrapper-contract.md).
//   0 success. 1 the invocation was well-formed but its inputs do not hold (an unreadable file, a spec
//   with no `## Overview`, an unresolvable --base on write, a ref that is missing or names another
//   commit on read, an invalid verdict on check). 2 malformed invocation (an exit-2 check still prints
//   `valid: false`, naming the first check the malformed input prevents). 3 EXIT_NO_REF (write only):
//   the ref could not be created or pushed, or the lease was lost, so the caller writes no `Plan:` line.
// A push that succeeds followed by a failed local `update-ref` is exit 0 with a stderr warning: the
// remote ref is the store.
'use strict';

const fs = require('fs');
const path = require('path');
const { PLAN_REF_PREFIX, parsePlanRefName } = require('./lib/plan-store/ref');
const { makeGit, defaultGit } = require('./lib/plan-store/git');
const { writePlan, readPlan } = require('./lib/plan-store/store');
const { checkPlan, CHECK_ORDER } = require('./lib/plan-store/check');
const { composePlanLine, parsePlanLine, specHash, COMMIT_RE } = require('./lib/issues/plan-line');
const { readWorkBackend } = require('./lib/work-backend');
const { fsPath } = require('./lib/health-core/io');

const EXIT_NO_REF = 3;
const NAME = 'plan-store.js';

const USAGE = [
  `usage: ${NAME} write --record <n> --plan-file <f> --base <sha> --spec-file <f>`,
  `       ${NAME} read  --record <n> --commit <sha> --out <dir>`,
  `       ${NAME} check (--line <Plan: line> | --line-file <f>) --spec-file <f> --base <sha> [--repo-root <dir>]`,
  `       ${NAME} --help`,
  `The plan lives on ${PLAN_REF_PREFIX}{n}. stdout is one JSON line: write {ref, commit, specHash, line};`,
  'read {path}; check {valid, failed} (failed is one of ref, hash, base, files, or null).',
  'exit codes:',
  '  0  success (check: valid)',
  '  1  well-formed invocation, inputs do not hold (unreadable file, spec with no Overview, unresolvable base, plan already on the base,',
  '     ref missing or naming another commit on read, invalid check verdict)',
  '  2  malformed invocation (check still prints valid: false)',
  '  3  no-ref (write only): the ref could not be created or pushed, or the lease was lost; no Plan: line is printed',
  '',
].join('\n');

const FLAGS = {
  write: { '--record': 'record', '--plan-file': 'planFile', '--base': 'base', '--spec-file': 'specFile' },
  read: { '--record': 'record', '--commit': 'commit', '--out': 'out' },
  check: { '--line': 'line', '--line-file': 'lineFile', '--spec-file': 'specFile', '--base': 'base', '--repo-root': 'repoRoot' },
};
// check also needs exactly one of --line and --line-file (parseArgs).
const REQUIRED = {
  write: ['record', 'planFile', 'base', 'specFile'],
  read: ['record', 'commit', 'out'],
  check: ['specFile', 'base'],
};
// The check each check flag feeds, for an exit-2 verdict: the --line (or --line-file) is the ref's
// input, the spec the hash's, the base the base's. Anything else (an unknown flag, --repo-root)
// prevents every check.
const CHECK_OF = { line: 'ref', lineFile: 'ref', specFile: 'hash', base: 'base', repoRoot: 'ref' };
const RECORD_RE = /^[1-9]\d*$/;

// Errors are {msg, check}; `check` names the first-failing check a malformed check invocation prevents.
function parseArgs(argv) {
  const o = { help: false, verb: null, values: {}, errors: [] };
  const err = (msg, check) => o.errors.push({ msg, check: check || 'ref' });
  if (argv.includes('--help') || argv.includes('-h')) { o.help = true; return o; }
  if (argv.length === 0 || argv[0].startsWith('-')) { err('a verb is required: write, read or check'); return o; }
  o.verb = argv[0];
  if (!Object.hasOwn(FLAGS, o.verb)) { err(`unknown verb: ${o.verb}`); return o; }
  const table = FLAGS[o.verb];
  const flagged = new Set(); // keys whose flag already has an error: not also reported missing
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!Object.hasOwn(table, a)) { err(`unknown argument: ${a}`); continue; }
    const key = table[a];
    const v = argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('-')) { flagged.add(key); err(`${a} needs a value`, CHECK_OF[key]); continue; }
    i++;
    if (Object.hasOwn(o.values, key)) { err(`${a} given more than once`, CHECK_OF[key]); continue; }
    o.values[key] = v;
  }
  for (const key of REQUIRED[o.verb]) {
    if (!Object.hasOwn(o.values, key) && !flagged.has(key)) {
      const flag = Object.keys(table).find((f) => table[f] === key);
      err(`${flag} is required`, CHECK_OF[key]);
    }
  }
  if (o.verb === 'check') {
    const given = ['line', 'lineFile'].filter((k) => Object.hasOwn(o.values, k) || flagged.has(k));
    if (given.length === 0) err('--line or --line-file is required', 'ref');
    if (given.length === 2) err('--line and --line-file are mutually exclusive', 'ref');
  }
  const { record, commit } = o.values;
  if (record !== undefined && !RECORD_RE.test(record)) err(`--record must be a positive integer, got: ${record}`);
  if (commit !== undefined && !COMMIT_RE.test(commit)) err(`--commit must be 40 or 64 lowercase hex, got: ${commit}`);
  return o;
}

// stdout, stderr, cwd and env are the process; git is the one runner (plan-store/git.js's defaultGit).
const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  env: process.env,
  git: defaultGit,
};

const detail = (err) => (err && err.message) || String(err);

// The git root of `getRoot()` and the transport choice read from its CLAUDE.md, or {error}. The getter
// runs inside the try: a deleted working directory is an {error}, never a throw out of `run`.
function openRepo(deps, getRoot) {
  try {
    const root = getRoot();
    const top = String(makeGit({ git: deps.git, root, env: deps.env })(['rev-parse', '--show-toplevel'])).trim();
    if (!top) return { error: 'git rev-parse --show-toplevel printed nothing' };
    const push = readWorkBackend(top) !== 'local-files';
    return { g: makeGit({ git: deps.git, root: top, env: deps.env }), push };
  } catch (err) {
    const stderr = err && err.stderr != null ? String(err.stderr).trim() : '';
    return { error: stderr || detail(err) };
  }
}

function runWrite(v, deps) {
  const fail = (code, msg) => { deps.stderr(`${NAME}: ${msg}\n`); return code; };
  let planBytes;
  let spec;
  try { planBytes = fs.readFileSync(fsPath(deps, v.planFile)); } catch (err) {
    return fail(1, `could not read --plan-file ${v.planFile}: ${detail(err)}`);
  }
  try { spec = fs.readFileSync(fsPath(deps, v.specFile), 'utf8'); } catch (err) {
    return fail(1, `could not read --spec-file ${v.specFile}: ${detail(err)}`);
  }
  let hash;
  try { hash = specHash(spec); } catch (err) { return fail(1, `--spec-file ${v.specFile}: ${detail(err)}`); }
  const repo = openRepo(deps, () => deps.cwd());
  if (repo.error) return fail(EXIT_NO_REF, `not a usable git repository: ${repo.error}`);
  const record = Number(v.record);
  const res = writePlan({ g: repo.g, push: repo.push, record, basename: path.basename(v.planFile), planBytes, base: v.base });
  if (!res.ok) return fail(res.kind === 'invalid' ? 1 : EXIT_NO_REF, res.reason);
  if (res.localRefUpdated === false) {
    deps.stderr(`${NAME}: warning: local ref ${res.ref} was not updated (the pushed ref is the store): ${res.localRefReason}\n`);
  }
  deps.stdout(`${JSON.stringify({ ref: res.ref, commit: res.commit, specHash: hash, line: composePlanLine({ record, commit: res.commit, specHash: hash }) })}\n`);
  return 0;
}

function runRead(v, deps) {
  const fail = (msg) => { deps.stderr(`${NAME}: ${msg}\n`); return 1; };
  const repo = openRepo(deps, () => deps.cwd());
  if (repo.error) return fail(`not a usable git repository: ${repo.error}`);
  const res = readPlan({ g: repo.g, fetch: repo.push, record: Number(v.record), commit: v.commit });
  if (!res.ok) return fail(res.reason);
  const dir = fsPath(deps, v.out);
  const file = path.join(dir, res.basename);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, res.bytes);
  } catch (err) { return fail(`could not write ${file}: ${detail(err)}`); }
  deps.stdout(`${JSON.stringify({ path: file })}\n`);
  return 0;
}

function runCheck(v, deps, line) {
  const print = (verdict, code) => { deps.stdout(`${JSON.stringify(verdict)}\n`); return code; };
  const repo = openRepo(deps, () => (v.repoRoot === undefined ? deps.cwd() : path.isAbsolute(v.repoRoot) ? path.resolve(v.repoRoot) : path.resolve(deps.cwd(), v.repoRoot)));
  if (repo.error) {
    deps.stderr(`${NAME}: not a usable git repository: ${repo.error}\n`);
    return print({ valid: false, failed: 'ref' }, 1);
  }
  let currentSpecHash = null;
  try { currentSpecHash = specHash(fs.readFileSync(fsPath(deps, v.specFile), 'utf8')); } catch { /* unreadable or no Overview: reads failed: hash */ }
  const verdict = checkPlan({ g: repo.g, fetch: repo.push, line, currentSpecHash, base: v.base });
  return print({ valid: verdict.valid, failed: verdict.failed }, verdict.valid ? 0 : 1);
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.help) { deps.stdout(USAGE); return 0; }
  let parsedLine = null;
  if (o.verb === 'check' && !o.errors.length && Object.hasOwn(o.values, 'lineFile')) {
    try {
      o.values.line = fs.readFileSync(fsPath(deps, o.values.lineFile), 'utf8').replace(/\r?\n$/, '');
    } catch (err) {
      o.errors.push({ msg: `could not read --line-file ${o.values.lineFile}: ${detail(err)}`, check: 'ref' });
    }
  }
  if (o.verb === 'check' && Object.hasOwn(o.values, 'line')) {
    parsedLine = parsePlanLine(o.values.line);
    if (!parsedLine.ok) o.errors.push({ msg: `--line is not a Plan: line (${parsedLine.reason})`, check: 'ref' });
  }
  if (o.errors.length) {
    const msgs = o.errors.map((e) => e.msg).join('; ');
    if (o.verb === 'check') {
      const failed = CHECK_ORDER.find((c) => o.errors.some((e) => e.check === c));
      deps.stdout(`${JSON.stringify({ valid: false, failed })}\n`);
    }
    deps.stderr(`${NAME}: ${msgs}\n${USAGE}`);
    return 2;
  }
  if (o.verb === 'write') return runWrite(o.values, deps);
  if (o.verb === 'read') return runRead(o.values, deps);
  return runCheck(o.values, deps, parsedLine);
}

module.exports = { run, realDeps, USAGE, EXIT_NO_REF, PLAN_REF_PREFIX, parsePlanRefName };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
