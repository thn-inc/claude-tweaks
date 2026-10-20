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
const { discoverPluginRoots, entryPointLoads, loadDelta, walkCitable } = require('./lib/skill-audit/load');
const { readdirUnder } = require('./lib/skill-audit/citable-readdir');
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

// Separate from defaultGit: a batch-mode `git cat-file --batch` call pipes
// stdin and must come back as a Buffer (its output is binary-framed, see
// parseBatchOutput below), never the utf8-decoded string every other git
// call in this file returns. deps.gitBatch is the injectable seam for it,
// mirroring deps.git without overloading that one runner's return type.
function defaultGitBatch(cwd) {
  return (args, input) => execFileSync('git', args, {
    cwd, input, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
}

// Parses `git cat-file --batch`'s streamed stdout: one header line per fed
// object, in input order — `{oid} {type} {size}\n` for a resolved object,
// `{object} missing\n` for one that doesn't exist at that sha — followed,
// only for a resolved object, by exactly `{size}` content bytes and one
// trailing newline. Slicing by the declared byte length rather than
// splitting the buffer on '\n' is what keeps this correct: every SKILL.md
// or sub-file this reads contains its own newlines. Not claims-git-cas.js's
// parseCatFileBatch: that one feeds bare shas and detects `missing` by
// splitting the header on spaces, but here the input is `{sha}:{path}` and
// git echoes the path back — a path with a space would read as a content
// header. `count` is the number of objects fed, so a truncated or
// malformed stream is a loud error rather than a silently-short result.
function parseBatchOutput(buf, count) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const nl = buf.indexOf(0x0a, offset);
    if (nl === -1) throw new Error('load-delta.js: git cat-file --batch output truncated');
    const header = buf.slice(offset, nl).toString('utf8');
    offset = nl + 1;
    if (header.endsWith(' missing')) { out.push(null); continue; }
    const m = /^[0-9a-f]+ \S+ (\d+)$/.exec(header);
    if (!m) throw new Error(`load-delta.js: unexpected git cat-file --batch header: ${header}`);
    const size = Number(m[1]);
    out.push(buf.slice(offset, offset + size).toString('utf8'));
    offset += size + 1; // +1 skips the single trailing newline git appends after content
  }
  return out;
}

// Prefetches every `paths` entry's base content in one `git cat-file
// --batch` process (ledger row 16 — baseSide previously spawned one `git
// show` per file: 481 spawns, ~3.6s of a 4.1s run on this repo). Returns a
// Map<path, string> for every path git resolved at `sha`; a path git itself
// reports missing is simply absent from the map (never stored as null),
// so a caller's `batch.has(p)` falls through to the existing per-file
// git-show fallback instead of masquerading a real git miss as "prefetched
// and empty".
function prefetchBaseMd(gitBatch, sha, paths) {
  const map = new Map();
  if (paths.length === 0) return map;
  const input = paths.map((p) => `${sha}:${p}\n`).join('');
  const buf = gitBatch(['cat-file', '--batch'], input);
  const contents = parseBatchOutput(buf, paths.length);
  paths.forEach((p, i) => { if (contents[i] !== null) map.set(p, contents[i]); });
  return map;
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
    // A root discovered only via the base-tree union (ledger row 17) — all
    // its SKILL.md files deleted, committed, at head — has no skills/
    // directory left on disk at all; a root whose index entries are deleted
    // in the working tree only (never committed) can hit the same ENOENT.
    // Either way that is "no entries at head", not a crash: readdirSync's
    // ENOENT/ENOTDIR become [], and anything else (a real permissions or I/O
    // error) still rethrows.
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (['ENOENT', 'ENOTDIR'].includes(err.code)) return [];
      throw err;
    }
    return entries
      .filter((d) => d.isDirectory())
      .map((d) => `${skillsPrefix(root)}${d.name}/SKILL.md`)
      .filter((p) => readFile(p) !== null);
  };
  // The citable `.md` listing rule (f)'s bare-name resolution reads — walked
  // from {root}/skills and {root}/agents only (never `.claude/worktrees/`).
  const listFiles = () => walkCitable(root, readdirUnder(repoRoot));
  return { readFile, listSkillMds, listFiles };
}

