#!/usr/bin/env node
// bin/load-delta.js — per-invocation skill load delta (#3307). Thin CLI over
// bin/lib/skill-audit/load.js: computes each skill entry point's floor
// (SKILL.md bytes) and closure (floor + every transitively cited file) at
// the base and at the working tree, and prints the change. Review step 3j
// (skills/review/step3-skill-load-delta.md) runs it; it never gates.
//
// Usage: load-delta.js [--plugin-root <dir>]... [--base <ref>]
//                       [--integration-branch <name>] [--json] [--help]
//   --plugin-root  repeatable; the directory holding skills/ (default: every
//                  tracked skills/*/SKILL.md root at the repo root or one
//                  directory down — discoverPluginRoots)
//   --base         base commit-ish (default: merge-base of HEAD with
//                  origin/{integration-branch})
//   --integration-branch  the branch review Step 2 already resolved (`dev`
//                  or `origin/dev`); base = merge-base of HEAD with
//                  origin/{name}. Without it (and without --base), base is
//                  resolved via the shared resolver (worktree-reap.js's
//                  resolveIntegrationBranch: policy `integration-branch`,
//                  else origin/HEAD). If that resolves nothing, the result
//                  is no-baseline — never a guessed `main`
//                  (_shared/integration-branch.md).
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
const { resolveIntegrationBranch, bareIntegrationName } = require('./lib/hooks/worktree-reap');
const { toPosix, escapeRegExp, isPathContained } = require('./lib/shared-primitives');

const USAGE = 'usage: load-delta.js [--plugin-root <dir>]... [--base <ref>] [--integration-branch <name>] [--json] [--help]\n';

