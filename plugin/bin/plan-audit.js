#!/usr/bin/env node
// plugin/bin/plan-audit.js — mechanized plan audit (#903): Checks A/B/C/D
// plus a size-headroom check, replacing the hand-run prose procedure that used to
// live entirely in plugin/skills/build/plan-audit.md, and the warn-only Checks
// E (#3099, AC clause coverage) and F (#3602, spec-named path coverage) — both
// run only with `--spec`. Exit 0 iff every gating check is ok (a `nearCeiling`
// headroom flag, or any Check E or Check F entry, alone does not fail).
// `--count-tasks` (#1926) is a read-only verb printing `{tasks, batched}` for /build's
// single-task fast-lane condition — it never runs the checks. `--task-markers`
// (#3378) is the same kind of read-only verb, printing each task's per-task
// Role/Review-risk markers for dispatch.md's tier forwarding.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { parseArgs, UsageError, USAGE } = require('./lib/plan-audit/args');
const {
  extractFileEntries, extractScopeKeywords, extractPremiseRefs, extractVerificationChecks, extractUnparseableStep2s, countTasks,
  extractTaskMarkers,
} = require('./lib/plan-audit/parser');
const {
  checkA, checkB, checkC, checkD, checkE, checkF, headroomCheck, checkPremiseRefs, checkTaskMarkers,
} = require('./lib/plan-audit/checks');

function resolveRepoRoot(explicit, cwd) {
  if (explicit) return path.resolve(explicit);
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return cwd;
  }
}

