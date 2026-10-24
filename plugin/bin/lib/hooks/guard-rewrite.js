// bin/lib/hooks/guard-rewrite.js — the PreToolUse guard normalizer (#4028).
//
// Claude Code's worktree-isolation guard refuses Bash shapes it cannot cheaply
// prove stay inside the worktree, including several whose meaning is fully
// known from the text: a literal assigned and then referenced, the plugin-root
// placeholder, `node -e '<s>' "$A"` without `--`, a backslash-escaped space, a
// `cd` into the directory the shell is already in. This module rewrites those,
// and the hook hands the result back as `hookSpecificOutput.updatedInput`.
//
// Measured premise (Claude Code 2.1.302): updatedInput is applied BEFORE the
// guard, and the guard re-checks the rewritten command. A rewrite therefore
// normalizes and never bypasses, so it is never paired with a
// permissionDecision.
//
// What each rule preserves, under bash AND zsh, the two shells the Bash tool
// runs (tests/bin-lib/hooks/guard-rewrite.test.js runs every positive case
// through both):
//   - inline-literal-assignment, quote-escaped-space, drop-redundant-cd: the
//     same argv.
//   - plugin-root-placeholder is a RESOLUTION, not a preservation: the Bash
//     tool's environment does not set CLAUDE_PLUGIN_ROOT, so the original
//     expands to `/bin/x.js`; the rewrite names the path the author meant (the
//     equivalence test sets the variable for the original).
//   - node-eval-separator: the same process.argv unless the runtime value
//     starts with `-`, which the original hands to node as an OPTION (accepted
//     by ruling: that is the injection the guard refuses over).
// Residual risk the text cannot show: a function or alias from the user's
// shell snapshot that sets an uppercase variable at runtime (`nvm use`, `conda
// activate`, a zsh `chpwd` hook) between an assignment and its reference.
// `source`, `.` and `eval`, which can do the same from the command text itself,
// make rules 1 and 2 decline.
//
// Anything this module cannot prove declines: a rule that
// doubts returns nothing, and rewriteForGuard returns null on any throw. It is
// loaded on every skip-path Bash call (bash-prefilter.js), so it requires only
// path and ../path-guard, and every scan is linear in the command length.
'use strict';
const path = require('path');
const { lstatType, canonicalRealpath } = require('../path-guard');

const DEFAULT_PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');
const MAX_COMMAND = 64 * 1024;
const MAX_ASSIGNMENTS = 16;

// The literal values rule 1 inlines (and the plugin root rule 2 inlines): no
// quote, `$`, backtick, backslash, glob, brace or tilde character, so the text
// means the same inside double quotes and as a bare word.
const LITERAL_VALUE = /^[A-Za-z0-9_.\/:@%+,=-][A-Za-z0-9_.\/:@%+,= -]*$/;
// Uppercase names only: zsh keeps its special parameters (path, status, argv,
// commands, …) in lowercase, and a special parameter does not hold what was
// assigned to it.
const SUBSTITUTABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
// Uppercase names the shell itself sets, reads specially, or rewrites after the
// assignment (cd sets PWD, read sets REPLY, …), in bash or zsh.
const SHELL_MAINTAINED = new Set([
  'ARGC', 'CDPATH', 'COLUMNS', 'DIRSTACK', 'EGID', 'EPOCHREALTIME', 'EPOCHSECONDS', 'ERRNO', 'EUID', 'FCEDIT',
  'FIGNORE', 'FPATH', 'FUNCNAME', 'GID', 'GLOBIGNORE', 'GROUPS', 'HOME', 'HOST', 'HOSTNAME', 'HOSTTYPE', 'IFS',
  'KEYBOARD_HACK', 'KEYTIMEOUT', 'LINENO', 'LINES', 'LISTMAX', 'MACHTYPE', 'MAILCHECK', 'MAILPATH', 'MANPATH',
  'MAPFILE', 'MATCH', 'MBEGIN', 'MEND', 'MODULE_PATH', 'NULLCMD', 'OLDPWD', 'OPTARG', 'OPTERR', 'OPTIND',
  'OSTYPE', 'PATH', 'PIPESTATUS', 'POSIXLY_CORRECT', 'PPID', 'PSVAR', 'PWD', 'RANDOM', 'READNULLCMD', 'REPLY',
  'REPORTTIME', 'SECONDS', 'SHELLOPTS', 'SHLVL', 'SPROMPT', 'SRANDOM', 'TIMEFMT', 'TMOUT', 'TMPPREFIX', 'TTY',
  'TTYIDLE', 'UID', 'USERNAME', 'WATCH', 'WORDCHARS', 'ZDOTDIR',
]);
const SHELL_MAINTAINED_PREFIX = /^(?:BASH|ZSH|HIST|COMP_|READLINE_|PS[0-9]|RPS|PROMPT|RPROMPT|LC_|LANG)/;

