#!/usr/bin/env node
// bin/write-run-artifact.js — write or delete one allowlisted top-level
// artifact in a run directory, the sanctioned path for a worktree-isolated
// session (#3044). The fifth of the sanctioned-write family:
// bin/log-decision.js (decisions.md), bin/stage-item.js (staged/),
// bin/set-config.js (config.yml), bin/set-verify-expectations.js
// (verify-expectations.json), this (the names in
// bin/lib/run-artifact/write.js's ARTIFACT_NAMES — today
// sdd-dispatch-sample.txt, /build's AC-forwarding sample, and
// sdd-final-review.md, the SDD final review).
//   node bin/write-run-artifact.js --run <run-dir> --name <artifact> (--file <src> | --delete) [--help]
// --file reads the source file as UTF-8 text (the allowlisted artifacts
// are text: a reviewer prompt, a review) and writes it to
// <run-dir>/<artifact> (create or overwrite); --delete removes it, and is
// idempotent — an absent file is still exit 0.
// Exit 0 on success (echoes the written/removed file's path — the run dir's
// realpath, which can differ from the --run input string; a --delete of an
// already-absent file appends " (already absent)"); 2 on a malformed
// invocation (an unknown argument, missing --run/--name, a --name outside
// the allowlist, --file and --delete both given or neither, an unreadable
// --file — nothing is written on this code); 3 when the run dir is missing
// or not anchored under the main checkout (a worktree-local shadow —
// _shared/pipeline-run-dir.md's Anchoring section, [IL-127]), or the file is
// unwritable. No exit 1, like its four siblings.
'use strict';

const fs = require('fs');
const { resolveTarget } = require('./lib/stage-item/write');
const {
  ARTIFACT_NAMES, isArtifactName, writeArtifact, deleteArtifact,
} = require('./lib/run-artifact/write');

const USAGE = 'usage: write-run-artifact.js --run <run-dir> --name <artifact> (--file <src> | --delete) [--help]\n';

function parseArgs(argv) {
  const o = {
    run: null, name: null, file: null, delete: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else if (a === '--name') o.name = next();
    else if (a === '--file') o.file = next();
    else if (a === '--delete') o.delete = true;
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  readFile: (p) => fs.readFileSync(p),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`write-run-artifact.js: ${message}\n` + USAGE); return 2; };
  if (o.error) { deps.stderr(o.error + '\n' + USAGE); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.name) return usageError('--name <artifact> is required');
  if (!isArtifactName(o.name)) return usageError(`--name must be one of: ${ARTIFACT_NAMES.join(', ')} (got ${JSON.stringify(o.name)})`);
  if (o.file && o.delete) return usageError('--file and --delete are mutually exclusive');
  if (!o.file && !o.delete) return usageError('one of --file <src> or --delete is required');

  let content;
  if (o.file) {
    try { content = deps.readFile(o.file).toString('utf8'); } catch (err) {
      deps.stderr(`write-run-artifact.js: could not read --file ${o.file} (${err && err.message})\n`);
      return 2;
    }
  }

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`write-run-artifact.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`write-run-artifact.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`write-run-artifact.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  try {
    if (o.delete) {
      const result = deleteArtifact({ runDir: target.dir, name: o.name });
      deps.stdout(result.file + (result.existed ? '' : ' (already absent)') + '\n');
    } else {
      const result = writeArtifact({ runDir: target.dir, name: o.name, content });
      deps.stdout(result.file + '\n');
    }
  } catch (err) {
    deps.stderr(`write-run-artifact.js: could not ${o.delete ? 'delete' : 'write'} ${o.name} (${err && err.message})\n`);
    return 3;
  }
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
