#!/usr/bin/env node
// bin/stage-item.js — write one staged proposal file into a run's staged/
// directory.
//   node bin/stage-item.js --run <run-dir> --id <kind>-<n> --file <path> [--json <path>] [--help]
// Exit 0 on success (writes staged/<id><ext> — and, when --json was given,
// staged/<id>.json alongside it — echoes the written path(s) to stdout, one
// per line); 2 on a malformed invocation (missing/unsafe args, unreadable
// --file/--json, or --json content that isn't a JSON array); 3 when the run
// dir is missing or not anchored under the main checkout (a worktree-local
// shadow — _shared/pipeline-run-dir.md's Anchoring section, [IL-127]), or a
// staged file is unwritable. The printed path is the run dir's realpath,
// which can differ from the caller's --run input string (e.g. a /tmp path
// resolves to /private/tmp on macOS) — a caller string-matching stdout
// against its own $RUN_DIR should account for this.
// The staged/ half of #637 ("no CLI writes decisions.md or staged/ items");
// bin/log-decision.js is the decisions.md half, shipped under #686.
// `--json` (#2612) is the machine-readable sidecar render-tidy-report.js
// reads back — an array of `{tag, record, title, action, command}` objects,
// one per Approve-section row this staged item represents. Written in the
// same call as the item's own `.md`/`.patch` file so the two can never drift
// apart the way independently-composed prose and staged/ once did.
'use strict';

const fs = require('fs');
const { resolveTarget, sanitizeId, writeStagedItem, writeStagedSidecar } = require('./lib/stage-item/write');

const USAGE = 'usage: stage-item.js --run <run-dir> --id <kind>-<n> --file <path> [--json <path>] [--help]\n';

function parseArgs(argv) {
  const o = { run: null, id: null, file: null, json: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else if (a === '--id') o.id = next();
    else if (a === '--file') o.file = next();
    else if (a === '--json') o.json = next();
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
  const usageError = (message) => { deps.stderr(`stage-item.js: ${message}\n` + USAGE); return 2; };
  if (o.error) { deps.stderr(o.error + '\n' + USAGE); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.file) return usageError('--file <path> is required');
  const id = sanitizeId(o.id);
  if (!id) return usageError(`--id must be a plain filename stem (letters, digits, ., _, - — no path separators): ${JSON.stringify(o.id)}`);

  let content;
  try { content = deps.readFile(o.file); } catch (err) {
    deps.stderr(`stage-item.js: could not read --file ${o.file} (${err && err.message})\n`);
    return 2;
  }

  let jsonContent = null;
  if (o.json !== null) {
    let raw;
    try { raw = deps.readFile(o.json); } catch (err) {
      deps.stderr(`stage-item.js: could not read --json ${o.json} (${err && err.message})\n`);
      return 2;
    }
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch (err) {
      deps.stderr(`stage-item.js: --json ${o.json} is not valid JSON (${err && err.message})\n`);
      return 2;
    }
    if (!Array.isArray(parsed)) {
      deps.stderr(`stage-item.js: --json ${o.json} must contain a JSON array of items\n`);
      return 2;
    }
    jsonContent = raw;
  }

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`stage-item.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`stage-item.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`stage-item.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  let result;
  try { result = writeStagedItem({ runDir: target.dir, id, sourcePath: o.file, content }); } catch (err) {
    deps.stderr(`stage-item.js: could not write staged item (${err && err.message})\n`);
    return 3;
  }
  deps.stdout(result.file + '\n');

  if (jsonContent !== null) {
    let sidecar;
    try { sidecar = writeStagedSidecar({ runDir: target.dir, id, content: jsonContent }); } catch (err) {
      deps.stderr(`stage-item.js: could not write staged sidecar (${err && err.message})\n`);
      return 3;
    }
    deps.stdout(sidecar.file + '\n');
  }

  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
