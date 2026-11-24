#!/usr/bin/env node
// record-graph CLI: render — the only command. Reads an already-fetched
// faceted-record JSON file (produced by _shared/record-queue-fetch.md's
// existing fetch procedure) and deterministically emits D2 or SVG source.
// No gh/network I/O happens in this file — see bin/lib/record-graph/*.js.
// Exports { run, realDeps, parseArgs }: run(argv, deps) returns the exit code and
// reaches the outside world only through deps (stdout, stderr, cwd, now) — the
// entry contract is .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md.
'use strict';

const fs = require('fs');
const { fsPath } = require('./lib/health-core/io');
const { buildGraph } = require('./lib/record-graph/layout');
const { renderD2 } = require('./lib/record-graph/render-d2');
const { renderSvg } = require('./lib/record-graph/render-svg');

function parseArgs(argv, { now } = realDeps) {
  const args = { _: [], generatedAt: now().toISOString() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format') args.format = argv[++i];
    else if (a === '--work-links') args.workLinks = argv[++i];
    // Kept as the raw string so cmdRender can tell "flag absent" (fine — truncation
    // detection is simply off) apart from "flag present but unparseable" (an error).
    else if (a === '--fetch-limit') args.fetchLimitRaw = String(argv[++i]);
    else if (a === '--generated-at') args.generatedAt = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else args._.push(a);
  }
  return args;
}

function cmdRender(args, d) {
  const jsonPath = args._[0];
  if (!jsonPath) {
    d.stderr('render: missing <faceted-json-path>\n');
    return 2;
  }
  if (args.format !== 'd2' && args.format !== 'svg') {
    d.stderr('render: --format must be "d2" or "svg"\n');
    return 2;
  }
  if (args.workLinks !== 'native' && args.workLinks !== 'body-text') {
    d.stderr('render: --work-links must be "native" or "body-text"\n');
    return 2;
  }
  let fetchLimit;
  if (args.fetchLimitRaw !== undefined) {
    fetchLimit = Number(args.fetchLimitRaw);
    if (!Number.isFinite(fetchLimit)) {
      d.stderr(`render: --fetch-limit must be a number (got "${args.fetchLimitRaw}")\n`);
      return 2;
    }
  }
  let records;
  try {
    records = JSON.parse(fs.readFileSync(fsPath(d, jsonPath), 'utf8'));
  } catch (e) {
    d.stderr(`render: could not read faceted-record JSON at ${jsonPath} — ${e.message}\n`);
    return 2;
  }
  if (!Array.isArray(records)) {
    d.stderr(`render: expected an array of faceted records at ${jsonPath}\n`);
    return 2;
  }
  const truncated = Number.isFinite(fetchLimit) && records.length === fetchLimit;
  const graph = buildGraph(records, { workLinks: args.workLinks, truncated });
  const output = args.format === 'd2'
    ? renderD2(graph, { generatedAt: args.generatedAt })
    : renderSvg(graph, { generatedAt: args.generatedAt });

  if (args.out) {
    fs.writeFileSync(fsPath(d, args.out), output);
    const omitted = graph.edgesOmitted ? ', edges omitted' : '';
    d.stderr(`render: wrote ${args.out} (${records.length} records, ${graph.edges.length} edges${omitted})\n`);
  } else {
    d.stdout(output);
  }
  return 0;
}

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1), d);
  if (cmd === 'render') return cmdRender(args, d);
  d.stderr(`record-graph: unknown command "${cmd}" (expected: render)\n`);
  return 2;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  now: () => new Date(),
};

module.exports = { run, realDeps, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
