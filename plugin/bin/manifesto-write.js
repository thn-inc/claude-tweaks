#!/usr/bin/env node
// bin/manifesto-write.js — /flow Step 3's Pipeline Config Manifesto for a
// fresh `auto`-mode run dir (adoption cases 2 and 5), in one call (#4027). The
// spec is skills/flow/manifesto.md; the procedure is lib/flow/manifesto-write.js.
//
//   node bin/manifesto-write.js --run <run-dir> --mode auto
//     --mode-source <arg|dispatch|policy|default>
//     --ceremony <n>=<fast-lane|standard>[:judged][,...] [--pre-authorize-merge] [--help]
//
// --mode/--mode-source are flow/SKILL.md Step 1's resolved mode and deciding
// rung; only `auto` runs here — confirm/hybrid gate on an approval and keep
// manifesto.md's hand procedure, and interactive runs no Manifesto.
// --ceremony carries one entry per record: its ceremony:* label, or —
// suffixed `:judged` — the ceremony-check verdict for an unlabeled record
// (logged as a `Manifesto ceremony-check` line). --pre-authorize-merge is the
// typed `pre-authorize-merge` token: lever 13 becomes `pre-authorized`
// (source `arg`) on a single-record run that is not dispatch-bound (run-state.json
// `dispatched: true`, flow/SKILL.md Step 1 rung 2's read); otherwise it stays
// `ask` and manifesto.md's merge-authorization SKIP line is logged.
// The policy levers resolve through lib/flow/preflight.js's resolvePolicy
// (resolve-policy.js's own lib calls, with the run dir's --run overlay), from
// the cwd's checkout, as bin/resolve-policy.js does. Writes config.yml (13
// levers, the integration-model run pin, spec:, created:), the decisions.md
// snapshot header (existing Step 2.8 lines kept below it), staged/, and the
// Manifesto's decision lines under `## /flow`.
//
// Case 3 (a run dir with decisions.md content but no config.yml) is the
// caller's to route to steps-and-gates.md case 3, never here: only an
// already-headed decisions.md is refused; a headerless one gets a header.
//
// Stdout: the `### Pipeline Config (auto)` FYI table (markdown).
// Exit 0 written.
//      3 config.yml already present — a case-1 adoption: read preflight.levers.
//        Nothing is written.
//      2 malformed invocation (incl. --mode confirm|hybrid|interactive); a --run
//        that is missing or not anchored under the main checkout (a worktree-
//        local shadow, or a dir outside every checkout — [IL-127]); a basename
//        that is not a run id; or a decisions.md that already carries a
//        snapshot header (a case-3 recovery). Nothing is written.
//      1 a filesystem failure, or a lever that did not resolve. A config.yml
//        write that fails mid-batch removes the partial file; the stderr line
//        says what landed. Read manifesto.md and finish by hand.
// --run is anchored strictly, through lib/stage-item/write.js's resolveTarget
// (the sanctioned writers' predicate), because the callers branch on this
// CLI's exit codes and nothing legitimately writes a run dir outside the main
// checkout. The refusal is exit 2, not the sanctioned writers' 3: here 3 is
// the case-1 answer.
'use strict';

const fs = require('fs');
const path = require('path');
const ctxLib = require('./lib/hooks/context');
const { resolveTarget } = require('./lib/stage-item/write');
const { defaultDeps: preflightDeps } = require('./lib/flow/preflight');
const {
  MODES, MODE_SOURCES, POLICY_REQUEST_KEYS, ManifestoInputError, AdoptedRunError, InitializedLogError,
  computeLevers, mergeAuthorizationRefusal, configPresent, runCreated, writeManifesto,
} = require('./lib/flow/manifesto-write');

const USAGE = 'usage: manifesto-write.js --run <run-dir> --mode auto --mode-source <arg|dispatch|policy|default>\n'
  + '         --ceremony <n>=<fast-lane|standard>[:judged][,...] [--pre-authorize-merge] [--help]\n'
  + '  writes a fresh auto run\'s config.yml, decisions.md snapshot header, staged/ and Manifesto lines; prints the FYI table\n'
  + '  exit 0 written\n'
  + '       3 config.yml already present (case-1 adoption: read preflight.levers) — nothing written\n'
  + '       2 malformed invocation, --mode other than auto (follow flow/manifesto.md by hand), bad --run,\n'
  + '         or decisions.md already headed (case 3) — nothing written\n'
  + '       1 filesystem failure or an unresolved lever — read manifesto.md and finish by hand\n';

const FLAGS = { '--run': 'run', '--mode': 'mode', '--mode-source': 'modeSource', '--ceremony': 'ceremony' };
const SWITCHES = { '--pre-authorize-merge': 'preAuthorizeMerge' };

