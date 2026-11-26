// bin/lib/timing/turn-class.js — classify one transcript tool call into a turn
// class (#4029). Pure: no fs, no transcript access. readUsage (transcript.js)
// calls classifyToolCall per tool_use block; isProcedurePath lives here (and is
// re-exported by transcript.js) so transcript.js can require this module
// without a cycle — this module must never require transcript.js.
//
// First match wins: a guard refusal is decided by the result text before the
// tool name is consulted, so a refused Edit is ceremony, not an edit.
'use strict';

const path = require('path');
const { isAncestorOrSelf } = require('../path-guard');
const { toPosix, relativeDisplayId } = require('../shared-primitives');
const { stripHeredocBodies } = require('../hooks/git-command');
const { SESSION_NOUN, AGENT_NOUN, ISOLATION_CLAUSE, escapeRegex } = require('../hooks/harness-refusal');

const TURN_CLASSES = Object.freeze(['edit', 'read', 'explore', 'procedure', 'bookkeeping', 'orientation', 'verify', 'guard-refusal', 'dispatch', 'other']);
// The classes whose turns are process overhead rather than the work itself.
const CEREMONY_CLASSES = Object.freeze(['procedure', 'bookkeeping', 'orientation', 'guard-refusal']);

// The three top refusal texts observed in this machine's transcripts. A plain
// "Exit code 1" tool error is NOT a refusal and classifies by tool as normal.
// All three lead the result, so classifyToolCall matches only its first
// REFUSAL_SCAN_CHARS, and the quantifiers are bounded: an is_error tool result
// is externally sized, and an unbounded `\S+.*` backtracked quadratically on
// one ([IL-162]). The permission text quotes the denied command before "has
// been denied", so its gap is sized to the scan window, not to a short command.
// The isolation alternative is composed from harness-refusal.js's nouns and clause
// (session or agent subject), so a wording update lands once.
const GUARD_REFUSAL_RE = new RegExp(
  '(?:' + escapeRegex(SESSION_NOUN) + '|' + escapeRegex(AGENT_NOUN) + ')' + escapeRegex(ISOLATION_CLAUSE)
  + '|' + /PreToolUse:\S{1,64} hook error|Permission to use \S{1,64}[^\n]{0,1500}has been denied/.source,
);
const REFUSAL_SCAN_CHARS = 2048;

// A Read counts as procedure loading when it targets a skill file — the
// repo's plugin/skills/** or the installed plugin cache's skills/ (a real
// session reads skills from ~/.claude/plugins/cache/…/skills/, so a
// repo-only rule would count zero bytes on every real run). A path inside the
// worktree is made worktree-relative, and every path is `/`-normalized (#3315):
// a win32 transcript records backslash paths, and the regexes below speak `/`.
// `pathImpl` is the seam a test injects `path.win32` through; callers pass two
// arguments and get the native path.
function isProcedurePath(filePath, worktree, pathImpl = path) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const p = normalizedPath(filePath, worktree, pathImpl);
  if (/(^|\/)(plugin\/)?skills\/.+\.md$/.test(p)) return true;
  return p.includes('/.claude/plugins/') && p.includes('/skills/') && p.endsWith('.md');
}

// The worktree-relative (when inside it), `/`-normalized form both
// isProcedurePath and procedureFileKey judge.
function normalizedPath(filePath, worktree, pathImpl) {
  const inWorktree = worktree && pathImpl.isAbsolute(filePath) && isAncestorOrSelf(worktree, filePath, { pathImpl });
  return inWorktree ? relativeDisplayId(worktree, filePath, pathImpl) : toPosix(filePath, pathImpl.sep);
}

