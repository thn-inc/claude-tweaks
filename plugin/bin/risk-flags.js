#!/usr/bin/env node
// bin/risk-flags.js — the record flag line's CLI (#4618): the one command shaping and
// refine run to classify a record body, settle the kept flag set, and confirm a flagged
// record with a human's answers. The writers are lib/issues/record-risk-flags.js's
// (re-exported by record.js); this file only drives them, so the line has one writer.
//
//   node bin/risk-flags.js classify --body-file <f> [--prior-body-file <f>] [--add a,b] [--repo-root <dir>]
//   node bin/risk-flags.js settle   --body-file <f> [--prior-body-file <f>] [--add a,b] (--headless | --answers-file <f>) [--run <dir>] [--repo-root <dir>]
//   node bin/risk-flags.js confirm  --body-file <f> --answers-file <f> [--run <dir>] [--repo-root <dir>]
//   node bin/risk-flags.js facts    --spec-file <f> [--plan-file <f>] --flags-out <f> --proofs-out <f> [--repo-root <dir>]
//
// classify  Writes nothing. Prints { flags, kept, entry, missingSections, controlMode,
//           extraCategories, globsInvalid, known }: `flags` is the classifier floor only
//           ({ slug, evidence, via }), `kept` is exactly the set `settle` would keep from the
//           same arguments (one shared helper, canonical order), `entry` is { status,
//           reason, unconfirmed } as `settle` reads the record, and `known` is the built-in
//           categories plus the policy extras (the slugs `--add` may name).
// settle    Computes the kept set — the prior body's flags, the body's own flags, the floor
//           and `--add` (an unreadable line contributes its widened list) — and rewrites
//           --body-file in place. `--headless` removes nothing and marks a non-empty set
//           unconfirmed. `--answers-file` ({ "<slug>": "keep" | "remove" }) applies a
//           human's answers; a flag with no valid answer stays kept and the marker stays.
// confirm   The human batch for /backlog refine: answers apply to the body's existing
//           flags only, no classifier runs, nothing is added. A body with no flag line stays
//           byte-identical (status `unclassified`).
// Both writing verbs print { flags, removed, unconfirmed, status, refused, logged,
// logFailures }. `status` is the entry status (`unknown` when the body's line, or for
// `settle` the prior body's, is unreadable). Reading A: on an `unknown` entry no answer is
// applied, the widened set stays, the marker is kept or written, nothing is logged, and
// `refused` is { reason, raw, answered }; the fail direction is keep, so it still exits 0.
// Each removal with --run is appended to decisions.md as KEPT-PROMPT (a human answered it
// inline) through log-decision.js's run, under the verb's own LOG_SITE (settle: /specify's
// Risk flags step; confirm: /backlog's Refine risk flags step). `logged` is null whenever no removal was attempted
// (no --run, or --run with nothing removed, a Reading A refusal included), so true always
// means at least one line was written and false that one failed (`logFailures` names the
// slugs). A failed log never changes the exit.
// An empty kept set writes the none line and no marker, but a hand-written unconfirmed marker
// already on the body survives a headless settle: clearing it would need humanConfirmed with
// no human, the marker is the cautious side, and the next human confirm clears it.
// A writer that refuses a line the entry read as ok (RISK_FLAGS_UNKNOWN thrown mid-answer)
// takes the Reading A path too: status `unknown`, nothing applied, marker kept or written,
// and `refused.reason` is the error's own, else what the line reads, else null.
//
// facts     Writes nothing to the record. Reads --spec-file's flag line (and --plan-file's
//           Proof lines) and writes the two JSON arrays the packet gather takes as `--flags`
//           and `--proofs` (lib/issues/risk-flag-facts.js), then prints { status, flags,
//           proofs, plan } — the counts, and `plan` 'read' or 'absent' (no --plan-file, or a
//           file that is gone). The producer never leaves an empty list behind a failure: on
//           every non-zero exit both outputs are removed if present, so the gather states
//           "--flags input not read — treated as absent" instead of reading a stale or empty
//           file as "no flags".
//
// Exit codes (Payload-1/Invocation-2 as qa-report.js, plus 2 for an unreadable policy):
//   0  done, including an answer refused or left unanswered
//   1  --body-file or --prior-body-file unreadable (facts: --spec-file, or a --plan-file
//      that fails to read for a reason other than being absent)
//   2  malformed invocation, or the policy (.claude-tweaks/policy.yml) unreadable or invalid
//   3  a named output file could not be written (--body-file; facts: --flags-out or --proofs-out)
// --run is a best-effort audit line and is anchored by log-decision.js; it is not an input.
// The body write is an atomic overwrite with no lock: one shaping run owns its body file.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const record = require('./lib/issues/record');
const { classifyRiskFlags, readRiskPolicy } = require('./lib/issues/risk-flag-classify');
const { BUILTIN_RISK_CATEGORIES, LIST_ELEMENT_PATTERNS } = require('./lib/policy-schema');
const { writeFileAtomic } = require('./lib/atomic-write');
const logDecision = require('./log-decision');
const { riskFlagEntries } = require('./lib/issues/risk-flag-facts');

