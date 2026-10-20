#!/usr/bin/env node
// bin/log-decision.js — append one _shared/auto-decision-log.md entry to a run's decisions.md.
//   node bin/log-decision.js --run <run-dir> --status AUTO|STAGED|KEPT-PROMPT|SCANNED|REFUSED|SKIP (--text "..." | --text-file <path>) \
//     [--spec <n>] [--step <text>] [--reversibility high|med|low|n/a[" (qualifier)"]] [--lever "<k>=<v> (<source>)"] \
//     [--section "/<skill>"] [--help]
// --text-file reads the entry text from a file (one line), so git- or user-supplied text never passes through shell quoting.
// Exit 0 appended (entry echoed to stdout); 2 malformed invocation; 3 run dir missing or not
// anchored under the main checkout (a worktree-local shadow — _shared/pipeline-run-dir.md).
// The decisions.md half of #637; the staged/ half now ships as bin/stage-item.js.
'use strict';

const fs = require('fs');
const { STATUSES, formatEntry, resolveTarget, appendEntry } = require('./lib/log-decision/append');

const USAGE = 'usage: log-decision.js --run <run-dir> --status AUTO|STAGED|KEPT-PROMPT|SCANNED|REFUSED|SKIP (--text "..." | --text-file <path>) [--spec <n>] [--step <text>] [--reversibility high|med|low|n/a[" (qualifier)"]] [--lever "<k>=<v> (<source>)"] [--section "/<skill>"] [--help]\n';
const REVERSIBILITY = ['high', 'med', 'low', 'n/a'];
// One literal space before the qualifier: \s would admit "\n"/"\t" and split one entry across lines.
const REVERSIBILITY_RE = new RegExp(`^(?:${REVERSIBILITY.join('|')})( \\(.+\\))?$`);

function parseArgs(argv) {
  const o = { run: null, status: null, text: null, textFile: null, spec: null, step: null, reversibility: 'n/a', lever: null, section: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
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
  if (!REVERSIBILITY_RE.test(String(o.reversibility))) return usageError(`--reversibility must be one of ${REVERSIBILITY.join('|')}, optionally followed by " (qualifier)"`);
  if (o.spec !== null && !/^\d+$/.test(String(o.spec))) return usageError('--spec must be a record number');
  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) { deps.stderr(`log-decision.js: ${err && err.message}\n`); return 3; }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`log-decision.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`log-decision.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  const entry = formatEntry({ status: o.status, now: deps.now(), step: o.step, spec: o.spec, text: o.text, reversibility: o.reversibility, lever: o.lever });
  try { appendEntry({ runDir: o.run, section: o.section, entry }); } catch (err) { deps.stderr(`log-decision.js: could not write decisions.md (${err && err.message})\n`); return 3; }
  deps.stdout(entry + '\n');
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
