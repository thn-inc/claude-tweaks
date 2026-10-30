#!/usr/bin/env node
// bin/log-decision.js — append one _shared/auto-decision-log.md entry to a run's decisions.md.
//   node bin/log-decision.js --run <run-dir> --status AUTO|STAGED|KEPT-PROMPT|SCANNED|REFUSED|SKIP (--text "..." | --text-file <path>) \
//     [--spec <n>] [--step <text>] [--reversibility high|med|low|n/a[" (qualifier)"]] [--lever "<k>=<v> (<source>)"] \
//     [--section "/<skill>"] [--help]
//   node bin/log-decision.js --run <run-dir> --entries <file> [--section "/<skill>"]
// --text-file reads the entry text from a file (one line), so git- or user-supplied text never passes through shell quoting.
// --entries appends a batch under one lock: <file> holds a non-empty JSON array of
// { status, text, step?, spec?, reversibility?, lever?, section? } (an element's section wins over --section),
// each validated like the single-entry flags before any is written; exclusive with --status/--text/--text-file/
// --step/--spec/--reversibility/--lever.
// Exit 0 appended (every entry echoed to stdout, in order); 2 malformed invocation (incl. a text beginning with
// its own --step value followed by `:` — formatEntry writes that prefix, so the repeat is refused); 3 run dir missing or not
// anchored under the main checkout (a worktree-local shadow — _shared/pipeline-run-dir.md).
// The decisions.md half of #637; the staged/ half now ships as bin/stage-item.js.
'use strict';

const fs = require('fs');
const { STATUSES, formatEntry, resolveTarget, appendEntries } = require('./lib/log-decision/append');

const USAGE = 'usage: log-decision.js --run <run-dir> --status AUTO|STAGED|KEPT-PROMPT|SCANNED|REFUSED|SKIP (--text "..." | --text-file <path>) [--spec <n>] [--step <text>] [--reversibility high|med|low|n/a[" (qualifier)"]] [--lever "<k>=<v> (<source>)"] [--section "/<skill>"] [--help]\n'
  + '       log-decision.js --run <run-dir> --entries <file> [--section "/<skill>"]   (<file>: JSON array of { status, text, step?, spec?, reversibility?, lever?, section? })\n';
const REVERSIBILITY = ['high', 'med', 'low', 'n/a'];
// One literal space before the qualifier: \s would admit "\n"/"\t" and split one entry across lines.
const REVERSIBILITY_RE = new RegExp(`^(?:${REVERSIBILITY.join('|')})( \\(.+\\))?$`);
// The single-entry flags --entries replaces; any of them alongside --entries is a usage error.
const SINGLE_ENTRY_FLAGS = ['--status', '--text', '--text-file', '--step', '--spec', '--reversibility', '--lever'];
// A split string, not an array literal: `['status', …]` reads as a git status argv to
// tests/git-status-optional-locks.test.js's scanner.
const ENTRY_KEYS = 'status text step spec reversibility lever section'.split(' ');

function parseArgs(argv) {
  const o = { run: null, status: null, text: null, textFile: null, spec: null, step: null, reversibility: 'n/a', lever: null, section: null, entries: null, singleFlags: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (SINGLE_ENTRY_FLAGS.includes(a)) o.singleFlags.push(a);
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else if (a === '--entries') { o.entries = next(); if (o.entries === null) return { error: '--entries requires a <file> argument' }; }
    else if (a === '--status') o.status = next();
    else if (a === '--text') o.text = next();
    else if (a === '--text-file') o.textFile = next();
    else if (a === '--spec') o.spec = next();
    else if (a === '--step') o.step = next();
    else if (a === '--reversibility') o.reversibility = next();
    else if (a === '--lever') o.lever = next();
    else if (a === '--section') o.section = next();
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  now: () => Date.now(),
  cwd: () => process.cwd(),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`log-decision.js: ${message}\n` + USAGE); return 2; };
  if (o.error) { deps.stderr(o.error + '\n' + USAGE); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  let specs;
  if (o.entries !== null) {
    if (o.singleFlags.length) return usageError(`--entries and ${o.singleFlags[0]} are mutually exclusive`);
    const batch = readEntries(o.entries, o.section);
    if (batch.error) return usageError(batch.error);
    specs = batch.entries;
  } else {
    if (!STATUSES.includes(o.status)) return usageError(`--status must be one of ${STATUSES.join('|')}`);
    if (o.text !== null && o.textFile !== null) return usageError('--text and --text-file are mutually exclusive');
    if (o.textFile !== null) {
      let raw;
      try { raw = fs.readFileSync(o.textFile, 'utf8'); } catch (err) { return usageError(`could not read --text-file ${o.textFile}: ${err.message}`); }
      const line = raw.replace(/\s+$/, '');
      if (/[\r\n]/.test(line)) return usageError('--text-file must hold one line of entry text (no interior line breaks)');
      o.text = line;
    }
    if (!o.text || !String(o.text).trim()) return usageError('--text or --text-file is required');
    if (repeatsStep(o.step, o.text)) return usageError(repeatsStepMessage(o.step, o.text, false));
    if (!REVERSIBILITY_RE.test(String(o.reversibility))) return usageError(`--reversibility must be one of ${REVERSIBILITY.join('|')}, optionally followed by " (qualifier)"`);
    if (o.spec !== null && !/^\d+$/.test(String(o.spec))) return usageError('--spec must be a record number');
    specs = [{ status: o.status, step: o.step, spec: o.spec, text: o.text, reversibility: o.reversibility, lever: o.lever, section: o.section }];
  }
  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) { deps.stderr(`log-decision.js: ${err && err.message}\n`); return 3; }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`log-decision.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`log-decision.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  const now = deps.now();
  const items = specs.map(({ section, ...fields }) => ({ section, entry: formatEntry({ ...fields, now }) }));
  try { appendEntries({ runDir: o.run, items }); } catch (err) { deps.stderr(`log-decision.js: could not write decisions.md (${err && err.message})\n`); return 3; }
  deps.stdout(items.map(({ entry }) => entry + '\n').join(''));
  return 0;
}

