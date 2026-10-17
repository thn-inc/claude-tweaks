#!/usr/bin/env node
// bin/load-delta.js — per-invocation skill load delta (#3307). Thin CLI over
// bin/lib/skill-audit/load.js: computes each skill entry point's floor
// (SKILL.md bytes) and closure (floor + every transitively cited file) at
// the base and at the working tree, and prints the change. Review step 3j
// (skills/review/step3-skill-load-delta.md) runs it; it never gates.
//
// Usage: load-delta.js [--plugin-root <dir>]... [--base <ref>] [--json] [--help]
//   --plugin-root  repeatable; the directory holding skills/ (default: every
//                  tracked skills/*/SKILL.md root at the repo root or one
//                  directory down — discoverPluginRoots)
//   --base         base commit-ish (default: merge-base of HEAD with
//                  origin/{integration-branch}: policy `integration-branch`,
//                  else origin/HEAD, else main — _shared/integration-branch.md)
//   --json         one JSON line instead of the rendered outcome
// Base content comes from `git show <sha>:<path>`; nothing is checked out.
// Exit: 0 success (including status no-baseline); 2 malformed invocation or
// an explicit --base that does not resolve; 3 a --plugin-root with no
// skills/; 1 an unexpected error.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { discoverPluginRoots, entryPointLoads, loadDelta } = require('./lib/skill-audit/load');
const { corpusDir } = require('./lib/skill-audit/context-cost');
const { readIntegrationBranch } = require('./lib/policy');
const { toPosix, escapeRegExp } = require('./lib/shared-primitives');

const USAGE = 'usage: load-delta.js [--plugin-root <dir>]... [--base <ref>] [--json] [--help]\n';

function parseArgs(argv) {
  const o = { pluginRoots: [], base: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--plugin-root' || a === '--base') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--base') o.base = v; else o.pluginRoots.push(v);
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

function defaultGit(cwd) {
  return (args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
};

const skillsPrefix = (root) => (root === '.' ? 'skills/' : `${root}/skills/`);
const SKILL_MD_UNDER = (root) => new RegExp(`^${escapeRegExp(skillsPrefix(root))}[^/]+/SKILL\\.md$`);

function headSide(repoRoot, root) {
  const readFile = (p) => {
    try { return fs.readFileSync(path.join(repoRoot, p), 'utf8'); } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR') return null;
      throw err;
    }
  };
  const listSkillMds = () => {
    const dir = path.join(repoRoot, root, 'skills');
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
      .map((d) => `${skillsPrefix(root)}${d.name}/SKILL.md`);
  };
  return { readFile, listSkillMds };
}

function baseSide(git, sha, baseFiles, root) {
  const re = SKILL_MD_UNDER(root);
  return {
    // A path absent from the base tree is "did not exist at base" (null → 0
    // bytes), decided from the ls-tree set, never from a swallowed git error.
    readFile: (p) => (baseFiles.has(p) ? git(['show', '--end-of-options', `${sha}:${p}`]) : null),
    listSkillMds: () => [...baseFiles].filter((p) => re.test(p)),
  };
}

const fmt = (n) => n.toLocaleString('en-US');
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));

