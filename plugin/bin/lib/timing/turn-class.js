// bin/lib/timing/turn-class.js — classify one transcript tool call into a turn
// class (#4029). Pure: no fs, no transcript access. readUsage (transcript.js)
// calls classifyToolCall per tool_use block; isProcedurePath lives here (and is
// re-exported by transcript.js) so transcript.js can require this module
// without a cycle — this module must never require transcript.js.
//
// First match wins: a guard refusal is decided by the result text before the
// tool name is consulted, so a refused Edit is ceremony, not an edit.
'use strict';

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
const GUARD_REFUSAL_RE = /This session is isolated in the worktree|PreToolUse:\S{1,64} hook error|Permission to use \S{1,64}[^\n]{0,1500}has been denied/;
const REFUSAL_SCAN_CHARS = 2048;

// A Read counts as procedure loading when it targets a skill file — the
// repo's plugin/skills/** or the installed plugin cache's skills/ (a real
// session reads skills from ~/.claude/plugins/cache/…/skills/, so a
// repo-only rule would count zero bytes on every real run).
function isProcedurePath(filePath, worktree) {
  if (typeof filePath !== 'string' || !filePath) return false;
  let p = filePath;
  if (worktree && p.startsWith(worktree)) p = p.slice(worktree.length).replace(/^\/+/, '');
  if (/(^|\/)(plugin\/)?skills\/.+\.md$/.test(p)) return true;
  return p.includes('/.claude/plugins/') && p.includes('/skills/') && p.endsWith('.md');
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

// Whitespace tokens with surrounding quotes removed ("a b" -> a b).
function tokenize(segment) {
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
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

// { name, input, isError, resultText, worktree } -> one of TURN_CLASSES.
function classifyToolCall({ name, input, isError, resultText, worktree } = {}) {
  if (isError === true && typeof resultText === 'string' && GUARD_REFUSAL_RE.test(resultText.slice(0, REFUSAL_SCAN_CHARS))) return 'guard-refusal';
  const inp = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return 'edit';
    case 'Read': return isProcedurePath(inp.file_path, worktree) ? 'procedure' : 'read';
    case 'Skill': return 'procedure';
    case 'Grep': case 'Glob': case 'LS': return 'explore';
    case 'Agent': case 'Task': return 'dispatch';
    case 'ToolSearch': return 'orientation';
    case 'TodoWrite': return 'bookkeeping';
    case 'Bash': return classifyBash(inp.command);
    default: return 'other';
  }
}

module.exports = { TURN_CLASSES, CEREMONY_CLASSES, classifyToolCall, classifyBash, isProcedurePath };
