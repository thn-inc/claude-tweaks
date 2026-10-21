#!/usr/bin/env node
// bin/skill-load-report.js — transcript-measured per-invocation skill load
// (#3309). Thin CLI over bin/lib/skill-audit/transcript-load.js: reads this
// machine's Claude Code transcripts for one working directory (the newest
// --sessions main transcripts plus every subagent transcript under each),
// summarizes load per skill, and joins each skill to its static closure from
// bin/lib/skill-audit/load.js (#3307). harness-health's Skill-load check
// runs it every firing; it never gates.
//
// Usage: skill-load-report.js [--cwd <dir>] [--sessions <n>]
//                             [--plugin-root <dir>]...
//                             [--optional-plugin-root <dir>]... [--help]
//   --cwd          the directory whose transcripts are read (default: the
//                  process cwd). Transcripts live under
//                  {config-dir}/projects/{slug}/ — {config-dir} is
//                  $CLAUDE_CONFIG_DIR or ~/.claude, {slug} the cwd with every
//                  character outside [A-Za-z0-9-] replaced by "-"
//                  (timing/transcript.js's slugForCwd). A worktree session's
//                  transcripts sit under the worktree's slug, not the main
//                  checkout's.
//   --sessions     how many of the newest main transcripts to read (default 20)
//   --plugin-root  repeatable; a directory holding skills/ (default: every
//                  tracked skills/*/SKILL.md root at the cwd or one directory
//                  down — load.js's discoverPluginRoots)
//   --optional-plugin-root  repeatable; like --plugin-root, but a directory
//                  with no skills/ is skipped silently instead of exiting 2
//                  (the project-local .claude root a project may not have)
//
// Output: one JSON line — { status: "ok" | "no-data", transcriptDir,
// sessions, unreadable, rows: [{ skill, invocations, median, max, closure,
// outsideClosure }] }, rows sorted by max descending, then skill ascending.
// `closure` is the static closure of the same skill under a root whose
// .claude-plugin/plugin.json `name` equals the invoked skill's namespace (a
// bare or path-namespaced skill name matches a root with no plugin.json —
// the project-local .claude/skills form); any other skill gets
// closure null and outsideClosure null. `outsideClosure` is the sorted,
// distinct root-relative paths the skill's invocations Read that the matched
// root holds but its static closure does not list. Only skill-file Reads
// (a path with a skills/ segment) are recorded and compared, and a Read counts
// only when the text before its final skills/ segment is that root itself or,
// for a root whose plugin.json names it, an installed copy of it
// (plugins/cache/{marketplace}/{name}/{version}/) — a same-relative-path file
// from any other origin is dropped.
// "no-data" means no main transcript was read — never zero load reported as
// measured.
// Exit: 0 success (including no-data); 2 malformed invocation or a
// --plugin-root with no skills/; 1 an unexpected error.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { slugForCwd } = require('./lib/timing/transcript');
const { readSkillLoads, summarizeLoads } = require('./lib/skill-audit/transcript-load');
const { discoverPluginRoots, entryPointLoads } = require('./lib/skill-audit/load');
const { pluginRootReader } = require('./lib/skill-audit/plugin-root-reader');

const USAGE = 'usage: skill-load-report.js [--cwd <dir>] [--sessions <n>] [--plugin-root <dir>]... [--optional-plugin-root <dir>]... [--help]\n';
const DEFAULT_SESSIONS = 20;

function parseArgs(argv) {
  const o = { cwd: null, sessions: DEFAULT_SESSIONS, pluginRoots: [], optionalRoots: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--cwd' || a === '--sessions' || a === '--plugin-root' || a === '--optional-plugin-root') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--cwd') o.cwd = v;
      else if (a === '--plugin-root') o.pluginRoots.push(v);
      else if (a === '--optional-plugin-root') o.optionalRoots.push(v);
      else {
        if (!/^[1-9]\d*$/.test(v)) return { error: `--sessions must be a positive integer, got: ${v}` };
        o.sessions = Number(v);
      }
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  configDir: () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  listFiles: (cwd) => {
    try {
      return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
        .split('\0').filter(Boolean);
    } catch {
      return [];
    }
  },
};

