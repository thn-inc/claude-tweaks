#!/usr/bin/env node
// bin/reachability-audit.js
//
// Standalone CLI for the reachability-audit lens (#2674):
// bin/lib/issues/reachability-audit.js's auditSkillManifest /
// auditMcpServerConfig, run against a real SKILL.md file or MCP server
// config with no other side effects (no network, no mutation — a static
// manifest read only). The primary caller is
// skills/assess-agent-autonomy/grant-check.md's Step 1 (Gather), via `node
// -e` against the lib module directly; this CLI exists so the lens is also
// independently runnable and testable as its own command, per the
// Acceptance Criteria's "runs standalone" requirement.
//
// Usage:
//   reachability-audit.js --skill <path-to-SKILL.md>
//   reachability-audit.js --mcp-server <path-to-json> [--server-name <name>]
//
// `--mcp-server`'s JSON file is either a bare single-server entry
// ({command, args, env}) or a `.mcp.json`-shaped collection
// ({mcpServers: {name: {...}}}) — `--server-name` selects which key to
// audit from a collection; omit it when the file has exactly one entry.
//
// Success: exit 0 (clean) or 1 (flags raised) with one JSON result object on
// stdout — printed either way, since "fails closed" means the flagged/
// unreadable outcome is reported, never silenced. Exit 2 (usage error —
// unknown/missing flag, file does not exist, or an ambiguous/absent
// `--server-name` against a multi-server collection) prints nothing to
// stdout and a message to stderr instead: that is an invocation mistake,
// not an audit outcome.
'use strict';
const fs = require('fs');
const path = require('path');
const {
  auditSkillManifest, auditMcpServerConfig,
} = require('./lib/issues/reachability-audit.js');
const { fsPath } = require('./lib/health-core/io.js');

const USAGE = 'usage: reachability-audit.js --skill <path> | --mcp-server <path> [--server-name <name>]';

// argv is process.argv.slice(2). Returns the exit code; every output goes through deps.
function run(argv, deps = realDeps) {
  const fail = (msg) => {
    deps.stderr(`reachability-audit: ${msg}\n`);
    return 2;
  };
  // Reads a relative path against deps.cwd(); a thrown fs error names the joined path, so
  // swap it back to the spelling the caller typed. An absolute path never reads deps.cwd(),
  // so it still works from a deleted working directory.
  const read = (p) => {
    const resolved = fsPath(deps, p);
    try {
      return deps.readFile(resolved);
    } catch (err) {
      if (typeof err.message === 'string') err.message = err.message.split(resolved).join(p);
      throw err;
    }
  };
  // The path a failure message names: path.resolve of an absolute path needs no cwd.
  const shown = (p) => path.resolve(fsPath(deps, p));

  const args = argv.slice();
  const opts = {};
  while (args.length) {
    const arg = args.shift();
    switch (arg) {
      case '--skill': opts.skill = args.shift(); break;
      case '--mcp-server': opts.mcpServer = args.shift(); break;
      case '--server-name': opts.serverName = args.shift(); break;
      default: return fail(`unknown argument: ${arg}\n${USAGE}`);
    }
  }
  if (!opts.skill && !opts.mcpServer) return fail(USAGE);
  if (opts.skill && opts.mcpServer) return fail(`pass only one of --skill / --mcp-server\n${USAGE}`);

  let result;
  if (opts.skill) {
    let content;
    try {
      content = read(opts.skill);
    } catch (err) {
      return fail(`cannot read --skill path: ${shown(opts.skill)} (${err.code || err.message})`);
    }
    result = auditSkillManifest(content);
  } else {
    let parsed;
    try {
      parsed = JSON.parse(read(opts.mcpServer));
    } catch (err) {
      return fail(`cannot read/parse --mcp-server path: ${shown(opts.mcpServer)} (${err.message})`);
    }
    let entry = parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.mcpServers) {
      const names = Object.keys(parsed.mcpServers);
      const name = opts.serverName || (names.length === 1 ? names[0] : undefined);
      if (!name) return fail(`--mcp-server file has ${names.length} servers — pass --server-name to pick one`);
      if (!parsed.mcpServers[name]) return fail(`no server named "${name}" in --mcp-server file`);
      entry = parsed.mcpServers[name];
    }
    result = auditMcpServerConfig(entry);
  }

  deps.stdout(`${JSON.stringify(result)}\n`);
  return result.clean ? 0 : 1;
}

const realDeps = {
  cwd: () => process.cwd(),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

module.exports = { run, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
