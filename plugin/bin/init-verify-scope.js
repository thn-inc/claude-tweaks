#!/usr/bin/env node
// plugin/bin/init-verify-scope.js — thin CLI over the verify-scope starter
// module (plugin/bin/lib/init/verify-scope-starter.js, #1924). Resolves the
// project's root package.json scripts, detects its workspace, and composes
// the proposed .claude-tweaks/verify-scope.json — printing it, and with
// --write creating it only when the file is absent (never overwriting an
// existing one). Consumed standalone and by /claude-tweaks:init Step 6.6.
// Shells out to nothing — pure fs reads/writes rooted at --root.
// Exit 0 on any valid invocation, including "nothing detected" (still
// prints the bookkeeping-only starter — deciding whether to *offer* it is
// the sub-file's job, not this CLI's); 2 malformed invocation (unknown
// flag, missing/malformed --root value, --root not a directory, --drift
// combined with --write).
// After the proposal (or, under --drift, the drift report), one
// `warning: skipped {glob|path} — {reason}` line prints to stderr per
// detectWorkspace `skipped` entry — a glob or directory the starter could
// not confidently turn into a package, surfaced rather than silently
// dropped (parse-signal-discipline). `--json` folds the same entries into a
// `skipped` array on the JSON payload.
// `--drift` reads the project's existing .claude-tweaks/verify-scope.json
// (via readDeclaration) and reports its drift against the live workspace,
// rather than proposing a fresh declaration: ok:false → its errors to
// stderr, exit 1; missing → `no declaration at {path}`, exit 0; otherwise a
// `drift: suites … not in workspace; packages … have no suite` line
// (JSON: {declared, missingSuites, extraSuites, skipped}), exit 0.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  detectWorkspace, composeStarter, diffAgainstWorkspace,
} = require('./lib/init/verify-scope-starter');
const { readDeclaration } = require('./lib/verify/declaration');

class UsageError extends Error {}

const USAGE = 'usage: init-verify-scope.js --root <dir> [--write | --drift] [--json]';

function parseArgs(argv) {
  let root = null;
  let write = false;
  let json = false;
  let drift = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--write') { write = true; continue; }
    if (flag === '--json') { json = true; continue; }
    if (flag === '--drift') { drift = true; continue; }
    if (flag === '--root') {
      const value = argv[i + 1];
      i++;
      if (value === undefined) throw new UsageError('--root requires a value');
      if (value.startsWith('--')) throw new UsageError('--root requires a directory value');
      root = value;
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }
  if (!root) throw new UsageError('--root <dir> is required');
  if (drift && write) throw new UsageError('--drift and --write are mutually exclusive');
  return {
    root, write, json, drift,
  };
}

function printSkippedWarnings(skipped) {
  for (const s of skipped || []) {
    process.stderr.write(`warning: skipped ${s.glob || s.path} — ${s.reason}\n`);
  }
}

function runDrift(root, targetPath, json) {
  const parsed = readDeclaration(targetPath);
  if (!parsed.ok) {
    for (const err of parsed.errors) process.stderr.write(`${err}\n`);
    process.exitCode = 1;
    return;
  }
  if (parsed.missing) {
    if (json) process.stdout.write(`${JSON.stringify({ declared: false })}\n`);
    else process.stdout.write(`no declaration at ${targetPath}\n`);
    process.exitCode = 0;
    return;
  }
  const workspace = detectWorkspace({ root });
  const { missingSuites, extraSuites } = diffAgainstWorkspace(parsed.decl, workspace);
  const skipped = workspace.skipped || [];
  if (json) {
    process.stdout.write(`${JSON.stringify({
      declared: true, missingSuites, extraSuites, skipped,
    })}\n`);
  } else {
    const extra = extraSuites.length ? extraSuites.join(', ') : 'none';
    const missing = missingSuites.length ? missingSuites.join(', ') : 'none';
    process.stdout.write(`drift: suites ${extra} not in workspace; packages ${missing} have no suite\n`);
  }
  printSkippedWarnings(skipped);
  process.exitCode = 0;
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    process.stderr.write(`init-verify-scope.js: ${err.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const root = path.resolve(parsed.root);
  let rootStat = null;
  try { rootStat = fs.statSync(root); } catch { /* doesn't exist, or unreadable */ }
  if (!rootStat || !rootStat.isDirectory()) {
    process.stderr.write(`init-verify-scope.js: --root is not a directory: ${parsed.root}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const targetPath = path.join(root, '.claude-tweaks', 'verify-scope.json');

  if (parsed.drift) {
    runDrift(root, targetPath, parsed.json);
    return;
  }

  // detectWorkspace reads the root package.json once and returns its scripts
  // as rootScripts — composeStarter defaults to them (no second read here).
  const workspace = detectWorkspace({ root });
  const decl = composeStarter({ workspace });

  let existed = false;
  try { existed = fs.existsSync(targetPath); } catch { /* treat an unreadable path as not existing */ }
  let written = false;
  if (parsed.write && !existed) {
    fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
    try {
      // wx: create-only. A concurrent creator winning the race between the
      // existsSync check above and this write surfaces as EEXIST, which we
      // fold into "already existed" rather than clobbering it.
      fs.writeFileSync(targetPath, `${JSON.stringify(decl, null, 2)}\n`, { flag: 'wx' });
      written = true;
    } catch (err) {
      if (err && err.code === 'EEXIST') existed = true;
      else throw err;
    }
  }

  const skipped = workspace.skipped || [];
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify({
      declaration: decl, written, existed, path: targetPath, skipped,
    })}\n`);
  } else {
    process.stdout.write('Proposed .claude-tweaks/verify-scope.json:\n');
    process.stdout.write(`${JSON.stringify(decl, null, 2)}\n`);
    if (existed) process.stdout.write(`exists: ${targetPath} (left unchanged)\n`);
    else if (written) process.stdout.write(`written: ${targetPath}\n`);
    else process.stdout.write('not written (pass --write)\n');
  }
  printSkippedWarnings(skipped);
  process.exitCode = 0;
}

module.exports = { parseArgs, UsageError };

if (require.main === module) main();