function summaryLine(report) {
  const parts = [];
  if (!report.checkA.ok) parts.push(`Check A: ${report.checkA.missing.length} missing path(s)`);
  if (!report.checkB.ok) parts.push(`Check B: ${report.checkB.unplanned.length} unplanned file(s)`);
  if (!report.checkC.ok) parts.push(`Check C: ${report.checkC.findings.length} non-discriminating command(s)`);
  const unparseableCount = report.checkC.warnings.filter((w) => w.reason !== 'vcs-mutation-refusal').length;
  if (unparseableCount) parts.push(`Check C: ${unparseableCount} unparseable Step 2(s)`);
  const refusedCount = report.checkC.warnings.filter((w) => w.reason === 'vcs-mutation-refusal').length;
  if (refusedCount) parts.push(`Check C: ${refusedCount} VCS-mutation refusal(s)`);
  if (report.checkC.appendShaped.length) parts.push(`Check C: ${report.checkC.appendShaped.length} append-shaped pre-run(s) accepted`);
  if (!report.checkD.ok) parts.push(`Control bytes: ${report.checkD.findings.length}${report.checkD.truncated ? '+' : ''}`);
  if (!report.headroom.ok) parts.push(`Headroom: ${report.headroom.breaches.length} breach(es)`);
  if (report.headroom.nearCeiling.length) parts.push(`Headroom: ${report.headroom.nearCeiling.length} near rail`);
  const composedOver = report.headroom.composed.filter((c) => c.over > 0).length;
  if (composedOver) parts.push(`Composed: ${composedOver} over`);
  if (report.headroom.composedNearCeiling.length) parts.push(`Composed: ${report.headroom.composedNearCeiling.length} near rail`);
  // Informational-but-visible (#1997): a composed call site this plan
  // touches that the tool could not measure (missing/unreadable source,
  // malformed marker) is never silenced into the same "no findings" bucket
  // as a call site that legitimately doesn't apply.
  if (report.headroom.composedErrors.length) parts.push(`Composed: ${report.headroom.composedErrors.length} unmeasured`);
  if (!report.premiseRefs.ok) parts.push(`Premise-refs: ${report.premiseRefs.unresolved.length} unresolved`);
  // #3099: warn-only — named in the summary, never part of the pass verdict.
  if (!report.checkE.skipped) {
    if (report.checkE.uncovered.length) parts.push(`Check E: ${report.checkE.uncovered.length} uncovered AC clause(s)`);
    if (report.checkE.unparsed.length) parts.push(`Check E: ${report.checkE.unparsed.length} unparsed AC item(s)`);
  }
  // #3602: warn-only, like Check E.
  if (!report.checkF.skipped) {
    if (report.checkF.unlisted.length) parts.push(`Check F: ${report.checkF.unlisted.length} unlisted spec path(s)`);
    if (report.checkF.unparsed.length) parts.push(`Check F: ${report.checkF.unparsed.length} unparsed spec block(s)`);
    if (report.checkF.orphanWaivers.length) parts.push(`Check F: ${report.checkF.orphanWaivers.length} orphan path waiver(s)`);
  }
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

  // #3378: --task-markers reads this plan's per-task Role/Review-risk
  // markers (dispatch.md's forwarded-tier input) — a single-purpose,
  // read-only verb in the same family as --count-tasks, never running the
  // gating checks above. An unknown marker value is reported inline as a
  // `findings` entry (checkTaskMarkers, warn-only like Check E) rather than
  // failing the exit code — never a build-blocking defect on its own.
  if (parsed.taskMarkers) {
    const { markers, tasks } = extractTaskMarkers(text);
    if (tasks.length === 0) {
      process.stderr.write(`plan-audit.js: ${parsed.planFile} has no parseable tasks (no "### Task N:" heading)\n`);
      process.exitCode = 2;
      return;
    }
    const { findings } = checkTaskMarkers(text);
    const output = {
      markers,
      tasks: tasks.map((t) => ({ index: t.index, title: t.title, role: t.role, risk: t.risk })),
    };
    if (findings.length) output.findings = findings;
    process.stdout.write(`${JSON.stringify(output)}\n`);
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

  // #3099: an unreadable --spec is the same exit-2 file-read error as an
  // unreadable plan — never a silent fall back to `skipped: 'no-spec'`.
  let specText = null;
  if (parsed.spec !== null) {
    try {
      specText = fs.readFileSync(parsed.spec, 'utf8');
    } catch (err) {
      process.stderr.write(`plan-audit.js: cannot read spec file ${parsed.spec}: ${err.message}\n`);
      process.exitCode = 2;
      return;
    }
  }

  const repoRoot = resolveRepoRoot(parsed.repoRoot, process.cwd());
  // #2000: Check D runs on the raw text before the parser — a byte scan on
  // text already in memory costs nothing.
  const checkDResult = checkD(text);
  const entries = extractFileEntries(text);
  const scopeKeywords = extractScopeKeywords(text);
  const premiseRefs = extractPremiseRefs(text);
  const verificationChecks = extractVerificationChecks(text);
  const unparseableStep2s = extractUnparseableStep2s(text);
  // #3099: the audited plan file necessarily contains its own Scope
  // keywords line — add it to the planned set so Check B never reports
  // the plan on itself; a real unplanned file is unaffected.
  const plannedPaths = [...entries.map((e) => e.path), path.relative(repoRoot, path.resolve(parsed.planFile))];

  const report = {
    checkA: checkA(entries, repoRoot),
    checkB: checkB(scopeKeywords, plannedPaths, repoRoot),
    checkC: checkC(verificationChecks, repoRoot, {}, unparseableStep2s),
    checkD: checkDResult,
    headroom: headroomCheck(entries, repoRoot),
    premiseRefs: checkPremiseRefs(premiseRefs, repoRoot),
    checkE: specText === null ? { ok: true, skipped: 'no-spec' } : checkE(specText, text),
    checkF: specText === null ? { ok: true, skipped: 'no-spec' } : checkF(specText, text),
  };

  // Compact JSON on its own first line (never pretty-printed — a caller
  // parsing stdout takes JSON.parse(stdout.split('\n')[0])), then the
  // human summary line.
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stdout.write(`${summaryLine(report)}\n`);

  const pass = report.checkA.ok && report.checkB.ok && report.checkC.ok && report.checkD.ok && report.headroom.ok
    && report.premiseRefs.ok;
  process.exitCode = pass ? 0 : 1;
}

main();
