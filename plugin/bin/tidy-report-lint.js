#!/usr/bin/env node
// bin/tidy-report-lint.js — mechanical conformance linter for a rendered
// tidy report (plugin/skills/tidy/step-6-auto.md's "Conformance scan"
// section, #731). Reads a rendered report from stdin or a path argument and
// emits one line per failing conformance row, following the same
// prose-rule-to-mechanical-check pattern bin/residue.js and the skill-audit
// modules (bin/lib/skill-audit/) already establish in this repo.
//
// This is the mechanical HALF of that conformance scan, not a replacement
// for it — the row-by-row check logic lives in
// ./lib/tidy-report-lint/rules.js, named after the table's own `Rule`
// column so the two stay greppable against each other. That file's header
// documents the two rows ("Command alone", "Batch only where allowed") that
// are necessarily heuristic rather than fully mechanical.
//
// Shells out to nothing (no `gh`, no `git`) — this CLI reads only the text
// it is given.
//
// `--surface=condensed|full` (#1625): when the condense rule fires, the
// report splits into two texts — a condensed chat render and the full
// `report.md` — and step-6-auto.md's Conformance scan intro documents a
// different 7/6 rule subset for each (see rules.js's RULES `surface` tags).
// Pass the matching flag when linting either half; omit it (the default)
// when linting a single, un-split report — the case where the condense rule
// never fired and all 13 rules apply together, as before this flag existed.
//
// Exit codes: 0 conformant (no issues, nothing printed), 1 non-conformant
// (issues printed to stdout, one per line), 2 malformed invocation (bad
// args, unreadable path, bad --surface value, or no stdin available).
//
// Approve-section shape vs. bin/render-tidy-report.js (#2612): the Approve
// block's three-line-per-item shape is now guaranteed by construction —
// render-tidy-report.js renders it directly from staged/*.json sidecars, so
// it cannot itself produce a non-conformant Approve section. None of the 13
// rows below duplicate that guarantee (Titles/Width/One-record-per-row apply
// report-wide, not to Approve specifically), so nothing here needed removing
// or repointing when that renderer shipped — verified directly: a
// renderer-produced Approve section embedded in a full report still passes
// this linter unchanged (tests/bin-lib/render-tidy-report/cli.test.js).
'use strict';

const fs = require('node:fs');
const { lintReport, SURFACES } = require('./lib/tidy-report-lint/rules');

const USAGE =
  'usage: tidy-report-lint.js [--surface=condensed|full] [path]  (reads stdin when no path is given)\n';

function run(argv, deps) {
  if (argv.includes('--help') || argv.includes('-h')) {
    deps.stdout(USAGE);
    return 0;
  }

  const positional = [];
  let surface;
  for (const arg of argv) {
    const m = /^--surface=(.*)$/.exec(arg);
    if (m) {
      surface = m[1];
      continue;
    }
    positional.push(arg);
  }
  if (surface !== undefined && !SURFACES.has(surface)) {
    deps.stderr(`tidy-report-lint.js: --surface must be "condensed" or "full" (got "${surface}")\n${USAGE}`);
    return 2;
  }
  if (positional.length > 1) {
    deps.stderr(USAGE);
    return 2;
  }

  let text;
  try {
    if (positional.length === 1) {
      text = deps.readFileSync(positional[0], 'utf8');
    } else {
      if (deps.stdinIsTTY()) {
        deps.stderr(`tidy-report-lint.js: no path given and stdin is a terminal\n${USAGE}`);
        return 2;
      }
      text = deps.readFileSync(0, 'utf8');
    }
  } catch (err) {
    deps.stderr(`tidy-report-lint.js: ${err.message}\n`);
    return 2;
  }

  const issues = lintReport(text, { surface });
  for (const issue of issues) deps.stdout(`${issue}\n`);
  return issues.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2), {
    readFileSync: fs.readFileSync,
    stdinIsTTY: () => Boolean(process.stdin.isTTY),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
}

module.exports = { run };