function parseArgs(argv) {
  const o = { pluginRoots: [], base: null, integrationBranch: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--plugin-root' || a === '--base' || a === '--integration-branch') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--base') o.base = v;
      else if (a === '--integration-branch') o.integrationBranch = v;
      else o.pluginRoots.push(v);
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

// git without -z C-quotes non-ASCII paths ("caf\303\251.md") and NUL is never
// a valid path byte, so -z + split on it is lossless where plain newline
// splitting is not (#3307 F3/F4).
const splitZ = (s) => s.split('\0').filter(Boolean);

const skillsPrefix = (root) => (root === '.' ? 'skills/' : `${root}/skills/`);
const SKILL_MD_UNDER = (root) => new RegExp(`^${escapeRegExp(skillsPrefix(root))}[^/]+/SKILL\\.md$`);

// The path segment(s) before "/skills/{name}/" in a changed-file path, for
// naming which directory holds skill files discovery/the touched-check could
// not account for. Returns '' for a bare repo-root "skills/{name}/..." path
// (no nameable parent — that path is already the "." root), or null when the
// path has no "skills/{name}/" segment at all.
function skillFileParent(f) {
  const nested = /^(.+?)\/skills\/[^/]+\//.exec(f);
  if (nested) return nested[1];
  return /^skills\/[^/]+\//.test(f) ? '' : null;
}

function firstNameableParent(files) {
  for (const f of files) {
    const p = skillFileParent(f);
    if (p) return p;
  }
  return null;
}

function headSide(repoRoot, root) {
  // A citation that passed withinRoot's textual check can still be a committed
  // symlink to a file outside the repository, or to a device (/dev/zero) that
  // never reaches EOF — so resolve the real path and read only a regular file
  // inside the repository; anything else is absent.
  const realRoot = fs.realpathSync(repoRoot);
  const readFile = (p) => {
    try {
      const real = fs.realpathSync(path.join(repoRoot, p));
      if (!isPathContained(real, realRoot) || !fs.statSync(real).isFile()) return null;
      return fs.readFileSync(real, 'utf8');
    } catch (err) {
      if (['ENOENT', 'EISDIR', 'ENOTDIR', 'ELOOP'].includes(err.code)) return null;
      throw err;
    }
  };
  const listSkillMds = () => {
    const dir = path.join(repoRoot, root, 'skills');
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${skillsPrefix(root)}${d.name}/SKILL.md`)
      .filter((p) => readFile(p) !== null);
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

function entryMark(r) {
  if (r.added) return ' (added)';
  if (r.removed) return ' (removed)';
  return '';
}

function newUnresolvedCell(list) {
  if (list.length === 0) return '—';
  const shown = list.slice(0, 3).map((u) => `\`${u.token}\``).join(', ');
  const ellipsis = list.length > 3 ? ', …' : '';
  return `${list.length}: ${shown}${ellipsis}`;
}

function renderText(result, changedFiles, { pluginRootsGiven = false } = {}) {
  if (result.roots.length === 0 && !pluginRootsGiven) {
    let line = 'Skill load delta: no plugin roots discovered — skipped (pass --plugin-root <dir>)';
    const parent = firstNameableParent(changedFiles);
    if (parent) line += ` — skill files changed under ${parent}`;
    return `${line}\n`;
  }
  if (result.status === 'no-baseline') {
    if (result.branchUnresolved) {
      return 'Skill load delta: no baseline (integration branch unresolved — pass --integration-branch) — skipped\n';
    }
    return `Skill load delta: no baseline (merge-base with ${result.baseRef} unresolved) — skipped\n`;
  }
  const rows = result.roots.flatMap((r) => r.entries);
  if (rows.length === 0) {
    const rootSet = new Set(result.roots.map((r) => r.pluginRoot));
    const outsideFiles = changedFiles.filter((f) => {
      const p = skillFileParent(f);
      if (p === null) return false;
      const root = p === '' ? '.' : p;
      return !rootSet.has(root);
    });
    const touchedInside = changedFiles.some((f) => result.roots.some((r) => f.startsWith(skillsPrefix(r.pluginRoot))));
    if (!touchedInside && outsideFiles.length === 0) return 'Skill load delta: no skill files changed — skipped\n';
    let line = 'Skill load delta: skill files changed, no entry point\'s load moved';
    const outsideParent = firstNameableParent(outsideFiles);
    if (outsideParent) line += ` (also changed outside discovered roots: ${outsideParent}; pass --plugin-root to measure)`;
    return `${line}\n`;
  }
  const headerBase = result.base.slice(0, 7);
  const header = result.baseKind === 'base'
    ? `Skill load delta (base ${headerBase} = --base ${result.baseLabel}):`
    : `Skill load delta (base ${headerBase} = merge-base with origin/${result.baseLabel}):`;
  const lines = [
    header,
    '',
    '| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const mark = entryMark(r);
    const miss = newUnresolvedCell(r.newUnresolved);
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
  const resolveBranch = deps.resolveIntegrationBranch || resolveIntegrationBranch;
  try {
    let repoRoot;
    try { repoRoot = rawGit(['-C', cwd, 'rev-parse', '--show-toplevel']).trim(); } catch {
      deps.stderr('load-delta.js: not inside a git work tree\n'); return 2;
    }
    const git = (args) => rawGit(['-C', repoRoot, ...args]);

    let roots;
    const pluginRootsGiven = o.pluginRoots.length > 0;
    if (pluginRootsGiven) {
      roots = [];
      for (const r of o.pluginRoots) {
        const abs = path.resolve(cwd, r);
        try { corpusDir(abs); } catch (err) { deps.stderr(`load-delta.js: ${err.message}\n`); return 3; }
        // Both sides through realpathSync: a symlinked cwd (macOS /var ->
        // /private/var) resolves, and separators are native (git prints C:/...).
        const real = fs.realpathSync(abs);
        if (!isPathContained(real, fs.realpathSync(repoRoot), { orEqual: true })) { deps.stderr(`load-delta.js: --plugin-root ${r} is outside the repository\n`); return 2; }
        roots.push(toPosix(path.relative(repoRoot, real)) || '.');
      }
      roots = [...new Set(roots)].sort();
    } else {
      const listed = splitZ(git(['ls-files', '-z', '--', ':(glob)skills/*/SKILL.md', ':(glob)*/skills/*/SKILL.md']));
      roots = discoverPluginRoots(() => listed);
    }

    let base = null;
    let baseRef = null;
    let baseKind;
    let baseLabel;
    let branchUnresolved = false;
    if (o.base) {
      baseKind = 'base';
      baseLabel = o.base;
      baseRef = o.base;
      try { base = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${o.base}^{commit}`]).trim(); } catch { base = ''; }
      if (!base) { deps.stderr(`load-delta.js: --base ${o.base} does not resolve to a commit\n`); return 2; }
    } else {
      baseKind = 'branch';
      let branchName;
      if (o.integrationBranch) {
        branchName = bareIntegrationName(o.integrationBranch);
      } else {
        const resolved = resolveBranch(repoRoot);
        branchName = resolved ? bareIntegrationName(resolved) : null;
      }
      if (!branchName) {
        branchUnresolved = true;
      } else {
        baseLabel = branchName;
        baseRef = `origin/${branchName}`;
        try { base = git(['merge-base', '--end-of-options', 'HEAD', baseRef]).trim() || null; } catch { base = null; }
      }
    }

    const heads = roots.map((root) => ({ root, rows: entryPointLoads(root, headSide(repoRoot, root)) }));
    let result;
    let changedFiles = [];
    if (!base) {
      result = {
        status: 'no-baseline', base: null, baseRef, baseKind, baseLabel, branchUnresolved,
        roots: heads.map((h) => ({ pluginRoot: h.root, entries: h.rows })),
      };
    } else {
      const baseFiles = new Set(splitZ(git(['ls-tree', '-r', '-z', '--name-only', '--full-tree', base])));
      result = {
        status: 'ok',
        base,
        baseKind,
        baseLabel,
        roots: heads.map((h) => ({
          pluginRoot: h.root,
          entries: loadDelta(entryPointLoads(h.root, baseSide(git, base, baseFiles, h.root)), h.rows),
        })),
      };
      changedFiles = [
        ...splitZ(git(['diff', '--name-only', '-z', '--no-renames', '--end-of-options', base])),
        ...splitZ(git(['ls-files', '--others', '--exclude-standard', '-z'])),
      ];
    }
    if (o.json) {
      const { baseRef: _baseRef, baseKind: _baseKind, baseLabel: _baseLabel, branchUnresolved: _branchUnresolved, ...json } = result;
      deps.stdout(`${JSON.stringify(json)}\n`);
    } else {
      deps.stdout(renderText(result, changedFiles, { pluginRootsGiven }));
    }
    return 0;
  } catch (err) {
    deps.stderr(`load-delta.js: ${(err && err.message) || err}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, renderText };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
