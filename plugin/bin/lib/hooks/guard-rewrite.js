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
// activate`, a zsh `chpwd` hook) between an assignment and its reference: a
// plain command word can name such a function, and so can a zsh glob qualifier
// (`*(e/fn/)`, `*(+fn)`), which runs it in the current shell. Code run from the command text
// itself (`source`, `.`, `eval`, `trap`, an expansion as the command word) makes
// rules 1 and 2 decline: every command word must be a plain literal outside the
// runner set (commandWordsPlain).
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
const SUB_OPEN = 1;
const SUB_CLOSE = 2;

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
  // SUB_OPEN marks the `(` of a $( … ), SUB_CLOSE its closing `)`.
  const subMark = new Uint8Array(n + 1);
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
        subMark[i + 1] |= SUB_OPEN;
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
      if (frame.depth === 0) {
        stack.pop();
        subMark[i] |= SUB_CLOSE;
      }
    } else if (c === '{' || c === '}') flags.unquotedBrace = true;
    else if (c === '~') flags.unquotedTilde = true;
    else if (c === '<' && s[i + 1] === '<') flags.heredoc = true;
    i += 1;
  }
  return { kind, subMark, refs, topQuoted, flags, balanced: stack.length === 1 };
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

// `spans` ({ start, end }) in source order; `valueOf(span)` is the text each one becomes.
function replaceSpans(s, spans, valueOf) {
  let out = '';
  let last = 0;
  for (const span of spans) {
    out += s.slice(last, span.start) + valueOf(span);
    last = span.end;
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
    const value = m[2] ?? m[3];
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

// Rules 1 and 2 rewrite only when EVERY command-position word of the whole
// command (top level, subshells, $( … ) alike) is a plain literal outside the
// runner set: an allowlist, because a denylist of runner spellings kept leaking
// (`builtin source`, `"$(echo .)" ./f`, `$SRC ./f`, `trap "…" DEBUG`). A command
// word that is an expansion, quoted, escaped or globbed declines; so does any
// operator or redirection this walk cannot place with certainty.
const PLAIN_COMMAND_WORD = /^[A-Za-z0-9_\/][A-Za-z0-9_.\/+-]*$/;
// `[` and `test` never evaluate an operand as arithmetic (probed under bash and
// zsh with N=P=5 against -eq/-ne/-lt/-le/-gt/-ge); `[[` does, so it is declined.
const TEST_COMMAND_WORDS = new Set(['[']);
// The reserved words kept as safe: the next word is a command word, checked like
// any other, and none of them takes an operand. `fi` is safe as the word itself.
// `if` short forms (`if [[ … ]] cmd`, `if (( … )) cmd`) need `[[`, `((` or `{`,
// all of which decline.
const KEYWORD_PREFIXES = new Set(['if', 'then', 'else', 'elif']);
// External programs: they cannot touch this shell's variables, and their flags
// (`env -i`) come before the command they run.
const EXTERNAL_PREFIXES = new Set(['nohup', 'env']);
// Every other bash/zsh reserved word and zsh precommand modifier (bash(1) and
// zshmisc "RESERVED WORDS", zshmisc "PRECOMMAND MODIFIERS"). Each opens a grammar
// position this walk reads as plain arguments: zsh's `repeat 1 . ./f`, `for x
// (a) . ./f`, `foreach … end`, `case … esac`, loop bodies, `{ … }`, `time`.
// The rest of those lists (`function`, `coproc`, zsh's `declare`/`export`/
// `float`/`integer`/`local`/`readonly`/`typeset`, the modifiers `builtin`/
// `command`/`exec`) are in RUNNERS; the two sets stay disjoint.
const RESERVED_WORDS = new Set([
  '!', '{', '}', '[[', ']]', 'case', 'esac', 'do', 'done', 'for', 'foreach', 'end', 'in', 'select',
  'until', 'while', 'repeat', 'time', 'nocorrect', 'noglob', '-',
]);
// Builtins that evaluate an operand as an arithmetic expression, which can
// assign (`let N` with N=P=5 sets P): `let` in both shells; `shift`, `break`,
// `continue`, `return` (and `repeat`, `printf %d`, `read -t`, listed elsewhere)
// in zsh, probed. `exit` evaluates too but ends the shell, so nothing later can
// read the variable.
const ARITHMETIC_BUILTINS = new Set(['let', 'shift', 'break', 'continue', 'return']);
// Module and completion builtins that assign a parameter named by an operand,
// so a name computed at runtime (`V=$(echo p | tr a-z A-Z); zstyle -s :x y "$V"`)
// reassigns a variable the text never spells (zshmodules; bash 5.3 compgen -V).
// zsh/zutil (zstyle, zformat, zregexparse) and core getln reassign under plain
// `zsh -f`; the others once their module is loaded, which a user's shell
// snapshot may already have done (probed with zmodload: zsh/system, zsh/stat,
// zsh/pcre, zsh/zpty). zparseopts, vared, print/printf -v, read, the typeset
// family, mapfile, wait -p and strftime are in RUNNERS.
const NAME_ASSIGNING_BUILTINS = new Set([
  'zstyle', 'zformat', 'zregexparse', 'getln', 'sysread', 'syswrite', 'sysopen', 'zsystem', 'syserror', 'zstat', 'stat',
  'zselect', 'zpty', 'zcurses', 'ztie', 'zuntie', 'zgetattr', 'zlistattr', 'pcre_match', 'nameref', 'compadd', 'compset',
  'compquote', 'comparguments', 'compvalues', 'compdescribe', 'comptags', 'comptry', 'compfiles', 'compgroups', 'compgen',
]);
// Builtins that run code from the command text, or assign a variable whose name
// can be computed at runtime (`printf -v "$N"`, `read "$N"`, `wait -p "$N"`), or
// change how later words parse, in bash or zsh.
const RUNNERS = new Set([
  '.', 'source', 'eval', 'trap', 'builtin', 'command', 'exec', 'enable', 'disable', 'alias', 'unalias', 'functions',
  'function', 'autoload', 'emulate', 'set', 'setopt', 'unsetopt', 'shopt', 'export', 'declare', 'typeset', 'local',
  'readonly', 'integer', 'float', 'private', 'read', 'vared', 'printf', 'print', 'unset', 'getopts', 'zparseopts',
  'mapfile', 'readarray', 'wait', 'fc', 'r', 'coproc', 'zmodload', 'strftime', 'sched', 'hash', 'bindkey', 'zle',
]);
const SEPARATOR_OPS = new Set([';', '&', '&&', '|', '||', '|&']);
const REDIRECT_OPS = new Set(['<', '>', '>>', '<>', '>&', '<&', '&>', '&>>']);
const OP_CHAR = /[;&|<>]/;
const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const PREFIX_FLAG = /^-[A-Za-z0-9-]*$/;
const FD_NUMBER = /^[0-9]+$/;

// True when the command evaluates something as arithmetic, which in both shells
// evaluates a variable's VALUE recursively and can assign (`echo $(( N ))` with
// N=P=5 sets P): `$((`, `$[` (also inside "…"), `((`, and an array subscript (an
// identifier character right before an unquoted `[`, e.g. zsh's `$a[$N]`; a
// superset that also catches globs like `f1[ab]`). `[[` (arithmetic in `-eq`
// and friends), the arithmetic builtins and `declare -i`-style attributes are
// command words, declined in commandWordsPlain.
function hasArithmetic(s, kind) {
  for (let i = 0; i < s.length; i += 1) {
    const k = kind[i];
    if (k === SQ || k === SKIP) continue;
    const c = s[i];
    if (c === '$' && (s.startsWith('$((', i) || s[i + 1] === '[')) return true;
    if (k === DQ) continue;
    if (c === '(' && s[i + 1] === '(') return true;
    if (c === '[' && i > 0 && IDENT_CHAR.test(s[i - 1]) && kind[i - 1] !== SQ) return true;
  }
  return false;
}

// The gate rules 1 and 2 apply to their own rewrite.
function inlineContextSafe(out, from) {
  const sc = scan(out);
  return commandWordsPlain(out, sc, from) && !hasArithmetic(out, sc.kind);
}

// True when every command-position word from `from` on is allowlisted.
function commandWordsPlain(s, sc, from = 0) {
  const { kind, subMark } = sc;
  const n = s.length;
  const fresh = () => ({ word: '', cmdPos: true, prefix: false, redirect: false });
  let st = fresh();
  const saved = [];
  const unquoted = (j) => kind[j] === TOP || kind[j] === SUB;
  // Ends the current word; false when it is a command word off the allowlist.
  const finish = () => {
    const raw = st.word;
    st.word = '';
    if (!raw) return true;
    if (st.redirect) {
      st.redirect = false; // the redirection's target, never a command word
      return true;
    }
    if (!st.cmdPos) return true;
    if (ASSIGNMENT_PREFIX.test(raw)) return true; // `X=1 cmd`: cmd is next
    if (st.prefix && PREFIX_FLAG.test(raw)) return true; // `env -i cmd`
    if (RESERVED_WORDS.has(raw) || RUNNERS.has(raw) || ARITHMETIC_BUILTINS.has(raw)) return false;
    if (NAME_ASSIGNING_BUILTINS.has(raw)) return false;
    if (!(PLAIN_COMMAND_WORD.test(raw) || TEST_COMMAND_WORDS.has(raw))) return false;
    if (KEYWORD_PREFIXES.has(raw)) {
      st.prefix = false;
      return true;
    }
    if (EXTERNAL_PREFIXES.has(raw)) {
      st.prefix = true;
      return true;
    }
    st.cmdPos = false;
    st.prefix = false;
    return true;
  };
  const commandStart = () => {
    st.cmdPos = true;
    st.prefix = false;
  };
  let i = from;
  while (i < n) {
    const c = s[i];
    if (subMark[i] & SUB_OPEN) {
      // A $( … ) inside a redirection target is a target computed at runtime.
      if (st.redirect) return false;
      st.word += c; // the enclosing word is now an expansion
      saved.push(st);
      st = fresh();
      i += 1;
      continue;
    }
    if (subMark[i] & SUB_CLOSE) {
      if (!finish() || st.redirect || !saved.length) return false;
      st = saved.pop();
      i += 1;
      continue;
    }
    if (unquoted(i) && WORD_BREAK.test(c)) {
      if (c === ' ' || c === '\t') {
        if (!finish()) return false;
        i += 1;
        continue;
      }
      if (c === '\n' || c === '(' || c === ')') {
        if (!finish() || st.redirect) return false;
        commandStart();
        i += 1;
        continue;
      }
      let j = i;
      while (j < n && OP_CHAR.test(s[j]) && unquoted(j) && !subMark[j]) j += 1;
      const op = s.slice(i, j);
      if (REDIRECT_OPS.has(op)) {
        if (FD_NUMBER.test(st.word)) st.word = '';
        else if (!finish()) return false;
        // A missing target, or zsh's `>!` clobber (whose `!` would read as the
        // target, handing the command position to the real target word). A
        // process substitution (`>(…)`) declines in the `(` branch above.
        if (st.redirect || s[j] === '!') return false;
        st.redirect = true;
      } else if (SEPARATOR_OPS.has(op)) {
        if (!finish() || st.redirect) return false;
        commandStart();
      } else {
        return false; // `>|`, `;;`, `;&`, `&|`, …: not placed with certainty
      }
      i = j;
      continue;
    }
    st.word += c;
    i += 1;
  }
  return !saved.length && finish() && !st.redirect;
}

// Rule 1: inline a literal the command itself assigned at its start.
function inlineLiteralAssignment(s) {
  if (s.includes('IFS')) return null;
  const { list, bodyStart } = leadingAssignments(s);
  if (!list.length) return null;
  const sc = scan(s);
  if (inDoubt(s, sc) || sc.flags.complexParam) return null;
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
  const out = replaceSpans(s, refs, valueOf);
  // Judged on the rewrite, so an inlined command word (`$P/echo`) counts as the
  // literal it becomes; the literal leading assignments are skipped.
  return inlineContextSafe(out, bodyStart) ? out : null;
}

// Rule 2: ${CLAUDE_PLUGIN_ROOT} → the running plugin's own root.
function pluginRootPlaceholder(s, { pluginRoot }) {
  const name = 'CLAUDE_PLUGIN_ROOT';
  if (!s.includes(name) || s.includes('IFS')) return null;
  if (typeof pluginRoot !== 'string' || !path.isAbsolute(pluginRoot) || !LITERAL_VALUE.test(pluginRoot)) return null;
  if (hasBareUse(s, name)) return null; // the command assigns or unsets it itself
  const sc = scan(s);
  if (inDoubt(s, sc) || sc.flags.complexParam) return null;
  const refs = sc.refs.filter((r) => r.name === name);
  if (!refs.length || !refsInlineSafely(s, sc, refs, () => pluginRoot)) return null;
  // Other plugins' prose spells the same placeholder for THEIR root: inline only
  // a reference that continues into a path this plugin actually ships.
  if (!refs.every((r) => shippedUnder(pluginRoot, s, r.end))) return null;
  const out = replaceSpans(s, refs, () => pluginRoot);
  return inlineContextSafe(out, leadingAssignments(out).bodyStart) ? out : null;
}

const ROOT_CONTINUATION = /\/[A-Za-z0-9_.\/@%+,-]+/y;
const PARENT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/;

// The continuation must name a file under this plugin's bin/ that exists: not a
// layout every plugin shares (`/.claude-plugin/plugin.json`, `/hooks/hooks.json`,
// `/bin`), and not skills/, where generic directory names collide (another
// plugin's `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md` would resolve to a
// claude-tweaks file of the same name). A `.` segment declines (`bin/./x.js`).
// Residual: a same-named file under another plugin's bin/.
function shippedUnder(root, s, at) {
  ROOT_CONTINUATION.lastIndex = at;
  const m = ROOT_CONTINUATION.exec(s);
  if (!m || PARENT_SEGMENT.test(m[0])) return false;
  const segments = m[0].split('/').filter(Boolean);
  if (segments[0] !== 'bin' || segments.length < 2 || segments.includes('.')) return false;
  const { type } = lstatType(path.join(root, ...segments));
  return type === 'file' || type === 'symlink';
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
    // Resume the global regex after the segment just scanned, so a `node -e` inside this
    // segment's own arguments is never matched (and given a second `--`) as a command of its own.
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
    const start = m.index;
    const end = start + word.length;
    if (!word.includes('\\ ') || sc.kind[start] !== TOP) continue;
    if (!atWordStart(s, sc.kind, start) || (end < s.length && !WORD_BREAK.test(s[end]))) continue;
    // Tilde expansion (leading, or after `=`/`:`), zsh's leading =cmd, and an
    // assignment word all stop meaning the same thing once quoted.
    if (word[0] === '~' || word[0] === '=' || ASSIGNMENT_WORD.test(word) || /[=:]~/.test(word)) continue;
    edits.push({ start, end, text: `"${word.replace(/\\ /g, ' ')}"` });
  }
  if (!edits.length) return null;
  return replaceSpans(s, edits, (edit) => edit.text);
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
  const target = m[1] ?? m[2] ?? m[3];
  const rest = s.slice(m[0].length);
  // `cd X && # note` is a syntax error; `# note` alone is not.
  if (!/\S/.test(rest) || rest[0] === '#' || OLDPWD_USE.test(rest)) return null;
  if (!path.isAbsolute(target) || target.includes('~') || target.includes('$')) return null;
  if (trimSlashes(target) !== trimSlashes(cwd)) return null;
  const real = canonicalRealpath(target);
  if (real === null || real !== canonicalRealpath(cwd)) return null;
  return rest;
}

// The order is load-bearing: each rule reads the previous rule's output. drop-redundant-cd runs
// first so the leading `A=1; …` assignments that inline-literal-assignment and plugin-root-placeholder
// look for sit at the start of the command once a redundant `cd <cwd> &&` is gone; the node-eval and
// quote rules only reshape arguments and run last. The ids are exported (RULE_IDS) so a test pins
// them against the prose that lists them (docs/hooks.md, the probe reference doc, scratch-worktree §7).
const RULES = [
  ['drop-redundant-cd', dropRedundantCd],
  ['inline-literal-assignment', inlineLiteralAssignment],
  ['plugin-root-placeholder', pluginRootPlaceholder],
  ['node-eval-separator', nodeEvalSeparator],
  ['quote-escaped-space', quoteEscapedSpace],
];
const RULE_IDS = RULES.map(([id]) => id);

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

module.exports = { rewriteForGuard, guardRewriteOutput, isLinkedWorktree, RULE_IDS };
