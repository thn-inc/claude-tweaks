#!/usr/bin/env node
// bin/render-tidy-report.js — renders a tidy report's Approve section
// directly from staged/*.json sidecars (#2612).
//
//   node bin/render-tidy-report.js --run <run-dir> [--help]
//
// Reads every staged/*.json sidecar under <run-dir> (this repo's own
// bin/lib/render-tidy-report/render.js — collectStagedItems, file-then-item
// order) and prints the rendered **Approve (N)** section (header + fenced
// text) to stdout. Prints nothing (empty stdout, exit 0) when nothing is
// staged — step-6-auto.md's Report rules omit the Approve block entirely in
// that case; this CLI only renders, it never decides the omission.
//
// step-6-auto.md's Step 6 invokes this and uses its output verbatim for
// both report.md and report-condensed.md, replacing the independently
// hand-composed Approve prose that could previously drift from staged/'s
// actual contents (#2612's root cause). approve-mode.md's "Re-entering the
// Approve rendering" step reuses this same CLI.
//
// Exit codes: 0 rendered (or nothing to render) / 2 malformed invocation
// (missing --run, or an unrecognized flag) / 3 a staged/*.json sidecar
// exists but is unreadable, not valid JSON, or not a JSON array — a corrupt
// sidecar must fail the render loudly, never silently under-report the
// Approve section.
'use strict';

const { collectStagedItems, renderApproveSection } = require('./lib/render-tidy-report/render');

const USAGE = 'usage: render-tidy-report.js --run <run-dir> [--help]\n';

function parseArgs(argv) {
  const o = { run: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  collectStagedItems,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`render-tidy-report.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) { deps.stderr(`render-tidy-report.js: --run <run-dir> is required\n${USAGE}`); return 2; }

  let items;
  try {
    items = deps.collectStagedItems(o.run);
  } catch (err) {
    deps.stderr(`render-tidy-report.js: ${err && err.message}\n`);
    return 3;
  }

  const section = renderApproveSection(items);
  if (section) deps.stdout(`${section}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