// Read and validate an --entries file: { entries } (each element normalized to
// formatEntry's fields plus its section, --section filling an absent one) or
// { error } naming the first offending `entries[{i}]`. Nothing is formatted
// until every element passes, so one bad element writes nothing.
function readEntries(file, defaultSection) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    return { error: err instanceof SyntaxError ? `--entries ${file} is not valid JSON: ${err.message}` : `could not read --entries ${file}: ${err.message}` };
  }
  if (!Array.isArray(parsed) || !parsed.length) return { error: `--entries ${file} must hold a non-empty JSON array of entries` };
  const entries = [];
  for (let i = 0; i < parsed.length; i++) {
    const el = parsed[i];
    const problem = entryProblem(el);
    if (problem) return { error: `entries[${i}]: ${problem}` };
    entries.push({
      status: el.status, step: el.step, spec: el.spec ?? null, text: el.text.replace(/\s+$/, ''),
      reversibility: el.reversibility ?? 'n/a', lever: el.lever, section: el.section || defaultSection,
    });
  }
  return { entries };
}

// True iff text opens with `{step}:` — the prefix formatEntry already writes before the text. The text is
// trimmed because formatEntry trims it before writing, so leading whitespace still lands as a doubled prefix;
// the step is compared as given, since formatEntry writes it as given.
function repeatsStep(step, text) {
  return typeof step === 'string' && step !== '' && String(text).trim().startsWith(step + ':');
}

// The --entries form names its element fields (text/step); the single-entry flags keep --text/--step.
function repeatsStepMessage(step, text, fromEntry) {
  const [textName, stepName] = fromEntry ? ['text', 'step'] : ['--text', '--step'];
  return `${textName} repeats ${stepName}: ${stepName} "${step}", ${textName} "${text}" — the step prefix is written for you; drop it from the text`;
}

// The single-entry flags' checks, applied to one --entries element; null when valid.
function entryProblem(el) {
  if (!el || typeof el !== 'object' || Array.isArray(el)) return 'must be an object';
  const unknown = Object.keys(el).find((k) => !ENTRY_KEYS.includes(k));
  if (unknown) return `unknown key "${unknown}" (expected ${ENTRY_KEYS.join('|')})`;
  if (!STATUSES.includes(el.status)) return `status must be one of ${STATUSES.join('|')}`;
  if (typeof el.text !== 'string' || !el.text.trim()) return 'text is required (a non-empty string)';
  if (/[\r\n]/.test(el.text.replace(/\s+$/, ''))) return 'text must be one line (no interior line breaks)';
  for (const key of ['step', 'lever', 'section']) {
    if (el[key] != null && (typeof el[key] !== 'string' || /[\r\n]/.test(el[key]))) return `${key} must be a single-line string`;
  }
  if (repeatsStep(el.step, el.text)) return repeatsStepMessage(el.step, el.text, true);
  if (el.reversibility != null && (typeof el.reversibility !== 'string' || !REVERSIBILITY_RE.test(el.reversibility))) return `reversibility must be one of ${REVERSIBILITY.join('|')}, optionally followed by " (qualifier)"`;
  if (el.spec != null && !/^\d+$/.test(String(el.spec))) return 'spec must be a record number';
  return null;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