// Characters that end a shell word (unescaped).
const WORD_BREAK = /[\s;&|()<>]/;

// Scan contexts: what each character of the command is read as.
const TOP = 0; // unquoted, outside any command substitution
const SQ = 1; // inside '…'
const DQ = 2; // inside "…"
const SUB = 3; // unquoted, inside $( … )
const SKIP = 4; // escaped character or comment text

const BRACED_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/y;
const BARE_REF = /\$([A-Za-z_][A-Za-z0-9_]*)/y;
const NAME_START = /[A-Za-z_]/;
const SPECIAL_PARAM = /[0-9$?#@*!-]/;
const CASE_WORD = /(?:^|[\s;&|(])case\s/;

// One quote-aware pass: per-character context, every $NAME / ${NAME}
// reference with the context it is expanded in, top-level quoted spans, and
// the constructs no rule here reasons about.
function scan(s) {
  const n = s.length;
  const kind = new Uint8Array(n);
  const refs = [];
  const topQuoted = new Map();
  const flags = { backtick: false, heredoc: false, ansiC: false, complexParam: false, unquotedBrace: false, unquotedTilde: false };
  const stack = [{ k: TOP }];
  let i = 0;
  while (i < n) {
    const frame = stack[stack.length - 1];
    const k = frame.k;
    const c = s[i];
    kind[i] = k;
    if (k === SQ) {
      if (c === "'") {
        stack.pop();
        if (stack.length === 1) topQuoted.set(frame.start, i);
      }
      i += 1;
      continue;
    }
    if (c === '\\') {
      if (i + 1 < n) kind[i + 1] = SKIP;
      i += 2;
      continue;
    }
    if (c === '`') {
      flags.backtick = true;
      i += 1;
      continue;
    }
    if (c === '$') {
      const nx = s[i + 1];
      if (nx === '(') {
        kind[i + 1] = k;
        stack.push({ k: SUB, depth: 1 });
        i += 2;
        continue;
      }
      if (nx === '{') {
        BRACED_REF.lastIndex = i;
        const m = BRACED_REF.exec(s);
        if (m) {
          refs.push({ start: i, end: i + m[0].length, name: m[1], braced: true, kind: k });
          kind.fill(k, i, i + m[0].length);
          i += m[0].length;
        } else {
          flags.complexParam = true;
          kind[i + 1] = k;
          i += 2;
        }
        continue;
      }
      if (nx !== undefined && NAME_START.test(nx)) {
        BARE_REF.lastIndex = i;
        const m = BARE_REF.exec(s);
        refs.push({ start: i, end: i + m[0].length, name: m[1], braced: false, kind: k });
        kind.fill(k, i, i + m[0].length);
        i += m[0].length;
        continue;
      }
      // $'…' (ANSI-C) and $"…" (locale) outside double quotes; inside them the
      // `$` is literal and the quote is handled on the next iteration.
      if ((nx === "'" || nx === '"') && k !== DQ) flags.ansiC = true;
      else if (nx !== undefined && SPECIAL_PARAM.test(nx)) {
        kind[i + 1] = k;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (k === DQ) {
      if (c === '"') {
        stack.pop();
        if (stack.length === 1) topQuoted.set(frame.start, i);
      }
      i += 1;
      continue;
    }
    // TOP or SUB: unquoted text.
    if (c === "'") stack.push({ k: SQ, start: i });
    else if (c === '"') stack.push({ k: DQ, start: i });
    else if (c === '#' && (i === 0 || (WORD_BREAK.test(s[i - 1]) && kind[i - 1] !== SKIP))) {
      while (i < n && s[i] !== '\n') kind[i++] = SKIP;
      continue;
    } else if (c === '(' && k === SUB) frame.depth += 1;
    else if (c === ')' && k === SUB) {
      frame.depth -= 1;
      if (frame.depth === 0) stack.pop();
    } else if (c === '{' || c === '}') flags.unquotedBrace = true;
    else if (c === '~') flags.unquotedTilde = true;
    else if (c === '<' && s[i + 1] === '<') flags.heredoc = true;
    i += 1;
  }
  return { kind, refs, topQuoted, flags, balanced: stack.length === 1 };
}

// Constructs the walker does not model well enough to rewrite around.
function inDoubt(s, sc) {
  const f = sc.flags;
  return !sc.balanced || f.backtick || f.heredoc || f.ansiC || CASE_WORD.test(s);
}

function atWordStart(s, kind, i) {
  return i === 0 || (WORD_BREAK.test(s[i - 1]) && kind[i - 1] !== SKIP);
}

// Index of the first `=` at or after i, and of the first word break at or
// after i, for every i — so "does this word continue into an `=`" is O(1).
function wordTails(s) {
  const n = s.length;
  const nextEq = new Int32Array(n + 1);
  const nextBreak = new Int32Array(n + 1);
  nextEq[n] = n;
  nextBreak[n] = n;
  for (let i = n - 1; i >= 0; i -= 1) {
    nextEq[i] = s[i] === '=' ? i : nextEq[i + 1];
    nextBreak[i] = WORD_BREAK.test(s[i]) ? i : nextBreak[i + 1];
  }
  return { nextEq, nextBreak };
}

// True when every reference in `refs` expands to exactly the literal `value`
// under both shells, so the text can stand in for it (Review Focus 1: an
// unquoted spaced value splits in bash and not in zsh).
function refsInlineSafely(s, sc, refs, valueOf) {
  let tails = null;
  for (const ref of refs) {
    const value = valueOf(ref);
    const next = s[ref.end];
    // `$P\<newline>Q` is a line continuation: the shell reads the name `PQ`.
    if (!ref.braced && next === '\\') return false;
    if (ref.kind === DQ) {
      // zsh subscripts ($P[1]) and modifiers ($P:h) apply inside "…" too.
      if (!ref.braced && (next === '[' || next === ':')) return false;
      continue;
    }
    if (ref.kind !== TOP && ref.kind !== SUB) return false;
    if (!ref.braced && (next === '[' || next === ':')) return false;
    if (next === '(') return false; // extglob / zsh glob qualifiers
    // Field splitting differs between the shells; tilde expansion after `:`/`=`
    // and brace expansion (which runs before parameter expansion) would see the
    // literal text and not the expansion.
    if (value.includes(' ') || value.includes('=')) return false;
    if (sc.flags.unquotedTilde || sc.flags.unquotedBrace) return false;
    if (atWordStart(s, sc.kind, ref.start)) {
      // A command word without a `/` could become a keyword, alias or job spec;
      // a leading `=` is zsh's =cmd expansion.
      if (!value.includes('/') || value[0] === '%' || value[0] === '=') return false;
    }
    // `A$P=1` with P=B is a command named AB=1, but `AB=1` is an assignment.
    tails = tails || wordTails(s);
    if (tails.nextEq[ref.end] < tails.nextBreak[ref.end]) return false;
  }
  return true;
}

// `refs` in source order; `valueOf(ref)` is the literal each one becomes.
function replaceRefs(s, refs, valueOf) {
  let out = '';
  let last = 0;
  for (const ref of refs) {
    out += s.slice(last, ref.start) + valueOf(ref);
    last = ref.end;
  }
  return out + s.slice(last);
}

const IDENT_CHAR = /[A-Za-z0-9_]/;

// True when `name` appears anywhere as a bare identifier (not as $name /
// ${name}…) outside the [skipStart, skipEnd) span: a reassignment, an
// `unset`, a `for name in`, a `read name`, an `export name`.
function hasBareUse(s, name, skipStart = -1, skipEnd = -1) {
  let from = 0;
  for (;;) {
    const at = s.indexOf(name, from);
    if (at < 0) return false;
    from = at + name.length;
    if (at >= skipStart && at < skipEnd) continue;
    if (at > 0 && IDENT_CHAR.test(s[at - 1])) continue;
    if (from < s.length && IDENT_CHAR.test(s[from])) continue;
    if (s[at - 1] === '$') continue;
    if (s[at - 1] === '{' && s[at - 2] === '$') continue;
    return true;
  }
}

function substitutableName(name) {
  return SUBSTITUTABLE_NAME.test(name) && !SHELL_MAINTAINED.has(name) && !SHELL_MAINTAINED_PREFIX.test(name);
}

const ASSIGNMENT = /(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|([^\s;&|()<>'"`$\\]*))/y;
const SEPARATOR = /[ \t]*(?:&&|;(?![;&])|\n)[ \t\n]*/y;

// The leading top-level `NAME=value` / `export NAME=value` statements, each
// ended by `;`, `&&` or a newline. A prefix assignment (`P=x cmd`), a
// backgrounded or piped one, or a non-literal value ends the run.
function leadingAssignments(s) {
  const list = [];
  let i = 0;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i += 1;
  while (list.length < MAX_ASSIGNMENTS) {
    ASSIGNMENT.lastIndex = i;
    const m = ASSIGNMENT.exec(s);
    if (!m) break;
    const value = m[2] !== undefined ? m[2] : m[3];
    if (!LITERAL_VALUE.test(value)) break;
    SEPARATOR.lastIndex = i + m[0].length;
    const sep = SEPARATOR.exec(s);
    if (!sep) break;
    const nameAt = m.index + m[0].indexOf(m[1]);
    list.push({ name: m[1], value, nameStart: nameAt, nameEnd: nameAt + m[1].length });
    i = SEPARATOR.lastIndex;
  }
  return { list, bodyStart: i };
}

// Words after which the next word is still in command position.
const COMMAND_PREFIXES = new Set([
  '!', '{', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time', 'exec', 'command', 'builtin', 'nohup', 'env', 'noglob', 'nocorrect',
]);
const SHELL_CODE_RUNNERS = new Set(['source', '.', 'eval']);
const QUOTE_OR_ESCAPE = /["'\\]/g;
const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

// True when `source`, `.` or `eval` runs anywhere in command position (top
// level, a subshell, a $( … ) substitution, behind a prefix such as `command`
// or an assignment): the code they run can reassign a variable at runtime, so
// an assigned literal is no longer what a later reference expands to. `source`
// and `eval` are also refused as a bare word anywhere (a superset), so only `.`
// relies on the command-position walk.
function runsShellCode(s, kind) {
  let word = '';
  let cmdPos = true;
  let inPrefix = false;
  let redirectTarget = false; // the next word is a redirection's target
  const endWord = () => {
    if (!word) return false;
    const text = word.replace(QUOTE_OR_ESCAPE, '');
    const raw = word;
    word = '';
    if (text === 'source' || text === 'eval') return true;
    if (redirectTarget) {
      redirectTarget = false;
      return false;
    }
    if (!cmdPos) return false;
    if (SHELL_CODE_RUNNERS.has(text)) return true;
    if (ASSIGNMENT_PREFIX.test(raw) || COMMAND_PREFIXES.has(text) || (inPrefix && text[0] === '-')) {
      inPrefix = inPrefix || COMMAND_PREFIXES.has(text);
      return false;
    }
    cmdPos = false;
    inPrefix = false;
    return false;
  };
  for (let i = 0; i < s.length; i += 1) {
    const k = kind[i];
    if (k === SUB && (i === 0 || kind[i - 1] !== SUB)) {
      if (endWord()) return true;
      cmdPos = true;
      inPrefix = false;
    }
    const c = s[i];
    if ((k === TOP || k === SUB) && WORD_BREAK.test(c)) {
      if (c === '<' || c === '>') {
        // A redirection (`2>f`, `>f`) never takes the command's place: drop an
        // fd number before it and skip the target word after it.
        if (/^[0-9]+$/.test(word)) word = '';
        else if (endWord()) return true;
        redirectTarget = true;
        continue;
      }
      if (endWord()) return true;
      if (c !== ' ' && c !== '\t' && !(c === '&' && redirectTarget)) {
        cmdPos = true;
        inPrefix = false;
        redirectTarget = false;
      }
      continue;
    }
    word += c;
  }
  return endWord();
}

// Rule 1: inline a literal the command itself assigned at its start.
function inlineLiteralAssignment(s) {
  if (s.includes('IFS')) return null;
  const { list, bodyStart } = leadingAssignments(s);
  if (!list.length) return null;
  const sc = scan(s);
  if (inDoubt(s, sc) || sc.flags.complexParam) return null;
  if (runsShellCode(s, sc.kind)) return null;
  const values = new Map();
  for (const a of list) {
    if (values.has(a.name)) return null; // reassigned within the leading run
    if (hasBareUse(s, a.name, a.nameStart, a.nameEnd)) return null;
    values.set(a.name, a.value);
  }
  const refs = sc.refs.filter((r) => r.start >= bodyStart && values.has(r.name) && substitutableName(r.name));
  if (!refs.length) return null;
  // Any unsafe reference bails the whole rule, not just its own name.
  const valueOf = (r) => values.get(r.name);
  if (!refsInlineSafely(s, sc, refs, valueOf)) return null;
  return replaceRefs(s, refs, valueOf);
}

// Rule 2: ${CLAUDE_PLUGIN_ROOT} → the running plugin's own root.
function pluginRootPlaceholder(s, { pluginRoot }) {
  const name = 'CLAUDE_PLUGIN_ROOT';
  if (!s.includes(name) || s.includes('IFS')) return null;
  if (typeof pluginRoot !== 'string' || !path.isAbsolute(pluginRoot) || !LITERAL_VALUE.test(pluginRoot)) return null;
  if (hasBareUse(s, name)) return null; // the command assigns or unsets it itself
  const sc = scan(s);
  if (inDoubt(s, sc) || sc.flags.complexParam) return null;
  if (runsShellCode(s, sc.kind)) return null;
  const refs = sc.refs.filter((r) => r.name === name);
  if (!refs.length || !refsInlineSafely(s, sc, refs, () => pluginRoot)) return null;
  // Other plugins' prose spells the same placeholder for THEIR root: inline only
  // a reference that continues into a path this plugin actually ships.
  if (!refs.every((r) => shippedUnder(pluginRoot, s, r.end))) return null;
  return replaceRefs(s, refs, () => pluginRoot);
}

const ROOT_CONTINUATION = /\/[A-Za-z0-9_.\/@%+,-]+/y;
const PARENT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/;

// The continuation must name something specific to this plugin, not a layout
// every plugin shares (`/.claude-plugin/plugin.json`, `/hooks/hooks.json`,
// `/skills`, `/bin`): a file under bin/, or a path under one of this plugin's
// own skill directories. A same-named file in another plugin's bin/ remains a
// residual collision.
function shippedUnder(root, s, at) {
  ROOT_CONTINUATION.lastIndex = at;
  const m = ROOT_CONTINUATION.exec(s);
  if (!m || PARENT_SEGMENT.test(m[0])) return false;
  const segments = m[0].split('/').filter(Boolean);
  const exists = (rel) => lstatType(path.join(root, rel)).type;
  if (segments[0] === 'bin' && segments.length >= 2) {
    const t = exists(segments.join('/'));
    return t === 'file' || t === 'symlink';
  }
  if (segments[0] === 'skills' && segments.length >= 3 && exists(`skills/${segments[1]}`) === 'directory') {
    const t = exists(segments.join('/'));
    return t === 'file' || t === 'directory' || t === 'symlink';
  }
  return false;
}

const NODE_EVAL = /node[ \t]+(?:-e|-p|--eval|--print)[ \t]+/g;
const SEGMENT_END = /[;&|\n)]/;

function atCommandStart(s, kind, i) {
  let p = i - 1;
  while (p >= 0 && (s[p] === ' ' || s[p] === '\t')) p -= 1;
  if (p < 0) return true;
  return kind[p] === TOP && (s[p] === ';' || s[p] === '&' || s[p] === '|' || s[p] === '\n' || s[p] === '(');
}

// Rule 3: `node -e '<s>' "$A"` → `node -e '<s>' -- "$A"`. The guard accepts a
// computed argument only after `--`. process.argv is identical whenever the
// first argument's value does not begin with `-` (measured on node 22). When it
// does, the original hands that value to node as an OPTION (`bad option`, or
// worse, `--require`), which is the injection the guard refuses over, and the
// rewrite hands it to the script instead; that one divergence is pinned in
// tests/bin-lib/hooks/guard-rewrite.test.js.
function nodeEvalSeparator(s) {
  if (!s.includes('node')) return null;
  const sc = scan(s);
  if (inDoubt(s, sc)) return null;
  const inserts = [];
  NODE_EVAL.lastIndex = 0;
  let m;
  while ((m = NODE_EVAL.exec(s)) !== null) {
    const at = m.index;
    if (sc.kind[at] !== TOP || !atCommandStart(s, sc.kind, at)) continue;
    const scriptStart = NODE_EVAL.lastIndex;
    const scriptEnd = sc.topQuoted.get(scriptStart);
    if (scriptEnd === undefined || (s[scriptStart] !== "'" && s[scriptStart] !== '"')) continue;
    let a = scriptEnd + 1;
    if (s[a] !== ' ' && s[a] !== '\t') continue;
    while (s[a] === ' ' || s[a] === '\t') a += 1;
    if (!(s[a] === '$' || (s[a] === '"' && s[a + 1] === '$')) || sc.kind[a] !== TOP) continue;
    // A later `--` in the same command makes the argv split ambiguous.
    let p = a;
    let laterSeparator = false;
    for (; p < s.length; p += 1) {
      if (sc.kind[p] === TOP && SEGMENT_END.test(s[p])) break;
      if (sc.kind[p] === TOP && s[p] === '-' && s[p + 1] === '-' && /\s/.test(s[p - 1])
        && (p + 2 >= s.length || WORD_BREAK.test(s[p + 2]))) {
        laterSeparator = true;
        break;
      }
    }
    if (!laterSeparator) inserts.push(a);
    NODE_EVAL.lastIndex = Math.max(NODE_EVAL.lastIndex, p);
  }
  if (!inserts.length) return null;
  let out = s;
  for (let j = inserts.length - 1; j >= 0; j -= 1) out = `${out.slice(0, inserts[j])}-- ${out.slice(inserts[j])}`;
  return out;
}

const ESCAPED_WORD = /(?:[A-Za-z0-9_.\/:@%+,=~-]|\\ )+/g;
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

// Rule 4: an unquoted word spelled with `\ ` → the same word double-quoted.
function quoteEscapedSpace(s) {
  if (!s.includes('\\ ')) return null;
  const sc = scan(s);
  if (inDoubt(s, sc)) return null;
  const edits = [];
  ESCAPED_WORD.lastIndex = 0;
  let m;
  while ((m = ESCAPED_WORD.exec(s)) !== null) {
    const word = m[0];
    const st = m.index;
    const en = st + word.length;
    if (!word.includes('\\ ') || sc.kind[st] !== TOP) continue;
    if (!atWordStart(s, sc.kind, st) || (en < s.length && !WORD_BREAK.test(s[en]))) continue;
    // Tilde expansion (leading, or after `=`/`:`), zsh's leading =cmd, and an
    // assignment word all stop meaning the same thing once quoted.
    if (word[0] === '~' || word[0] === '=' || ASSIGNMENT_WORD.test(word) || /[=:]~/.test(word)) continue;
    edits.push({ st, en, text: `"${word.replace(/\\ /g, ' ')}"` });
  }
  if (!edits.length) return null;
  let out = '';
  let last = 0;
  for (const e of edits) {
    out += s.slice(last, e.st) + e.text;
    last = e.en;
  }
  return out + s.slice(last);
}

const LEADING_CD = /^[ \t]*cd[ \t]+(?:'([^']*)'|"([^"$`\\]*)"|([A-Za-z0-9_.\/:@%+,=-]+))[ \t]*&&[ \t\n]*/;
const OLDPWD_USE = /OLDPWD|~-|(?:^|[^A-Za-z0-9_])cd[ \t]+-(?:[\s;&|)]|$)/;

function trimSlashes(p) {
  const t = p.replace(/\/+$/, '');
  return t || '/';
}

// Rule 5: a leading `cd <the cwd> && ` changes nothing but OLDPWD → dropped.
// The literal must spell the cwd itself, not merely resolve to it: a symlinked
// or re-cased spelling would change $PWD and `pwd`.
function dropRedundantCd(s, { cwd }) {
  const m = LEADING_CD.exec(s);
  if (!m) return null;
  const target = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
  const rest = s.slice(m[0].length);
  // `cd X && # note` is a syntax error; `# note` alone is not.
  if (!/\S/.test(rest) || rest[0] === '#' || OLDPWD_USE.test(rest)) return null;
  if (!path.isAbsolute(target) || target.includes('~') || target.includes('$')) return null;
  if (trimSlashes(target) !== trimSlashes(cwd)) return null;
  const real = canonicalRealpath(target);
  if (real === null || real !== canonicalRealpath(cwd)) return null;
  return rest;
}

const RULES = [
  ['drop-redundant-cd', dropRedundantCd],
  ['inline-literal-assignment', inlineLiteralAssignment],
  ['plugin-root-placeholder', pluginRootPlaceholder],
  ['node-eval-separator', nodeEvalSeparator],
  ['quote-escaped-space', quoteEscapedSpace],
];

// Walk up from `cwd` to the first `.git` entry: a file marks a linked worktree
// (its gitdir pointer); a directory, or anything unreadable, does not.
function isLinkedWorktree(cwd) {
  let dir = cwd;
  for (;;) {
    const { type } = lstatType(path.join(dir, '.git'));
    if (type === 'file') return true;
    if (type !== 'missing') return false;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// → { command, applied } | null. Never throws.
function rewriteForGuard(opts) {
  try {
    const { command, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT } = opts || {};
    const deps = (opts && opts.deps) || {};
    if (typeof command !== 'string' || !command || command.length > MAX_COMMAND) return null;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
    let current = command;
    const applied = [];
    for (const [id, rule] of RULES) {
      const next = rule(current, { cwd, pluginRoot });
      if (typeof next === 'string' && next && next !== current) {
        current = next;
        applied.push(id);
      }
    }
    if (!applied.length) return null;
    const linked = deps.isLinkedWorktree || isLinkedWorktree;
    if (linked(cwd) !== true) return null;
    return { command: current, applied };
  } catch {
    return null;
  }
}

// The PreToolUse hookSpecificOutput for a Bash payload whose command rewrites,
// else null. `rewrite` is read at call time so a test can replace the export.
// Never throws, and never carries a permissionDecision (see the header).
function guardRewriteOutput(input, rewrite = module.exports.rewriteForGuard) {
  try {
    if (!input || typeof input !== 'object' || input.tool_name !== 'Bash') return null;
    const toolInput = input.tool_input;
    if (!toolInput || typeof toolInput !== 'object' || typeof toolInput.command !== 'string') return null;
    const out = rewrite({ command: toolInput.command, cwd: input.cwd });
    if (!out || typeof out.command !== 'string' || !out.command) return null;
    return { hookEventName: 'PreToolUse', updatedInput: { ...toolInput, command: out.command } };
  } catch {
    return null;
  }
}

module.exports = { rewriteForGuard, guardRewriteOutput, isLinkedWorktree };