function parseArgs(argv) {
  const o = { help: false, preAuthorizeMerge: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (Object.hasOwn(SWITCHES, a)) { o[SWITCHES[a]] = true; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

// "4027=standard:judged,12=fast-lane" -> [{ n, ceremony, ceremonySource }]
function parseCeremony(raw) {
  const records = [];
  for (const item of raw.split(',')) {
    const m = /^#?([1-9]\d*)=(fast-lane|standard)(?::(judged))?$/.exec(item.trim());
    if (!m) return { error: `--ceremony entry ${JSON.stringify(item)} is not <n>=<fast-lane|standard>[:judged]` };
    const n = Number(m[1]);
    if (records.some((r) => r.n === n)) return { error: `--ceremony names #${n} more than once` };
    records.push({ n, ceremony: m[2], ceremonySource: m[3] ? 'judged' : 'label' });
  }
  return { records };
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined, // resolveTarget derives the main-checkout anchor from cwd
  resolveTarget,
  // flow/SKILL.md Step 1 rung 2's read, fail-open: dispatch-bound only when
  // run-state.json parses with `dispatched: true`.
  readDispatched: (runDir) => (ctxLib.readRunState(runDir) || {}).dispatched === true,
  resolvePolicy: (keys, runDir, cwd) => preflightDeps(cwd).resolvePolicy(keys, runDir),
  mkdir: (p, opts) => fs.mkdirSync(p, opts),
  now: () => Date.now(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`manifesto-write.js: ${message}\n${USAGE}`); return 2; };
  const refuse = (code, message) => { deps.stderr(`manifesto-write.js: ${message}\n`); return code; };

  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  for (const flag of Object.keys(FLAGS)) if (!o[FLAGS[flag]]) return usageError(`${flag} is required`);
  if (!MODES.includes(o.mode)) {
    const why = o.mode === 'interactive' ? 'interactive runs no Manifesto' : `${o.mode} gates the Manifesto on an approval`;
    return usageError(`--mode ${o.mode}: this CLI runs only the auto FYI path (${why}) — follow flow/manifesto.md by hand`);
  }
  if (!MODE_SOURCES.includes(o.modeSource)) return usageError(`--mode-source must be one of ${MODE_SOURCES.join(', ')}: ${o.modeSource}`);
  const parsed = parseCeremony(o.ceremony);
  if (parsed.error) return usageError(parsed.error);

  let cwd;
  try { cwd = deps.cwd(); } catch (err) { return refuse(1, err && err.message); }
  let target;
  try { target = deps.resolveTarget({ runDir: path.resolve(cwd, o.run), cwd, mainRoot: deps.mainRoot }); } catch (err) { return usageError(err && err.message); }
  if (!target.ok) {
    return usageError(target.reason === 'missing'
      ? `--run dir does not exist or is not a directory: ${o.run}`
      : `--run ${o.run} is not anchored under the main checkout (a worktree-local shadow, or outside every checkout) — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }
  const runDir = target.dir;

  try {
    runCreated(runDir);
    if (configPresent(runDir)) return refuse(3, `config.yml already present in ${runDir} — a case-1 adoption: read preflight.levers instead`);
    const dispatched = o.preAuthorizeMerge && deps.readDispatched(runDir) === true;
    const resolved = deps.resolvePolicy([...POLICY_REQUEST_KEYS], runDir, cwd) || {};
    const levers = computeLevers({
      mode: o.mode, modeSource: o.modeSource, records: parsed.records, resolved, preAuthorizeMerge: o.preAuthorizeMerge, dispatched,
    });
    const mergeRefusal = mergeAuthorizationRefusal({ preAuthorizeMerge: o.preAuthorizeMerge, dispatched, records: parsed.records });
    const pinEntry = resolved['integration-model'];
    const integrationModel = pinEntry && pinEntry.error === undefined && typeof pinEntry.value === 'string' ? pinEntry.value : null;
    const { table } = writeManifesto({
      runDir, records: parsed.records, levers, integrationModel, mergeRefusal, now: deps.now(),
    }, { mkdir: deps.mkdir });
    if (!integrationModel) deps.stderr('manifesto-write.js: integration-model resolved empty — config.yml written without the run pin (SKIP logged)\n');
    if (mergeRefusal) deps.stderr(`manifesto-write.js: pre-authorize-merge has no effect on a ${mergeRefusal} run — merge-authorization written as ask (SKIP logged)\n`);
    deps.stdout(table);
    return 0;
  } catch (err) {
    if (err instanceof AdoptedRunError) return refuse(3, err.message);
    if (err instanceof ManifestoInputError) return usageError(err.message);
    if (err instanceof InitializedLogError) return refuse(2, err.message);
    return refuse(1, err && err.message ? err.message : String(err));
  }
}

module.exports = { run, parseArgs, parseCeremony };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