// A procedure path -> its `skills/…/*.md` key (from the first `skills/`
// segment on), so the repo, worktree and plugin-cache copies of one skill file
// count as one file (#4359). Any other path -> null.
function procedureFileKey(filePath, worktree, pathImpl = path) {
  if (!isProcedurePath(filePath, worktree, pathImpl)) return null;
  const p = normalizedPath(filePath, worktree, pathImpl);
  const at = p.search(/(^|\/)skills\//);
  return p.slice(p[at] === '/' ? at + 1 : at);
}

// A composed bundle a pipeline step reads instead of its skill sources
// (`.claude-tweaks/pipelines/<run-id>/context/<name>.md`, a nested spec-N run
// dir included) -> `context/<name>.md`; any other path -> null (#4359). Never a
// `skills/` key and never isProcedurePath: a bundle read is not a skill-file
// read, but it is counted, so reads that moved from a source to its bundle
// stay visible.
const CONTEXT_BUNDLE_RE = /(?:^|\/)\.claude-tweaks\/pipelines\/(?:[^/]+\/)+context\/([^/]+\.md)$/;
function contextBundleKey(filePath, worktree, pathImpl = path) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const m = CONTEXT_BUNDLE_RE.exec(normalizedPath(filePath, worktree, pathImpl));
  return m ? `context/${m[1]}` : null;
}

// The per-file read key a Read or a Bash read path counts under: its
// contextBundleKey, else its procedureFileKey, else null. The bundle check
// goes first: a main checkout under a `skills/` directory makes a bundle path
// look like a procedure path too.
function readFileKey(filePath, worktree, pathImpl = path) {
  return contextBundleKey(filePath, worktree, pathImpl) || procedureFileKey(filePath, worktree, pathImpl);
}

// Quote-aware split of a shell command on && || ; | so a quoted "a && b" (a
// commit message, say) stays inside its segment. Not a shell parser: it only
// has to find where one command ends and the next begins.
function splitSegments(command) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '\\' && i + 1 < command.length) { cur += ch + command[++i]; continue; }
    if (ch === ';' || ch === '|' || ch === '&') {
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i++;
      segments.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  segments.push(cur);
  return segments.map((s) => s.trim()).filter(Boolean);
}

const TOKEN_RE = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;

// Whitespace tokens with surrounding quotes removed ("a b" -> a b).
function tokenize(segment) {
  return tokenizeMarked(segment).map((t) => t.text);
}

// tokenize's tokens as { text, quoted }: quoted is true for a token that was
// one quoted string, whose `>`, `<` or glob character is literal, never an
// operator. Only bashProcedureFiles reads the mark.
function tokenizeMarked(segment) {
  const tokens = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(segment)) !== null) tokens.push({ text: m[1] ?? m[2] ?? m[3], quoted: m[3] === undefined });
  return tokens;
}

// Drop leading `cd … &&` / `cd …;` hops and `VAR=value ` assignments.
const CD_HOP_RE = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&]+)\s*(?:&&|;)\s*/;
const ASSIGN_RE = /^\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/;
function stripPrefixes(command) {
  let s = command;
  for (;;) {
    const next = s.replace(CD_HOP_RE, '').replace(ASSIGN_RE, '');
    if (next === s) return s.trim();
    s = next;
  }
}

// Script-path checks run on tokenizer output (quotes already removed), never a
// `\S*` regex over the raw string — a checkout under "Code Workspaces" puts a
// space inside the quoted path.
const VERIFY_SCRIPT_RE = /(^|\/)(verify\.js|tools\/run-tests\.js)$/;
const VERIFY_TOOLS = new Set(['tsc', 'eslint', 'jest', 'vitest', 'pytest']);