const USAGE = 'usage: risk-flags.js classify --body-file <f> [--prior-body-file <f>] [--add a,b] [--repo-root <dir>]\n'
  + '       risk-flags.js settle --body-file <f> [--prior-body-file <f>] [--add a,b] (--headless | --answers-file <f>) [--run <dir>] [--repo-root <dir>]\n'
  + '       risk-flags.js confirm --body-file <f> --answers-file <f> [--run <dir>] [--repo-root <dir>]\n'
  + '       risk-flags.js facts --spec-file <f> [--plan-file <f>] --flags-out <f> --proofs-out <f> [--repo-root <dir>]\n'
  + '  answers file: JSON object { "<slug>": "keep" | "remove" }\n'
  + '  exit 0 done (a refused or unanswered flag is still 0: the fail direction is keep), 1 body, prior-body or spec file unreadable,\n'
  + '       2 malformed invocation or unreadable policy, 3 a named output file (--body-file, --flags-out, --proofs-out) unwritable\n'
  + '  facts removes both outputs on every non-zero exit\n';

const FLAG_KEYS = {
  '--body-file': 'bodyFile',
  '--prior-body-file': 'priorBodyFile',
  '--add': 'add',
  '--answers-file': 'answersFile',
  '--run': 'run',
  '--repo-root': 'repoRoot',
  '--headless': 'headless',
  '--spec-file': 'specFile',
  '--plan-file': 'planFile',
  '--flags-out': 'flagsOut',
  '--proofs-out': 'proofsOut',
};
const VERB_FLAGS = {
  classify: ['--body-file', '--prior-body-file', '--add', '--repo-root'],
  settle: ['--body-file', '--prior-body-file', '--add', '--headless', '--answers-file', '--run', '--repo-root'],
  confirm: ['--body-file', '--answers-file', '--run', '--repo-root'],
  facts: ['--spec-file', '--plan-file', '--flags-out', '--proofs-out', '--repo-root'],
};

