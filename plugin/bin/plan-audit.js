#!/usr/bin/env node
// plugin/bin/plan-audit.js — mechanized plan audit (#903): Checks A/B/C/D
// plus a size-headroom check, replacing the hand-run prose procedure that used to
// live entirely in plugin/skills/build/plan-audit.md. Exit 0 iff every check
// is ok (a `nearCeiling` headroom flag alone does not fail). `--count-tasks`
// (#1926) is a read-only verb printing `{tasks, batched}` for /build's
// single-task fast-lane condition — it never runs the checks.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { parseArgs, UsageError, USAGE } = require('./lib/plan-audit/args');
const {
  extractFileEntries, extractScopeKeywords, extractVerificationChecks, extractUnparseableStep2s, countTasks,
} = require('./lib/plan-audit/parser');
const {
  checkA, checkB, checkC, checkD, headroomCheck,
} = require('./lib/plan-audit/checks');

function resolveRepoRoot(explicit, cwd) {
  if (explicit) return path.resolve(explicit);
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return cwd;
  }
}

function summaryLine(report) {
  const parts = [];
  if (!report.checkA.ok) parts.push(`Check A: ${report.checkA.missing.length} missing path(s)`);
  if (!report.checkB.ok) parts.push(`Check B: ${report.checkB.unplanned.length} unplanned file(s)`);
  if (!report.checkC.ok) parts.push(`Check C: ${report.checkC.findings.length} non-discriminating command(s)`);
  if (report.checkC.warnings.length) parts.push(`Check C: ${report.checkC.warnings.length} unparseable Step 2(s)`);
  if (report.checkC.appendShaped.length) parts.push(`Check C: ${report.checkC.appendShaped.length} append-shaped pre-run(s) accepted`);
  if (!report.checkD.ok) parts.push(`Control bytes: ${report.checkD.findings.length}${report.checkD.truncated ? '+' : ''}`);
  if (!report.headroom.ok) parts.push(`Headroom: ${report.headroom.breaches.length} breach(es)`);
  if (report.headroom.nearCeiling.length) parts.push(`Headroom: ${report.headroom.nearCeiling.length} near-ceiling`);
  const composedOver = report.headroom.composed.filter((c) => c.over > 0).length;
  if (composedOver) parts.push(`Composed: ${composedOver} over`);
  if (report.headroom.composedNearCeiling.length) parts.push(`Composed: ${report.headroom.composedNearCeiling.length} near-ceiling`);
  // Informational-but-visible (#1997): a composed call site this plan
  // touches that the tool could not measure (missing/unreadable source,
  // malformed marker) is never silenced into the same "no findings" bucket
  // as a call site that legitimately doesn't apply.
  if (report.headroom.composedErrors.length) parts.push(`Composed: ${report.headroom.composedErrors.length} unmeasured`);
  if (parts.length === 0) return 'plan-audit: clean — no findings.';
  return `plan-audit: ${parts.join('; ')}.`;
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n${USAGE}\n`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  let text;
  try {
    text = fs.readFileSync(parsed.planFile, 'utf8');
  } catch (err) {
    process.stderr.write(`plan-audit.js: cannot read plan file ${parsed.planFile}: ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (parsed.countTasks) {
    const { tasks, batched } = countTasks(text);
    if (tasks === 0) {
      process.stderr.write(`plan-audit.js: ${parsed.planFile} has no parseable tasks (no "### Task N:" heading)\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`{"tasks": ${tasks}, "batched": ${batched}}\n`);
    return;
  }

  // #2000: --bytes runs Check D alone (the one check Common Step 1.5's skip
  // gate doesn't cover) — no repo-root resolution or parsing needed.
  if (parsed.bytes) {
    const checkDResult = checkD(text);
    process.stdout.write(`${JSON.stringify({ checkD: checkDResult })}\n`);
    process.exitCode = checkDResult.ok ? 0 : 1;
    return;
  }

  const repoRoot = resolveRepoRoot(parsed.repoRoot, process.cwd());
  // #2000: Check D runs on the raw text before the parser — a byte scan on
  // text already in memory costs nothing.
  const checkDResult = checkD(text);
  const entries = extractFileEntries(text);
  const scopeKeywords = extractScopeKeywords(text);
  const verificationChecks = extractVerificationChecks(text);
  const unparseableStep2s = extractUnparseableStep2s(text);

  const report = {
    checkA: checkA(entries, repoRoot),
    checkB: checkB(scopeKeywords, entries.map((e) => e.path), repoRoot),
    checkC: checkC(verificationChecks, repoRoot, {}, unparseableStep2s),
    checkD: checkDResult,
    headroom: headroomCheck(entries, repoRoot),
  };

  // Compact JSON on its own first line (never pretty-printed — a caller
  // parsing stdout takes JSON.parse(stdout.split('\n')[0])), then the
  // human summary line.
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stdout.write(`${summaryLine(report)}\n`);

  const pass = report.checkA.ok && report.checkB.ok && report.checkC.ok && report.checkD.ok && report.headroom.ok;
  process.exitCode = pass ? 0 : 1;
}

main();