// tokens of one segment -> true when it runs a test/verify tool.
function isVerifyRun(tokens) {
  const head = (tokens[0] || '').replace(/^.*\//, '');
  if (head === 'npm') {
    const script = tokens[1] === 'run' ? tokens[2] : tokens[1];
    return /^test\b/.test(script || '');
  }
  if (head === 'node') {
    const rest = tokens.slice(1);
    const at = rest.findIndex((t) => !t.startsWith('-'));
    const flags = at === -1 ? rest : rest.slice(0, at); // node's own flags, before the script
    return flags.includes('--test') || (at !== -1 && VERIFY_SCRIPT_RE.test(rest[at]));
  }
  if (head === 'npx') {
    const tool = tokens.slice(1).find((t) => !t.startsWith('-')) || '';
    return tokens.slice(1).some((t) => t === '--test') || VERIFY_TOOLS.has(tool);
  }
  return VERIFY_TOOLS.has(head) || VERIFY_SCRIPT_RE.test(tokens[0] || '');
}

const GIT_BOOKKEEPING = new Set(['add', 'commit', 'push', 'pull', 'fetch', 'merge', 'tag', 'rebase', 'cherry-pick', 'reset', 'checkout', 'switch', 'stash']);
const GIT_ORIENTATION = new Set(['rev-parse', 'status', 'remote', 'config']);
const GIT_EXPLORE = new Set(['log', 'show', 'diff', 'grep', 'blame', 'ls-files', 'ls-tree', 'cat-file', 'ls-remote']); // git-path-read: not a path list (subcommand names a transcript's commands are classified by)
const ORIENTATION_HEADS = new Set(['pwd', 'whoami', 'hostname', 'date', 'printenv', 'env', 'which', 'echo']);
const EXPLORE_HEADS = new Set(['grep', 'rg', 'ugrep', 'find', 'ls', 'cat', 'head', 'tail', 'sed', 'awk', 'wc', 'tree', 'jq', 'stat', 'file', 'diff']);

// tokens (head 'git') -> { sub, rest } past `-C <path>`, `-c k=v`, and the
// no-argument global flags this repo's own git calls carry.
function gitSubcommand(tokens) {
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '-C' || t === '-c') i += 2;
    else if (t === '--no-pager' || t === '--no-optional-locks') i += 1;
    else break;
  }
  return { sub: tokens[i] || '', rest: tokens.slice(i + 1) };
}

function classifyGit(tokens) {
  const { sub, rest } = gitSubcommand(tokens);
  if (GIT_BOOKKEEPING.has(sub)) return 'bookkeeping';
  if (sub === 'worktree') {
    if (rest[0] === 'add' || rest[0] === 'remove') return 'bookkeeping';
    if (rest[0] === 'list') return 'orientation';
    return 'other';
  }
  if (sub === 'branch') return rest.some((t) => /^-[dDmM]$/.test(t) || t === '--delete' || t === '--move') ? 'bookkeeping' : 'orientation';
  if (GIT_ORIENTATION.has(sub)) return 'orientation';
  if (GIT_EXPLORE.has(sub)) return 'explore';
  return 'other';
}