// Regular .jsonl files directly in `dir`, newest first; null when `dir` is
// absent. Dirent.isFile() is false for a symlink, so none is followed. An
// entry deleted between readdirSync and statSync (a session being cleaned
// up concurrently) is skipped rather than aborting the whole run.
function jsonlFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (['ENOENT', 'ENOTDIR'].includes(err.code)) return null;
    throw err;
  }
  return entries
    .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
    .map((d) => {
      const p = path.join(dir, d.name);
      let mtimeMs;
      try {
        mtimeMs = fs.statSync(p).mtimeMs;
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
      return { path: p, sessionId: d.name.slice(0, -'.jsonl'.length), mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : 1));
}

function pluginName(rootAbs) {
  try {
    const { name } = JSON.parse(fs.readFileSync(path.join(rootAbs, '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof name === 'string' && name ? name : '';
  } catch {
    return '';
  }
}

// Map `${namespace}\0${skill}` -> { closure bytes, files: Set of the closure's
// root-relative paths, rootFiles: Set of every citable file the root holds }
// for every entry point under every root. A citation is read only when it
// resolves (symlinks included) to a regular file inside its root — the shared
// plugin-root-reader.js rule (load-delta.js's head side reads through the same
// reader).
function closureIndex(rootsAbs) {
  const index = new Map();
  for (const rootAbs of rootsAbs) {
    const ns = pluginName(rootAbs);
    const originAbs = `${path.resolve(rootAbs).replace(/\\/g, '/')}/`;
    const reader = pluginRootReader(rootAbs);
    const rootFiles = new Set(reader.listFiles());
    for (const e of entryPointLoads('.', reader)) {
      index.set(`${ns}\0${e.entry.slice(e.entry.lastIndexOf(':') + 1)}`, { closure: e.closure, files: new Set(e.files), rootFiles, originAbs, ns });
    }
  }
  return index;
}

// A project-local skill is invoked bare ("gh-api-module-pattern") or, from
// a worktree session, under its skills directory's path
// (".claude/worktrees/x:gh-api-module-pattern" — observed on 2.1.302); a
// namespace carrying "/" is that path form, so it folds into the bare name
// before any row groups or joins by skill — otherwise the same skill splits
// across several rows (one per distinct worktree path seen) instead of one.
function foldPathNamespace(skill) {
  const i = skill.indexOf(':');
  return i >= 0 && skill.slice(0, i).includes('/') ? skill.slice(i + 1) : skill;
}

// A Read's file_path -> { origin, rel }: rel is the root-relative form closure
// files use (the suffix from the last "/skills/" segment), origin the text
// before it, trailing "/" included; null without such a segment. No nested
// skills/ directory exists under a skills tree, so the last segment is the
// root's.
function splitAtSkills(readPath) {
  const i = readPath.lastIndexOf('/skills/');
  return i >= 0 ? { origin: readPath.slice(0, i + 1), rel: readPath.slice(i + 1) } : null;
}

// Whether a Read's origin is the matched root itself, or — for a root whose
// plugin.json names it — an installed copy of that plugin, so a same-relative-path
// file of another root (another plugin, ~/.claude/skills, a project's .claude)
// is never compared against this one.
function originMatches(entry, origin) {
  if (origin === entry.originAbs) return true;
  if (!entry.ns) return false;
  const name = entry.ns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/plugins/cache/[^/]+/${name}/[^/]+/$`).test(origin);
}

// The sorted, distinct root-relative paths among `readPaths` that the matched
// root holds but the skill's static closure does not list.
function outsideReads(entry, readPaths) {
  const outside = new Set();
  for (const p of readPaths) {
    const read = splitAtSkills(p);
    if (read && originMatches(entry, read.origin) && entry.rootFiles.has(read.rel) && !entry.files.has(read.rel)) outside.add(read.rel);
  }
  return [...outside].sort();
}

// Plain `{ns}:{name}` / bare-name split — every row's skill is already
// folded (foldPathNamespace, above) before this runs, so no path form
// reaches here.
function closureOf(index, skill) {
  const i = skill.indexOf(':');
  const ns = i < 0 ? '' : skill.slice(0, i);
  const key = `${ns}\0${skill.slice(i + 1)}`;
  return index.has(key) ? index.get(key) : null;
}

async function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`skill-load-report.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  const cwd = path.resolve(deps.cwd, o.cwd || '.');
  const rootsAbs = (o.pluginRoots.length ? o.pluginRoots : discoverPluginRoots(() => deps.listFiles(cwd)))
    .map((r) => path.resolve(cwd, r));
  const hasSkills = (r) => {
    try { return fs.statSync(path.join(r, 'skills')).isDirectory(); } catch { return false; }
  };
  for (const r of rootsAbs) {
    if (!hasSkills(r)) { deps.stderr(`skill-load-report.js: --plugin-root has no skills/ directory: ${r}\n`); return 2; }
  }
  for (const r of o.optionalRoots.map((x) => path.resolve(cwd, x))) if (hasSkills(r)) rootsAbs.push(r);
  const transcriptDir = path.join(deps.configDir(), 'projects', slugForCwd(cwd));
  const mains = (jsonlFiles(transcriptDir) || []).slice(0, o.sessions);
  const rows = [];
  let sessions = 0;
  let unreadable = 0;
  const read = async (file, kind) => {
    try {
      rows.push(...await readSkillLoads(file, { worktree: cwd, kind }));
      return true;
    } catch {
      unreadable++;
      return false;
    }
  };
  for (const m of mains) {
    if (await read(m.path, 'main')) sessions++;
    let subagentFiles;
    try {
      subagentFiles = jsonlFiles(path.join(transcriptDir, m.sessionId, 'subagents'));
    } catch {
      // Unreadable subagents/ directory (e.g. EACCES) — count it once and
      // keep going; the main transcript directory keeps its stricter rule
      // (absent is no-data, another error propagates) above and in
      // jsonlFiles(transcriptDir) at the top of this function.
      unreadable++;
      subagentFiles = null;
    }
    for (const s of subagentFiles || []) await read(s.path, 'subagent');
  }
  if (sessions === 0) {
    deps.stdout(`${JSON.stringify({ status: 'no-data', transcriptDir, sessions: 0, unreadable, rows: [] })}\n`);
    return 0;
  }
  for (const r of rows) r.skill = foldPathNamespace(r.skill);
  const index = closureIndex([...new Set(rootsAbs)]);
  const readsBySkill = new Map();
  for (const r of rows) {
    if (!readsBySkill.has(r.skill)) readsBySkill.set(r.skill, new Set());
    for (const p of r.readPaths) readsBySkill.get(r.skill).add(p);
  }
  const out = summarizeLoads(rows)
    .map((r) => {
      const entry = closureOf(index, r.skill);
      if (!entry) return { ...r, closure: null, outsideClosure: null };
      return { ...r, closure: entry.closure, outsideClosure: outsideReads(entry, readsBySkill.get(r.skill)) };
    })
    .sort((a, b) => b.max - a.max || (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0));
  deps.stdout(`${JSON.stringify({ status: 'ok', transcriptDir, sessions, unreadable, rows: out })}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    process.stderr.write(`skill-load-report.js: ${err && err.message}\n`);
    process.exitCode = 1;
  });
}
