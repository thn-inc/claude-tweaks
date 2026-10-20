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
//                             [--plugin-root <dir>]... [--help]
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
//
// Output: one JSON line — { status: "ok" | "no-data", transcriptDir,
// sessions, unreadable, rows: [{ skill, invocations, median, max, closure,
// overClosure }] }, rows sorted by max descending, then skill ascending.
// `closure` is the static closure of the same skill under a root whose
// .claude-plugin/plugin.json `name` equals the invoked skill's namespace (a
// bare or path-namespaced skill name matches a root with no plugin.json —
// the project-local .claude/skills form); any other skill gets
// closure null and overClosure false. "no-data" means no main transcript was
// read — never zero load reported as measured.
// Exit: 0 success (including no-data); 2 malformed invocation or a
// --plugin-root with no skills/; 1 an unexpected error.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { slugForCwd } = require('./lib/timing/transcript');
const { readSkillLoads, summarizeLoads } = require('./lib/skill-audit/transcript-load');
const { discoverPluginRoots, entryPointLoads, walkCitable } = require('./lib/skill-audit/load');
const { readdirUnder } = require('./lib/skill-audit/citable-readdir');
const { isPathContained } = require('./lib/shared-primitives');

const USAGE = 'usage: skill-load-report.js [--cwd <dir>] [--sessions <n>] [--plugin-root <dir>]... [--help]\n';
const DEFAULT_SESSIONS = 20;

function parseArgs(argv) {
  const o = { cwd: null, sessions: DEFAULT_SESSIONS, pluginRoots: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--cwd' || a === '--sessions' || a === '--plugin-root') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--cwd') o.cwd = v;
      else if (a === '--plugin-root') o.pluginRoots.push(v);
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

// Map `${namespace}\0${skill}` -> closure bytes for every entry point under
// every root. A citation is read only when it resolves (symlinks included)
// to a regular file inside its root — load-delta.js's headSide rule.
function closureIndex(rootsAbs) {
  const index = new Map();
  for (const rootAbs of rootsAbs) {
    const realRoot = fs.realpathSync(rootAbs);
    const readFile = (p) => {
      try {
        const real = fs.realpathSync(path.join(rootAbs, p));
        if (!isPathContained(real, realRoot) || !fs.statSync(real).isFile()) return null;
        return fs.readFileSync(real, 'utf8');
      } catch (err) {
        if (['ENOENT', 'EISDIR', 'ENOTDIR', 'ELOOP'].includes(err.code)) return null;
        throw err;
      }
    };
    const listSkillMds = () => fs.readdirSync(path.join(rootAbs, 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `skills/${d.name}/SKILL.md`)
      .filter((p) => readFile(p) !== null);
    // Rule (f)'s citable listing: only {rootAbs}/skills and {rootAbs}/agents
    // are walked — a `.claude` root must never descend into worktrees/.
    const listFiles = () => walkCitable('.', readdirUnder(rootAbs));
    const ns = pluginName(rootAbs);
    for (const e of entryPointLoads('.', { readFile, listSkillMds, listFiles })) {
      index.set(`${ns}\0${e.entry.slice(e.entry.lastIndexOf(':') + 1)}`, e.closure);
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
  for (const r of rootsAbs) {
    let isDir = false;
    try { isDir = fs.statSync(path.join(r, 'skills')).isDirectory(); } catch { isDir = false; }
    if (!isDir) { deps.stderr(`skill-load-report.js: --plugin-root has no skills/ directory: ${r}\n`); return 2; }
  }
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
  const index = closureIndex(rootsAbs);
  const out = summarizeLoads(rows)
    .map((r) => {
      const closure = closureOf(index, r.skill);
      return { ...r, closure, overClosure: closure !== null && r.max > closure };
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
