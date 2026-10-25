'use strict';
// tools/guard-refusals/trace.js — #4028: name a refusal's reason, and trace a refused command back to
// the skill fence it was copied from.
//
// classifyReason() reads the clause of Claude Code's worktree-isolation refusal ("… but this command
// runs sed with a value computed at runtime …") and returns one id of REASONS. The patterns are
// ordered: a specific clause is tested before a general one, because the general wording ("too complex
// to verify") also appears inside the specific ones.
//
// buildFenceIndex()/traceFence() match by line. A refused command line of 20+ chars matches a fence
// line when both are equal after normalization: the plugin root (a literal absolute path on the
// command side, `${CLAUDE_PLUGIN_ROOT}` on the fence side) becomes `<ROOT>`, and a fence-side
// `{placeholder}` or `$VAR` / `"$VAR"` / `${VAR}` token is a wildcard (the agent filled it in).

const path = require('node:path');
const fs = require('node:fs');
const { walkMarkdown, shellFences } = require('./fences');

const REASONS = [
  'too-complex', 'names-git', 'git-redirect-shared', 'cd-shared', 'git-C-runtime', 'glob-git',
  'runs-eval', 'runs-complete', 'sed-runtime', 'node-runtime-operand', 'node-program-runtime',
  'gh-runtime', 'gh-text', 'bash-construct', 'other',
];

// Ordered: first match wins. Each pattern reads the clause only (see clauseOf).
const REASON_TABLE = [
  ['names-git', /\bnames git in a form too complex/],
  ['git-C-runtime', /\bpoints git at a directory computed at runtime/],
  ['git-redirect-shared', /\bredirects git to the shared checkout/],
  ['glob-git', /\bredirects git through a glob/],
  ['cd-shared', /\bchanges directory to\b|\bworking directory resolved to the shared checkout/],
  ['runs-complete', /\bruns a string through complete\b/],
  ['runs-eval', /\bruns a string through (?:eval|source)\b|\bruns eval\b/],
  ['sed-runtime', /\bruns sed with\b/],
  ['node-program-runtime', /\bruns node with a (?:program|script)\b|\bfeeds node a program\b/],
  ['node-runtime-operand', /\bruns node with a value computed at runtime/],
  ['gh-text', /\bruns gh with the text\b/],
  ['gh-runtime', /\bruns gh with a value computed at runtime/],
  ['bash-construct', /\bruns (?:bash|sh|zsh|dash|ksh|fish|pwsh)\b/],
  // Anchored: "runs playwright-cli with a value … inside a construct too complex to verify" is `other`.
  ['too-complex', /^(?:but )?this command is too complex to verify\b|\bthis command uses string content the parser did not tokenize\b/],
];