function baseSide(git, sha, baseFiles, root, batch = null) {
  const re = SKILL_MD_UNDER(root);
  return {
    // A path absent from the base tree is "did not exist at base" (null → 0
    // bytes), decided from the ls-tree set, never from a swallowed git error.
    // `batch` (prefetchBaseMd's map, scoped to this root's own .md paths)
    // serves most reads from the single cat-file --batch call already made
    // for this root; a path the caller never prefetched (not under this
    // root's prefix, or not a .md path) falls back to the per-file git show
    // this function always used before item A.
    readFile: (p) => {
      if (!baseFiles.has(p)) return null;
      if (batch && batch.has(p)) return batch.get(p);
      return git(['show', '--end-of-options', `${sha}:${p}`]);
    },
    listSkillMds: () => [...baseFiles].filter((p) => re.test(p)),
    listFiles: () => [...baseFiles],
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
    const rawGitBatch = deps.gitBatch || defaultGitBatch(cwd);
    const gitBatch = (args, input) => rawGitBatch(['-C', repoRoot, ...args], input);

    // Base resolution moves ahead of plugin-root discovery: with no explicit
    // --plugin-root, discovery unions the head and base listings (ledger row
    // 17, below) so a root that exists at base but was deleted — committed —
    // at head still reports its removed entries, and that union needs the
    // base sha first.
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

    // The full base tree listing, computed once a base resolves — reused for
    // plugin-root union discovery just below and for baseSide's
    // existence/batch-prefetch logic in the 'ok' branch further down.
    const baseFiles = base ? new Set(splitZ(git(['ls-tree', '-r', '-z', '--name-only', '--full-tree', '--end-of-options', base]))) : null;

    let roots;
    const pluginRootsGiven = o.pluginRoots.length > 0;
    if (pluginRootsGiven) {
      roots = [];
      // Both sides through realpathSync: a symlinked cwd (macOS /var ->
      // /private/var) resolves, and separators are native (git prints C:/...).
      const realRepoRoot = fs.realpathSync(repoRoot);
      for (const r of o.pluginRoots) {
        const abs = path.resolve(cwd, r);
        try { corpusDir(abs); } catch (err) { deps.stderr(`load-delta.js: ${err.message}\n`); return 3; }
        const real = fs.realpathSync(abs);
        if (!isPathContained(real, realRepoRoot, { orEqual: true })) { deps.stderr(`load-delta.js: --plugin-root ${r} is outside the repository\n`); return 2; }
        roots.push(toPosix(path.relative(repoRoot, real)) || '.');
      }
      roots = [...new Set(roots)].sort();
    } else {
      const listedHead = splitZ(git(['ls-files', '-z', '--', ':(glob)skills/*/SKILL.md', ':(glob)*/skills/*/SKILL.md']));
      // Head-index-only discovery misses a root whose SKILL.md files were
      // all deleted (committed) at head but still exist at base (ledger row
      // 17) — union with the full base tree whenever a base resolved.
      // discoverPluginRoots filters to ROOT_SKILL_MD paths itself, so handing
      // it the whole base tree (not a second glob-restricted ls-tree call)
      // costs nothing beyond this one in-memory concat. The no-baseline path
      // (baseFiles === null) keeps head-only discovery — there is no base
      // tree to union with.
      const listed = baseFiles ? [...listedHead, ...baseFiles] : listedHead;
      roots = discoverPluginRoots(() => listed);
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
      result = {
        status: 'ok',
        base,
        baseKind,
        baseLabel,
        roots: heads.map((h) => {
          // One git cat-file --batch process per root (ledger row 16, item
          // A): prefetch every base .md path under this root's own prefix
          // ('' for root '.', meaning the whole repo) instead of spawning a
          // `git show` per closure member.
          const prefix = h.root === '.' ? '' : `${h.root}/`;
          // A path holding a newline would break cat-file's line framing; it
          // stays on the per-file git show fallback instead.
          const mdPaths = [...baseFiles].filter((p) => (h.root === '.' || p.startsWith(prefix)) && p.endsWith('.md') && !p.includes('\n'));
          const batch = prefetchBaseMd(gitBatch, base, mdPaths);
          return {
            pluginRoot: h.root,
            entries: loadDelta(entryPointLoads(h.root, baseSide(git, base, baseFiles, h.root, batch)), h.rows),
          };
        }),
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