// -> { help } | { error } | the parsed options. Every value flag is validated here: a
// missing, empty or flag-shaped value is a usage error, never a `null` that reads as unset.
function parseArgs(argv) {
  const [verb, ...rest] = argv;
  if (verb === '--help' || verb === '-h') return { help: true };
  if (verb === undefined) return { error: 'a verb is required: classify, settle, confirm or facts' };
  if (!Object.hasOwn(VERB_FLAGS, verb)) return { error: `unknown verb: ${verb}` };
  const o = {
    verb, bodyFile: null, priorBodyFile: null, add: null, answersFile: null, run: null, repoRoot: null, headless: false,
    specFile: null, planFile: null, flagsOut: null, proofsOut: null,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (!Object.hasOwn(FLAG_KEYS, a)) return { error: `unknown argument: ${a}` };
    if (!VERB_FLAGS[verb].includes(a)) return { error: `${a} is not valid for ${verb}` };
    const key = FLAG_KEYS[a];
    if (key === 'headless') {
      if (o.headless) return { error: '--headless given more than once' };
      o.headless = true;
      continue;
    }
    const v = rest[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    if (o[key] !== null) return { error: `${a} given more than once` };
    o[key] = v;
  }
  if (verb === 'facts') {
    for (const [flag, key] of [['--spec-file', 'specFile'], ['--flags-out', 'flagsOut'], ['--proofs-out', 'proofsOut']]) {
      if (o[key] === null) return { error: `${flag} <path> is required` };
    }
    if (o.flagsOut === o.proofsOut) return { error: '--flags-out and --proofs-out must name different files' };
    return o;
  }
  if (o.bodyFile === null) return { error: '--body-file <path> is required' };
  if (verb === 'settle' && o.headless === (o.answersFile !== null)) return { error: 'settle needs exactly one of --headless and --answers-file <path>' };
  if (verb === 'confirm' && o.answersFile === null) return { error: 'confirm needs --answers-file <path>' };
  const add = o.add === null ? [] : o.add.split(',').map((slug) => slug.trim());
  const badSlug = add.find((slug) => !LIST_ELEMENT_PATTERNS.slug.test(slug) || slug === record.RISK_FLAGS_NONE);
  if (badSlug !== undefined) return { error: `--add names ${JSON.stringify(badSlug)}, which is not a category slug` };
  o.add = [...new Set(add)];
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, content) => writeFileAtomic(p, content),
  removeFile: (p) => fs.unlinkSync(p),
  cwd: () => process.cwd(),
  now: () => Date.now(),
  mainRoot: undefined,
  execFile: (file, args, cwd) => execFileSync(file, args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }),
  policy: (repoRoot) => readRiskPolicy(repoRoot, { readFile: fs.readFileSync }),
};

const errMsg = (err) => String((err && (err.code || err.message)) || 'unknown').replace(/\s+/g, ' ');
const unique = (items) => [...new Set(items)];

// The order an ok line reads in belongs to the writer, so ask it rather than restate it.
function canonical(slugs, extraCategories) {
  return record.parseRiskFlags(record.addRiskFlags('', slugs, { extraCategories }), { extraCategories }).flags;
}

// The kept set, shared by classify and settle so the two cannot drift: the prior body's
// flags, the body's own, the floor and --add, in canonical order. `entry` is the body's own
// line as parseRiskFlags reads it, except that a prior body whose line is unreadable also
// makes the entry `unknown` (Reading A is decided on the line as the verb starts).
function keptSet({ body, priorBody, add, floor, extraCategories }) {
  const own = record.parseRiskFlags(body, { extraCategories });
  const prior = priorBody === null ? null : record.parseRiskFlags(priorBody, { extraCategories });
  const unreadable = [own, prior].find((parsed) => parsed !== null && parsed.status === 'unknown') || null;
  const kept = canonical(unique([...(prior ? prior.flags : []), ...own.flags, ...floor.map((flag) => flag.slug), ...add]), extraCategories);
  const entry = { status: unreadable ? 'unknown' : own.status, reason: unreadable ? unreadable.reason : null, unconfirmed: own.unconfirmed };
  return { kept, entry, raw: unreadable ? unreadable.raw : null };
}