// The part of a refusal from "but this command" up to "Refusing to run"; the whole text when it has
// no such frame (a caller handing over only the clause).
function clauseOf(refusalText) {
  const text = String(refusalText);
  const start = Math.max(0, text.search(/\bbut this command/));
  const end = text.indexOf('Refusing to run', start);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

function classifyReason(refusalText) {
  const clause = clauseOf(refusalText);
  for (const [id, re] of REASON_TABLE) if (re.test(clause)) return id;
  return 'other';
}

// ---------------------------------------------------------------- fence tracing

const WILD = '\u0000';
const KEY_LEN = 8; // shortest literal run a fence line must hold to be indexable
const MIN_COMMAND_LINE = 20;

const ROOT_FENCE = /\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT(?!\w)/g;
const PLACEHOLDER = /\{[A-Za-z][\w.-]*(?:\|[\w.-]+)*\}/g;
const VAR_TOKEN = /"?\$(?:\{[A-Za-z_][^}]*\}|[A-Za-z_]\w*)"?/g;
// An absolute path ending in a real plugin root, spaces allowed when the path sits inside quotes: an
// installed `…/claude-tweaks/<semver>/` cache root, or a checkout's own `…/plugin/` root, known by a
// `bin/` or `skills/` segment directly after it. Any other `/plugin/` segment is left alone, so an
// unrelated path cannot tie two fences.
const PLUGIN_ROOT_END = String.raw`(?:\/claude-tweaks\/\d+\.\d+\.\d+\/|\/plugin\/(?=(?:bin|skills)\/))`;
const ROOT_QUOTED = new RegExp(String.raw`(?<=["'])\/[^"'\n]*?${PLUGIN_ROOT_END}`, 'g');
const ROOT_BARE = new RegExp(String.raw`(?<![\w./-])\/[^\s"'\`]*?${PLUGIN_ROOT_END}`, 'g');

function collapse(line) {
  return line.replace(/\s+/g, ' ').trim();
}

// Both sides: a literal absolute plugin root (a transcript, or a fence quoting one) and the
// ${CLAUDE_PLUGIN_ROOT} spelling (a fence, or a command that copied it verbatim) are one root.
function normalizeRoot(line) {
  return line.replace(ROOT_QUOTED, '<ROOT>/').replace(ROOT_BARE, '<ROOT>/').replace(ROOT_FENCE, '<ROOT>');
}

function normalizeCommandLine(line) {
  return collapse(normalizeRoot(line));
}

function normalizeFenceLine(line) {
  return collapse(normalizeRoot(line).replace(VAR_TOKEN, WILD).replace(PLACEHOLDER, WILD));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// → { regex, key } or null when the line holds too little literal text to identify a fence.
function compileFenceLine(normalized) {
  const parts = normalized.split(WILD);
  const longest = parts.reduce((a, b) => (b.length > a.length ? b : a), '');
  if (longest.length < KEY_LEN) return null;
  return {
    regex: new RegExp(`^${parts.map(escapeRegex).join('.+?')}$`),
    key: longest.slice(0, KEY_LEN),
  };
}

// skillsRoot → { fences: [{ id, lines: number }], byKey: Map<key, Array<{ fence, line, regex }>> }.
// A fence id is `<path relative to skillsRoot>:<line of its opening fence>`.
function buildFenceIndex(skillsRoot) {
  const fences = [];
  const byKey = new Map();
  for (const file of walkMarkdown(skillsRoot)) {
    const rel = path.relative(path.resolve(skillsRoot), file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    for (const f of shellFences(text)) {
      const entry = { id: `${rel}:${f.line}`, lines: 0 };
      fences.push(entry);
      const seen = new Set();
      for (const raw of f.body.split(/\r?\n/)) {
        const norm = normalizeFenceLine(raw);
        if (seen.has(norm)) continue;
        seen.add(norm);
        const compiled = compileFenceLine(norm);
        if (!compiled) continue;
        entry.lines++;
        if (!byKey.has(compiled.key)) byKey.set(compiled.key, []);
        byKey.get(compiled.key).push({ fence: entry, line: norm, regex: compiled.regex });
      }
    }
  }
  return { fences, byKey };
}

// The ids (`file:line`, sorted) of every fence tied for the most fence lines matched by the command's
// lines; [] when none matches.
function traceFence(command, index) {
  const matched = new Map(); // fence entry -> Set of matched fence lines
  const lines = new Set(String(command).split(/\r?\n/).map(normalizeCommandLine).filter((l) => l.length >= MIN_COMMAND_LINE));
  for (const line of lines) {
    const tried = new Set();
    for (let i = 0; i + KEY_LEN <= line.length; i++) {
      const candidates = index.byKey.get(line.slice(i, i + KEY_LEN));
      if (!candidates) continue;
      for (const c of candidates) {
        if (tried.has(c)) continue;
        tried.add(c);
        if (!c.regex.test(line)) continue;
        if (!matched.has(c.fence)) matched.set(c.fence, new Set());
        matched.get(c.fence).add(c.line);
      }
    }
  }
  let best = 0;
  for (const set of matched.values()) best = Math.max(best, set.size);
  if (best === 0) return [];
  const ids = [];
  for (const [fence, set] of matched) if (set.size === best) ids.push(fence.id);
  return ids.sort();
}

module.exports = { REASONS, classifyReason, buildFenceIndex, traceFence, normalizeCommandLine };