function renderText(result, changedFiles) {
  if (result.status === 'no-baseline') {
    return `Skill load delta: no baseline (merge-base with ${result.baseRef} unresolved) — skipped\n`;
  }
  const rows = result.roots.flatMap((r) => r.entries);
  if (rows.length === 0) {
    const touched = changedFiles.some((f) => result.roots.some((r) => f.startsWith(skillsPrefix(r.pluginRoot))));
    return touched
      ? 'Skill load delta: skill files changed, no entry point\'s load moved\n'
      : 'Skill load delta: no skill files changed — skipped\n';
  }
  const lines = [
    `Skill load delta (base ${result.base.slice(0, 7)}):`,
    '',
    '| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const mark = r.added ? ' (added)' : r.removed ? ' (removed)' : '';
    const miss = r.newUnresolved.length
      ? `${r.newUnresolved.length}: ${r.newUnresolved.slice(0, 3).map((u) => `\`${u.token}\``).join(', ')}${r.newUnresolved.length > 3 ? ', …' : ''}`
      : '—';
    lines.push(`| ${r.entry}${mark} | ${fmt(r.floor)} | ${signed(r.dFloor)} | ${fmt(r.closure)} | ${signed(r.dClosure)} | ${miss} |`);
  }
  return `${lines.join('\n')}\n`;
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`load-delta.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  const cwd = deps.cwd || process.cwd();
  const rawGit = deps.git || defaultGit(cwd);
  const readBranch = deps.readIntegrationBranch || readIntegrationBranch;
  try {
    let repoRoot;
    try { repoRoot = rawGit(['-C', cwd, 'rev-parse', '--show-toplevel']).trim(); } catch {
      deps.stderr('load-delta.js: not inside a git work tree\n'); return 2;
    }
    const git = (args) => rawGit(['-C', repoRoot, ...args]);

    let roots;
    if (o.pluginRoots.length) {
      roots = [];
      for (const r of o.pluginRoots) {
        const abs = path.resolve(cwd, r);
        try { corpusDir(abs); } catch (err) { deps.stderr(`load-delta.js: ${err.message}\n`); return 3; }
        // realpath: git prints the resolved toplevel, so a symlinked cwd
        // (macOS /var -> /private/var) must be resolved before comparing.
        const rel = toPosix(path.relative(repoRoot, fs.realpathSync(abs))) || '.';
        if (rel.startsWith('..') || path.isAbsolute(rel)) { deps.stderr(`load-delta.js: --plugin-root ${r} is outside the repository\n`); return 2; }
        roots.push(rel);
      }
      roots = [...new Set(roots)].sort();
    } else {
      const listed = git(['ls-files', '--', ':(glob)skills/*/SKILL.md', ':(glob)*/skills/*/SKILL.md']);
      roots = discoverPluginRoots(() => listed.split('\n').filter(Boolean));
    }

    let base = null;
    let baseRef;
    if (o.base) {
      baseRef = o.base;
      try { base = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${o.base}^{commit}`]).trim(); } catch { base = ''; }
      if (!base) { deps.stderr(`load-delta.js: --base ${o.base} does not resolve to a commit\n`); return 2; }
    } else {
      let branch = readBranch(repoRoot);
      if (!branch) {
        try { branch = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).trim().replace(/^origin\//, ''); } catch { branch = ''; }
      }
      baseRef = `origin/${branch || 'main'}`;
      try { base = git(['merge-base', 'HEAD', baseRef]).trim() || null; } catch { base = null; }
    }

    const heads = roots.map((root) => ({ root, rows: entryPointLoads(root, headSide(repoRoot, root)) }));
    let result;
    let changedFiles = [];
    if (!base) {
      result = { status: 'no-baseline', base: null, baseRef, roots: heads.map((h) => ({ pluginRoot: h.root, entries: h.rows })) };
    } else {
      const baseFiles = new Set(git(['ls-tree', '-r', '--name-only', '--full-tree', base]).split('\n').filter(Boolean));
      result = {
        status: 'ok',
        base,
        roots: heads.map((h) => ({
          pluginRoot: h.root,
          entries: loadDelta(entryPointLoads(h.root, baseSide(git, base, baseFiles, h.root)), h.rows),
        })),
      };
      changedFiles = git(['diff', '--name-only', '--end-of-options', base]).split('\n').filter(Boolean);
    }
    if (o.json) {
      const { baseRef: _omit, ...json } = result;
      deps.stdout(`${JSON.stringify(json)}\n`);
    } else {
      deps.stdout(renderText(result, changedFiles));
    }
    return 0;
  } catch (err) {
    deps.stderr(`load-delta.js: ${(err && err.message) || err}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, renderText };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