// -> { answers: object | null, problem: string | null }: a file that does not read, parse
// or hold an object is a problem, never an exception (the fail direction is keep).
function readAnswers(deps, file) {
  let text;
  try {
    text = deps.readFile(file);
  } catch (err) {
    return { answers: null, problem: `answers file ${file} is unreadable (${errMsg(err)})` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { answers: null, problem: `answers file ${file} is not valid JSON` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { answers: null, problem: `answers file ${file} is not a JSON object` };
  return { answers: parsed, problem: null };
}

const answerFor = (answers, slug) => {
  const value = answers !== null && Object.hasOwn(answers, slug) ? answers[slug] : undefined;
  return value === 'keep' || value === 'remove' ? value : null;
};

// body, kept, answers -> { body, removed, unanswered }. A remove is a human's decision
// (humanConfirmed); a flag with no keep/remove answer stays. The marker is cleared only
// when every flag was answered, and restored after a removal cleared it otherwise.
function applyAnswers(body, kept, answers, extraCategories) {
  const human = { humanConfirmed: true, extraCategories };
  const unanswered = kept.filter((slug) => answerFor(answers, slug) === null);
  const removed = kept.filter((slug) => answerFor(answers, slug) === 'remove');
  let next = body;
  for (const slug of removed) next = record.removeRiskFlag(next, slug, human);
  next = unanswered.length === 0 ? record.confirmRiskFlags(next, human) : record.addRiskFlags(next, [], { unconfirmed: true, extraCategories });
  return { body: next, removed, unanswered };
}

const isUnreadableLine = (err) => Boolean(err) && err.code === record.RISK_FLAGS_UNKNOWN;

function refusal(reason, raw, answers) {
  return { reason, raw, answered: answers === null ? [] : Object.keys(answers) };
}

// base body, flags, answers -> { applied } | { refused }. A writer that throws
// RISK_FLAGS_UNKNOWN has judged the line unreadable although the entry read it ok (the
// entry status screens this out, so it is a writer/CLI disagreement): nothing is applied.
// `reason` is the error's own when it carries one, else what the line reads as when that
// is unknown, else null: a line that reads ok is never relabelled malformed.
function tryAnswers(base, flags, answers, extraCategories) {
  try {
    return { applied: applyAnswers(base, flags, answers, extraCategories) };
  } catch (err) {
    if (!isUnreadableLine(err)) throw err;
    const line = record.parseRiskFlags(base, { extraCategories });
    return { refused: refusal(err.reason || (line.status === 'unknown' ? line.reason : null), line.raw, answers) };
  }
}

const unansweredNote = (flags) => (flags.length > 0 ? `no keep or remove answer for ${flags.join(', ')}` : null);

// The settle body, one place for both the Reading A refusals and the answer application.
// -> { next, status, removed, remaining, refused, problem }
function settleBody({ body, kept, entry, raw, answersFile, deps, extraCategories }) {
  const seeded = record.addRiskFlags(body, kept, { unconfirmed: kept.length > 0, extraCategories });
  const out = { next: seeded, status: entry.status, removed: [], remaining: kept, refused: null, problem: null };
  if (answersFile !== null) {
    const { answers, problem } = readAnswers(deps, answersFile);
    out.problem = problem;
    if (entry.status === 'unknown') {
      out.refused = refusal(entry.reason, raw, answers);
    } else {
      const attempt = tryAnswers(seeded, kept, answers, extraCategories);
      if (attempt.refused) {
        out.refused = attempt.refused;
        out.status = 'unknown';
      } else {
        out.next = attempt.applied.body;
        out.removed = attempt.applied.removed;
        out.remaining = kept.filter((slug) => !out.removed.includes(slug));
        if (problem === null) out.problem = unansweredNote(attempt.applied.unanswered);
      }
    }
  }
  out.next = record.appendRiskProofGotcha(out.next, out.remaining);
  return out;
}

// The confirm body: the body's existing flags only. An unreadable line takes Reading A and
// stays byte-identical when it already carries the marker; no flag line is left as it is.
// -> { next, status, removed, refused, problem }
function confirmBody({ body, answersFile, deps, extraCategories }) {
  const own = record.parseRiskFlags(body, { extraCategories });
  const out = { next: body, status: own.status, removed: [], refused: null, problem: null };
  if (own.status === 'unclassified') return out;
  const { answers, problem } = readAnswers(deps, answersFile);
  const marked = () => (own.unconfirmed ? body : record.addRiskFlags(body, [], { unconfirmed: true, extraCategories }));
  if (own.status === 'unknown') {
    out.refused = refusal(own.reason, own.raw, answers);
    out.next = marked();
    return out;
  }
  out.problem = problem;
  const attempt = tryAnswers(body, own.flags, answers, extraCategories);
  if (attempt.refused) {
    out.refused = attempt.refused;
    out.status = 'unknown';
    out.next = marked();
    return out;
  }
  out.removed = attempt.applied.removed;
  out.next = record.appendRiskProofGotcha(attempt.applied.body, own.flags.filter((slug) => !out.removed.includes(slug)));
  if (problem === null) out.problem = unansweredNote(attempt.applied.unanswered);
  return out;
}

// The skill and step each writing verb's removals are logged under: settle runs inside
// /specify's Risk flags step, confirm inside /backlog refine's unconfirmed-flag step.
const LOG_SITE = {
  settle: { section: '/specify', step: 'Risk flags' },
  confirm: { section: '/backlog', step: 'Refine risk flags' },
};

// Best-effort audit line per removal; a refusal or throw is a logFailures entry, never an exit.
// `logged` is null when no removal was attempted (no --run, or nothing removed), so true
// always means at least one decisions.md line was written and false that one failed.
function logRemovals(o, deps, removed) {
  if (o.run === null || removed.length === 0) return { logged: null, logFailures: [] };
  const logDeps = { now: deps.now, cwd: deps.cwd, mainRoot: deps.mainRoot, stdout: () => {}, stderr: deps.stderr };
  const { section, step } = LOG_SITE[o.verb];
  const logFailures = [];
  for (const slug of removed) {
    let code;
    try {
      code = logDecision.run([
        '--run', o.run, '--status', 'KEPT-PROMPT', '--section', section, '--step', step,
        '--text', `Risk flag ${slug} removed by the maintainer during shaping`, '--reversibility', 'low',
      ], logDeps);
    } catch {
      code = 1;
    }
    if (code !== 0) logFailures.push(slug);
  }
  return { logged: logFailures.length === 0, logFailures };
}

function resolveRepoRoot(o, deps) {
  const cwd = deps.cwd();
  if (o.repoRoot !== null) return path.resolve(cwd, o.repoRoot);
  try {
    const top = String(deps.execFile('git', ['rev-parse', '--show-toplevel'], cwd)).trim();
    if (top) return top;
  } catch {
    // Not in a git repo: the cwd is the root the policy is read from.
  }
  return cwd;
}

// A file already gone is the goal; any other failure is stated, because the file is still there.
function removeOutput(deps, file) {
  try {
    deps.removeFile(file);
  } catch (err) {
    if (!(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'))) deps.stderr(`risk-flags.js: could not remove ${file} (${errMsg(err)})\n`);
  }
}

// argv of a rejected `facts` -> the outputs it named, so a usage error still takes away what an
// earlier run left (the parse stopped before an options object existed). A flag-shaped value
// is not a path.
function namedOutputs(argv) {
  const out = [];
  argv.forEach((arg, i) => {
    const value = argv[i + 1];
    if ((arg === '--flags-out' || arg === '--proofs-out') && typeof value === 'string' && value.trim() && !value.startsWith('--')) out.push(value);
  });
  return [...new Set(out)];
}

// The facts verb: spec (+ plan) -> the two JSON arrays the packet gather reads. Exit codes as
// the header; the caller removes both outputs on any non-zero return.
function factsVerb(o, deps, read) {
  const fail = (code, reason) => { deps.stderr(`risk-flags.js: ${reason}\n`); return code; };
  let specText;
  try { specText = read(o.specFile); } catch (err) { return fail(1, `spec-unreadable: ${o.specFile} (${errMsg(err)})`); }
  let planText = null;
  if (o.planFile !== null) {
    try {
      planText = read(o.planFile);
    } catch (err) {
      // A plan that is not there yet is the ordinary case; any other failure is not a plan to ignore.
      if (!(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'))) return fail(1, `plan-unreadable: ${o.planFile} (${errMsg(err)})`);
    }
  }
  let repoRoot;
  try { repoRoot = resolveRepoRoot(o, deps); } catch (err) { return fail(2, `repo-root-unresolvable: (${errMsg(err)})`); }
  let policy;
  try { policy = deps.policy(repoRoot); } catch (err) { return fail(2, `policy-unreadable: ${repoRoot} (${errMsg(err)})`); }

  const { status, flags, proofs } = riskFlagEntries(specText, planText, { extraCategories: policy.extraCategories });
  for (const [file, entries] of [[o.flagsOut, flags], [o.proofsOut, proofs]]) {
    try { deps.writeFile(file, `${JSON.stringify(entries)}\n`); } catch (err) { return fail(3, `output-unwritable: ${file} (${errMsg(err)})`); }
  }
  deps.stdout(`${JSON.stringify({ status, flags: flags.length, proofs: proofs.length, plan: planText === null ? 'absent' : 'read' })}\n`);
  return 0;
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.error) {
    deps.stderr(`risk-flags.js: ${o.error}\n${USAGE}`);
    if (argv[0] === 'facts') namedOutputs(argv).forEach((file) => removeOutput(deps, file));
    return 2;
  }
  const fail = (code, reason) => { deps.stderr(`risk-flags.js: ${reason}\n`); return code; };
  const warn = (message) => deps.stderr(`risk-flags.js: ${message}\n`);

  const read = (file) => {
    const text = deps.readFile(file);
    if (typeof text !== 'string') throw new TypeError('not text');
    return text;
  };
  if (o.verb === 'facts') {
    const code = factsVerb(o, deps, read);
    if (code !== 0) [o.flagsOut, o.proofsOut].forEach((file) => removeOutput(deps, file));
    return code;
  }
  let body;
  try { body = read(o.bodyFile); } catch (err) { return fail(1, `body-unreadable: ${o.bodyFile} (${errMsg(err)})`); }
  let priorBody = null;
  if (o.priorBodyFile !== null) {
    try { priorBody = read(o.priorBodyFile); } catch (err) { return fail(1, `prior-body-unreadable: ${o.priorBodyFile} (${errMsg(err)})`); }
  }

  let repoRoot;
  try { repoRoot = resolveRepoRoot(o, deps); } catch (err) { return fail(2, `repo-root-unresolvable: (${errMsg(err)})`); }
  let policy;
  try { policy = deps.policy(repoRoot); } catch (err) { return fail(2, `policy-unreadable: ${repoRoot} (${errMsg(err)})`); }
  const extraCategories = policy.extraCategories;
  const known = unique([...BUILTIN_RISK_CATEGORIES, ...extraCategories]);

  // confirm runs no classifier: it acts on the flags the body already carries.
  let floor = { flags: [], missingSections: [] };
  if (o.verb !== 'confirm') {
    try {
      floor = classifyRiskFlags(body, { extraCategories, pathGlobs: policy.pathGlobs });
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      return fail(2, `policy-invalid: ${repoRoot} (${errMsg(err)})`);
    }
    const unknownAdd = o.add.find((slug) => !known.includes(slug));
    if (unknownAdd !== undefined) return fail(2, `--add names ${JSON.stringify(unknownAdd)}, which is not a known category (${known.join(', ')})`);
  }

  const emit = (envelope) => { deps.stdout(`${JSON.stringify(envelope)}\n`); return 0; };

  if (o.verb === 'classify') {
    const { kept, entry } = keptSet({ body, priorBody, add: o.add, floor: floor.flags, extraCategories });
    return emit({
      flags: floor.flags, kept, entry, missingSections: floor.missingSections,
      controlMode: policy.controlMode, extraCategories, globsInvalid: policy.globsInvalid, known,
    });
  }

  // settle and confirm: work out the new body, then write, log, report.
  let shaped;
  if (o.verb === 'settle') {
    const { kept, entry, raw } = keptSet({ body, priorBody, add: o.add, floor: floor.flags, extraCategories });
    shaped = settleBody({ body, kept, entry, raw, answersFile: o.answersFile, deps, extraCategories });
  } else {
    shaped = confirmBody({ body, answersFile: o.answersFile, deps, extraCategories });
  }
  const { next, status, removed, refused, problem } = shaped;

  if (refused !== null && refused.reason !== null) warn(`the record's flag line is unreadable (${refused.reason}): no answer was applied; the widened set is kept and marked unconfirmed`);
  else if (refused !== null) warn('a writer refused the record\'s flag line: no answer was applied; the kept set stays and is marked unconfirmed');
  else if (problem !== null) warn(`${problem}; every flag without a valid answer is kept and marked unconfirmed`);

  if (next !== body) {
    try { deps.writeFile(o.bodyFile, next); } catch (err) { return fail(3, `body-unwritable: ${o.bodyFile} (${errMsg(err)})`); }
  }
  const { logged, logFailures } = logRemovals(o, deps, removed);
  const final = record.parseRiskFlags(next, { extraCategories });
  return emit({ flags: final.flags, removed, unconfirmed: final.unconfirmed, status, refused, logged, logFailures });
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
