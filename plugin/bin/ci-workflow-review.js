#!/usr/bin/env node
// plugin/bin/ci-workflow-review.js — /claude-tweaks:init's report-only review
// of a project's GitHub Actions PR workflows (#5162), a thin CLI over
// plugin/bin/lib/init/ci-workflow-review.js. Shells out to nothing, reads only
// `.github/workflows/*.y{a,}ml` and `.claude-tweaks/verify-scope.json` under
// --root (each realpath-contained in the checkout), and never writes.
// Output: `--json` (with or without --drift) is one line
// `{reviewed, findings, unparsed}`; text is a markdown table, or under --drift
// one line per finding / unparsed workflow; both end with a `findings: {n}`
// summary that never reads clean while any workflow is unparsed.
// Exit vocabulary is Payload-1/Invocation-2, the same 0/1/2 split
// init-verify-scope.js --drift uses: 0 report printed, findings or not (a
// per-file read failure is an `unparsed` entry); 1 an invalid
// verify-scope.json, or a .github/workflows that exists but cannot be read as
// a directory (reason on stderr, stdout empty); 2 usage.
'use strict';

const fs = require('fs');
const path = require('path');
const { lstatType, resolveLeaf } = require('./lib/path-guard');
const {
  reviewWorkflows, formatRemedy, readWorkflowSet, readCiSources, guardOpts,
} = require('./lib/init/ci-workflow-review');

const USAGE = 'usage: ci-workflow-review.js --root <dir> [--drift] [--json]';

class UsageError extends Error {}

function parseArgs(argv) {
  let root = null;
  let drift = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--drift') { drift = true; continue; }
    if (flag === '--json') { json = true; continue; }
    if (flag === '--root') {
      const value = argv[i + 1];
      i++;
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) {
        throw new UsageError('--root requires a directory value');
      }
      root = value;
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }
  if (root === null) throw new UsageError('--root <dir> is required');
  return { root, drift, json };
}

// Every repo-supplied value a text line prints (a workflow file name, a job id,
// a verify-scope.json suite or job) goes through `oneLine` first: a control
// character (C0, DEL or C1, NEL included) or U+2028/U+2029 is printed as an
// escape, so a value carrying a line break can never forge another report line
// (a fake `findings: 0`). --json is already escaped by JSON.stringify.
const oneLine = (s) => String(s).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, (c) => {
  if (c === '\n') return '\\n';
  if (c === '\r') return '\\r';
  if (c === '\t') return '\\t';
  return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
});
const cell = (s) => oneLine(s).replace(/\|/g, '\\|');

function summaryLine(findings, unparsed) {
  return unparsed.length === 0
    ? `findings: ${findings.length}`
    : `findings: ${findings.length} — not clean: ${unparsed.length} workflow(s) unparsed`;
}

function textReport({ reviewed, findings, unparsed, skipped }) {
  const lines = [`ci-workflow-review: reviewed ${reviewed} workflow(s) under .github/workflows (report-only, nothing written)`];
  if (findings.length + unparsed.length > 0) {
    lines.push('| Workflow | Check | Detail | Remedy |', '|---|---|---|---|');
    for (const f of findings) {
      lines.push(`| \`${cell(f.workflow)}\` | \`${f.check}\` | ${cell(f.detail)} | ${cell(formatRemedy(f.remedy))} |`);
    }
    for (const u of unparsed) lines.push(`| \`${cell(u.workflow)}\` | \`unparsed\` | ${cell(u.reason)} | — |`);
  }
  for (const s of skipped) lines.push(`skipped ${s} — Step 16 classifies it`);
  lines.push(summaryLine(findings, unparsed));
  return lines;
}

function driftReport({ findings, unparsed }) {
  return [
    ...findings.map((f) => `ci-workflow-review: ${oneLine(f.workflow)} — ${f.check}: ${oneLine(f.detail)} (remedy: ${formatRemedy(f.remedy)})`),
    ...unparsed.map((u) => `ci-workflow-review: ${oneLine(u.workflow)} unparsed — ${oneLine(u.reason)}`),
    summaryLine(findings, unparsed),
  ];
}

// `realpath` is absent here: path-guard then uses its own default, and a test
// injects one to reach it.
const realDeps = {
  cwd: () => process.cwd(),
  fsImpl: fs,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const { stdout, stderr, fsImpl } = deps;
  const guard = guardOpts(fsImpl, deps.realpath);

  if (argv.includes('--help')) {
    try { stdout(`${USAGE}\n`); return 0; } catch (_err) { return 1; }
  }

  try {
    let parsed;
    try {
      parsed = parseArgs(argv);
    } catch (err) {
      if (!(err instanceof UsageError)) throw err;
      stderr(`ci-workflow-review.js: ${err.message}\n${USAGE}\n`);
      return 2;
    }

    // A relative --root resolves against the injected cwd, never the process's.
    const root = path.resolve(deps.cwd(), parsed.root);
    const leaf = resolveLeaf(root, guard);
    if (lstatType(leaf.state === 'resolved' ? leaf.path : root, { fsImpl }).type !== 'directory') {
      stderr(`ci-workflow-review.js: --root is not a directory: ${parsed.root}\n${USAGE}\n`);
      return 2;
    }

    const decl = readCiSources(root, guard);
    const set = readWorkflowSet(root, guard);
    const errors = [...(decl.ok ? [] : decl.errors), ...(set.ok ? [] : [set.error])];
    if (errors.length > 0) {
      for (const e of new Set(errors)) stderr(`ci-workflow-review.js: ${e}\n`);
      return 1;
    }

    const result = reviewWorkflows({ workflows: set.workflows, ciSources: decl.ciSources });
    if (parsed.json) {
      const { reviewed, findings, unparsed } = result;
      stdout(`${JSON.stringify({ reviewed, findings, unparsed })}\n`);
    } else {
      stdout(`${(parsed.drift ? driftReport(result) : textReport(result)).join('\n')}\n`);
    }
    return 0;
  } catch (err) {
    try { stderr(`ci-workflow-review.js: ${(err && err.message) || String(err)}\n`); } catch (_e) { /* stderr itself failed */ }
    return 1;
  }
}

module.exports = { run, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
