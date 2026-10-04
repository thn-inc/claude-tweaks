#!/usr/bin/env node
// bin/set-verify-expectations.js — write or update verify-expectations.json
// in a run directory, the sanctioned path for a worktree-isolated session
// (#2764). The fourth of the sanctioned-write family: bin/log-decision.js
// (decisions.md), bin/stage-item.js (staged/), bin/set-config.js
// (config.yml), this (verify-expectations.json).
//   node bin/set-verify-expectations.js --run <run-dir> [--deferred <item>[,<item>...]]
//     [--issues <n>[,<n>...]] [--oversight-exempt <n>[,<n>...]] [--file <payload.json>] [--help]
// --run is the directory `wrap-up-engine.js verify --run-dir` will read:
// a single-spec run's own run dir, or a multi-spec run's per-spec
// `spec-{n}/` subdirectory ($PIPELINE_RUN_DIR in both cases).
// Read-modify-write: every field the call does not name is preserved.
//   (no field flags)     create the file with the version-1 defaults
//                        ({"version":1,"memory":[],"upstream":[]}) when it is
//                        absent; an existing file keeps its recorded fields.
//   --deferred           replace `deferred` (the multi-spec defer protocol's
//                        cleanup items).
//   --issues             replace `issues` (a run with no materialized header).
//   --oversight-exempt   add record numbers to `oversightExempt` (a union —
//                        the Oversight-floor gate records one at a time).
//   --file               a JSON object carrying any of memory, upstream,
//                        deferred, issues, oversightExempt — the path for
//                        `memory`/`upstream`, whose entries are objects. A key
//                        named by both --file and its flag is refused.
// Exit 0 on success (echoes the written file's path — the run dir's
// realpath, which can differ from the --run input string); 2 on a malformed
// invocation (missing --run, an unknown argument, a dangling or empty list
// value, a non-numeric record number, an unreadable/unparseable/non-object
// --file, an unknown or invalid field — nothing is written on this code);
// 3 when the run dir is missing or not anchored under the main checkout (a
// worktree-local shadow — _shared/pipeline-run-dir.md's Anchoring section,
// [IL-127]), or the file is unwritable. No exit 1, like its three siblings.
'use strict';

const fs = require('fs');
const { resolveTarget } = require('./lib/stage-item/write');
const { validateFields, writeExpectations } = require('./lib/verify-expectations/write');

const USAGE = 'usage: set-verify-expectations.js --run <run-dir> [--deferred <item>[,<item>...]] [--issues <n>[,<n>...]] [--oversight-exempt <n>[,<n>...]] [--file <payload.json>] [--help]\n';

// flag -> the verify-expectations.json field it sets.
const LIST_FLAGS = Object.freeze({
  '--deferred': 'deferred',
  '--issues': 'issues',
  '--oversight-exempt': 'oversightExempt',
});
const NUMERIC_FIELDS = new Set(['issues', 'oversightExempt']);

function parseArgs(argv) {
  const o = { run: null, lists: {}, file: null, sawFile: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else if (a === '--file') { o.sawFile = true; o.file = next(); }
    else if (Object.hasOwn(LIST_FLAGS, a)) o.lists[a] = next();
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
  const usageError = (message) => { deps.stderr(`set-verify-expectations.js: ${message}\n` + USAGE); return 2; };
  if (o.error) { deps.stderr(o.error + '\n' + USAGE); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');

  const fields = {};
  for (const [flag, raw] of Object.entries(o.lists)) {
    const key = LIST_FLAGS[flag];
    if (raw === null || raw.trim() === '') return usageError(`${flag} requires a comma-separated value`);
    const parts = raw.split(',').map((s) => s.trim());
    if (parts.includes('')) return usageError(`${flag} has an empty entry: ${JSON.stringify(raw)}`);
    if (NUMERIC_FIELDS.has(key)) {
      if (parts.some((p) => !/^\d+$/.test(p))) return usageError(`${flag} entries must be record numbers: ${JSON.stringify(raw)}`);
      fields[key] = parts.map(Number);
    } else {
      fields[key] = parts;
    }
  }

  if (o.sawFile) {
    if (!o.file) return usageError('--file requires a path');
    let raw;
    try { raw = deps.readFile(o.file); } catch (err) {
      return usageError(`could not read --file ${o.file} (${err && err.message})`);
    }
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (err) {
      return usageError(`--file ${o.file} is not valid JSON (${err && err.message})`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return usageError(`--file ${o.file} must contain a JSON object`);
    }
    for (const [key, value] of Object.entries(payload)) {
      if (Object.hasOwn(fields, key)) {
        const flag = Object.keys(LIST_FLAGS).find((f) => LIST_FLAGS[f] === key);
        return usageError(`"${key}" is given by both --file and ${flag}`);
      }
      fields[key] = value;
    }
  }

  const invalid = validateFields(fields);
  if (invalid) return usageError(invalid);

  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`set-verify-expectations.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`set-verify-expectations.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`set-verify-expectations.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  let result;
  try { result = writeExpectations({ runDir: target.dir, fields }); } catch (err) {
    deps.stderr(`set-verify-expectations.js: could not write verify-expectations.json (${err && err.message})\n`);
    return 3;
  }
  deps.stdout(result.file + '\n');
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