// command -> one of TURN_CLASSES (verify | bookkeeping | orientation | explore | other).
function classifyBash(command) {
  if (typeof command !== 'string' || !command.trim()) return 'other';
  const segments = splitSegments(stripPrefixes(command)).map(stripPrefixes).filter(Boolean);
  if (segments.length === 0) return 'other';
  // Verify beats every other class and is looked for in every segment, so
  // `git add . && npm test` is the test run it exists to perform.
  if (segments.some((s) => isVerifyRun(tokenize(s)))) return 'verify';
  const tokens = tokenize(segments[0]);
  const head = (tokens[0] || '').replace(/^.*\//, '');
  if (head === 'node') {
    const script = tokens.slice(1).find((t) => !t.startsWith('-')) || '';
    if (script.includes('/plugins/cache/') || script.includes('CLAUDE_PLUGIN_ROOT')) return 'bookkeeping';
    return 'other';
  }
  if (head === 'gh') return 'bookkeeping';
  if (head === 'git') return classifyGit(tokens);
  if (ORIENTATION_HEADS.has(head)) return 'orientation';
  if (EXPLORE_HEADS.has(head)) return 'explore';
  return 'other';
}

// command -> the procedureFileKey of every skill path a read-shaped segment
// names, one entry per path token, in order (#4359). Only READ_HEADS read a
// file's text; `git show HEAD:…` or a node script's argument is not a read.
const READ_HEADS = new Set(['cat', 'head', 'tail', 'sed', 'awk', 'grep', 'rg', 'ugrep', 'wc']);
// Heads whose first operand is a pattern, not a file — unless a pattern flag
// (-e/--regexp/-f/--file, as its own token or attached) supplied it.
const PATTERN_HEADS = new Set(['grep', 'rg', 'ugrep']);
const PATTERN_FLAG_RE = /^(?:-[A-Za-z]*[ef]|--regexp|--file)$/; // value is the next token
const PATTERN_FLAG_ATTACHED_RE = /^(?:-[ef].|--regexp=|--file=)/;
// Their other flags whose value is the next token (context and max-count: a
// number that must not take the pattern slot); `-A3` and `--context=3` carry it attached.
const PATTERN_HEAD_VALUE_FLAG_RE = /^(?:-[A-Za-z]*[ABCm]|--max-count|--context|--after-context|--before-context)$/;
// An output redirect (`>`, `>>`, `2>`, `&>`, `>|`, …); group 1 is an attached target.
const OUT_REDIRECT_RE = /^(?:\d+|&)?>>?\|?(.*)$/;
// Leading wrappers that run the real command: `timeout [flags] <duration>` and
// `xargs [flags]`. The sets name each one's flags that take a separate value.
const WRAPPER_VALUE_FLAGS = {
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  xargs: new Set(['-I', '-n', '-L', '-P', '-d', '-s', '-E', '-a']),
};

function stripWrappers(tokens) {
  let t = tokens;
  for (;;) {
    const head = (t[0] || '').replace(/^.*\//, '');
    const valueFlags = WRAPPER_VALUE_FLAGS[head];
    if (!valueFlags) return t;
    let i = 1;
    while (i < t.length && t[i].startsWith('-')) i += valueFlags.has(t[i]) ? 2 : 1;
    if (head === 'timeout') i += 1; // the duration
    t = t.slice(i);
  }
}

// Heredoc bodies are data, not commands, so they are stripped first (the write
// gate's own stripper; on any failure it returns the command unchanged). Each
// path token yields its readFileKey: a skill file's `skills/…` key or a
// composed bundle's `context/…` key.
function bashProcedureFiles(command, worktree, pathImpl = path) {
  if (typeof command !== 'string' || !command.trim()) return [];
  const { outer } = stripHeredocBodies(command);
  const keys = [];
  for (const segment of splitSegments(stripPrefixes(outer)).map(stripPrefixes).filter(Boolean)) {
    const marked = tokenizeMarked(segment);
    const unwrapped = stripWrappers(marked.map((t) => t.text));
    const tokens = marked.slice(marked.length - unwrapped.length);
    const head = ((tokens[0] && tokens[0].text) || '').replace(/^.*\//, '');
    if (!READ_HEADS.has(head)) continue;
    // grep permutes its arguments: a pattern flag anywhere means no operand is the pattern.
    const patternHead = PATTERN_HEADS.has(head);
    let patternPending = patternHead && !tokens.slice(1).some(({ text }) => PATTERN_FLAG_RE.test(text) || PATTERN_FLAG_ATTACHED_RE.test(text));
    for (let i = 1; i < tokens.length; i++) {
      let { text: t } = tokens[i];
      const { quoted } = tokens[i];
      const redirect = quoted ? null : OUT_REDIRECT_RE.exec(t);
      if (redirect) { if (!redirect[1]) i++; continue; }
      if (!quoted && t.startsWith('<') && !t.startsWith('<<')) t = t.slice(1); // input redirect: still a read
      if (!t) continue;
      if (t.startsWith('-')) {
        // its value is a pattern, a pattern file, or a count
        if (patternHead && (PATTERN_FLAG_RE.test(t) || PATTERN_HEAD_VALUE_FLAG_RE.test(t))) i++;
        continue;
      }
      if (patternPending) { patternPending = false; continue; }
      if (!quoted && /[*?[]/.test(t)) continue;
      const key = readFileKey(t, worktree, pathImpl);
      if (key) keys.push(key);
    }
  }
  return keys;
}

// { name, input, isError, resultText, worktree } -> one of TURN_CLASSES.
function classifyToolCall({ name, input, isError, resultText, worktree } = {}) {
  if (isError === true && typeof resultText === 'string' && GUARD_REFUSAL_RE.test(resultText.slice(0, REFUSAL_SCAN_CHARS))) return 'guard-refusal';
  const inp = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return 'edit';
    case 'Read': return isProcedurePath(inp.file_path, worktree) ? 'procedure' : 'read';
    case 'Skill': return 'procedure';
    case 'Grep': case 'Glob': case 'LS': return 'explore';
    case 'Agent': case 'Task': case 'Workflow': return 'dispatch';
    case 'ToolSearch': return 'orientation';
    case 'TodoWrite': return 'bookkeeping';
    case 'Bash': return classifyBash(inp.command);
    default: return 'other';
  }
}

module.exports = { TURN_CLASSES, CEREMONY_CLASSES, classifyToolCall, classifyBash, isProcedurePath, procedureFileKey, contextBundleKey, readFileKey, bashProcedureFiles };
