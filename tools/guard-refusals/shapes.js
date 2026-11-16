'use strict';
// tools/guard-refusals/shapes.js — #4028: static detectors for the Bash shapes
// Claude Code's worktree isolation guard refuses, one per refused row of
// plugin/skills/_shared/scratch-worktree.md section 7. Each detector names the
// row it covers by that row's exact Example cell (`row`), and
// tests/guard-refusals/shapes.test.js holds the two in lockstep: every refused
// row is flagged by its bound detector (or excused in UNDETECTED_ROWS), and no
// detector fires on a passes-row example.
//
// The detectors read command text, not a parse: they are regex/token
// predicates over one Bash call's text (a fence body, or a transcript command).

// A runtime variable reference: $NAME or ${NAME (not $?, $1, $$).
const VAR = String.raw`\$\{?[A-Za-z_]`;
// A command word boundary: the word is not part of a path, flag or longer name;
// or, in command position only, the word carries an absolute or relative path
// prefix (`/usr/local/bin/node`, `./bin/node`), which runs the same program.
// Command position: text or line start, or after ; & | ( ! (so &&, ||, $( too)
// or a then/do/else/if/while/until keyword, then optional blanks and NAME=value
// env assignments. An argument such as `cat dir/node "$X/y"` is not a command.
const PATH_PREFIX = String.raw`(?:[\w.~-]*\/)+`;
const CMD_POSITION = String.raw`(?<=(?:^|[\n;&|(!]|\b(?:then|do|else|if|while|until)\s)[ \t]*(?:[A-Za-z_]\w*=[^\s;&|()<>]*[ \t]+)*)`;
const CMD = String.raw`(?:(?<![\w./-])|${CMD_POSITION}${PATH_PREFIX})`;

const HEREDOC_OP = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([A-Za-z_]\w*))/;

// Index just past the `))` closing the arithmetic `((` at `start` (paren
// depth counted), or the end of text when it never closes.
function arithmeticEnd(text, start) {
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    if (text[j] === '(') depth++;
    else if (text[j] === ')' && --depth === 0) return j + 1;
  }
  return text.length;
}

// One left-to-right shell-lexing pass: the state of each char of `text`, one of
// 'plain', 'delim' (a quote char that opens or closes a span), 'single',
// 'double' or 'comment'. Pairing quotes with a regex instead lets an apostrophe
// in a `#` comment or inside "…" pair with a later quote and hide the commands
// between them. Outside quotes a backslash escapes the next char; inside "…" a
// backslash escape does not close the quote; inside '…' nothing escapes. `#`
// at word start, outside quotes, opens a comment that runs to end of line. A
// quote left open at end of line stays open across the newline, as in shell.
// A heredoc operator (`<<WORD`, `<<'WORD'`, `<<"WORD"`, `<<-WORD`) outside
// quotes and comments makes the lines after its own line, up to and including
// the delimiter line, 'heredoc' data: an apostrophe there is not a quote, and a
// banned word there is not a command. `<<-` allows leading tabs on the
// delimiter line. A heredoc whose delimiter line never appears is not one:
// its "body" is lexed as shell rather than hidden to end of text (shell only
// warns there). `<<` inside `$((…))` or `((…))` is an arithmetic shift.
// An ANSI-C `$'…'` outside quotes is a single-quote span in which a backslash
// escapes the next char (`$'it\'s'` closes at its last apostrophe); its `$` is
// a 'delim' like the quote. Inside "…" a `$'` is literal text.
function lexShell(text) {
  const kinds = new Array(text.length);
  let state = 'plain';
  let pending = []; // heredocs opened on the current line: { delim, tabs }
  let arithEnd = 0; // inside `((…))` until this index
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' && pending.length && (state === 'plain' || state === 'comment')) {
      kinds[i] = 'plain';
      state = 'plain';
      i = markHeredocBodies(text, i + 1, pending, kinds) - 1;
      pending = [];
      continue;
    }
    if (state === 'single') {
      if (c === "'") { kinds[i] = 'delim'; state = 'plain'; } else kinds[i] = 'single';
    } else if (state === 'ansi') {
      if (c === '\\' && i + 1 < text.length) { kinds[i] = 'single'; kinds[++i] = 'single'; } else if (c === "'") { kinds[i] = 'delim'; state = 'plain'; } else kinds[i] = 'single';
    } else if (state === 'double') {
      if (c === '\\' && i + 1 < text.length) { kinds[i] = 'double'; kinds[++i] = 'double'; } else if (c === '"') { kinds[i] = 'delim'; state = 'plain'; } else kinds[i] = 'double';
    } else if (state === 'comment') {
      if (c === '\n') { kinds[i] = 'plain'; state = 'plain'; } else kinds[i] = 'comment';
    } else if (c === '\\' && i + 1 < text.length) {
      kinds[i] = 'plain'; kinds[++i] = 'plain';
    } else if (c === '(' && text[i + 1] === '(' && i >= arithEnd) {
      arithEnd = arithmeticEnd(text, i);
      kinds[i] = 'plain';
    } else if (c === '<' && i >= arithEnd && text[i - 1] !== '<' && text[i + 2] !== '<' && HEREDOC_OP.test(text.slice(i, i + 256))) {
      const m = HEREDOC_OP.exec(text.slice(i, i + 256));
      pending.push({ delim: m[2] || m[3] || m[4], tabs: m[1] === '-' });
      // Only the `<<-` operator is consumed here; a quoted delimiter is lexed
      // as an ordinary quote span on the operator line.
      kinds[i] = 'plain'; kinds[++i] = 'plain';
      if (m[1] === '-') kinds[++i] = 'plain';
    } else if (c === '$' && text[i + 1] === "'") {
      kinds[i] = 'delim'; kinds[++i] = 'delim'; state = 'ansi';
    } else if (c === "'" || c === '"') {
      kinds[i] = 'delim'; state = c === "'" ? 'single' : 'double';
    } else if (c === '#' && (i === 0 || /[\s;&|()<>]/.test(text[i - 1]))) {
      kinds[i] = 'comment'; state = 'comment';
    } else kinds[i] = 'plain';
  }
  return kinds;
}

// Mark each pending heredoc's body lines, from `start`, as 'heredoc' through
// its delimiter line; returns the index where shell text resumes. When any
// pending delimiter line never appears, nothing is marked and shell text
// resumes at `start`.
function markHeredocBodies(text, start, pending, kinds) {
  const spans = [];
  let i = start;
  for (const { delim, tabs } of pending) {
    let found = false;
    while (i < text.length && !found) {
      let end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
      const line = text.slice(i, end).replace(/\r$/, '');
      spans.push([i, end]);
      i = end + 1;
      found = (tabs ? line.replace(/^\t+/, '') : line) === delim;
    }
    if (!found) return start;
  }
  for (const [from, end] of spans) {
    for (let j = from; j < end; j++) kinds[j] = 'heredoc';
    if (end < text.length) kinds[end] = 'plain';
  }
  return Math.min(i, text.length);
}

// `text` with every char whose lexed state is in `states` blanked to a space,
// line breaks kept, so length and line structure survive.
function blankStates(text, states) {
  const kinds = lexShell(text);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    out += states.has(kinds[i]) && c !== '\n' && c !== '\r' ? ' ' : c;
  }
  return out;
}

// Literal text inside single quotes never expands, comment text never runs and
// a heredoc body is data, so keyword and variable detectors judge the text with
// those emptied. Double-quoted content stays: a "$VAR" operand is what several
// detectors key on.
const SINGLE_AND_COMMENT = new Set(['single', 'comment', 'heredoc']);
function stripSingle(text) {
  return blankStates(text, SINGLE_AND_COMMENT);
}

// Every quoted span's content (and comment and heredoc text) emptied, for
// detectors that judge shell structure (operators, redirects, unquoted tokens)
// rather than argument content.
const QUOTED_AND_COMMENT = new Set(['single', 'double', 'comment', 'heredoc']);
function stripQuoted(text) {
  return blankStates(text, QUOTED_AND_COMMENT);
}

function keyword(word) {
  const re = new RegExp(`(?<![\\w./-])${word}(?![\\w./-])`, 'i');
  return (text) => re.test(stripSingle(text));
}

// The value of every shell word of `text` after quote removal. Words split on
// unquoted whitespace and on the operator chars ;&|()<>; comment and heredoc
// text belongs to no word. An outside-quotes backslash escape keeps the
// escaped char only.
function shellWords(text) {
  const kinds = lexShell(text);
  const words = [];
  let cur = null;
  const flush = () => { if (cur !== null) words.push(cur); cur = null; };
  for (let i = 0; i < text.length; i++) {
    const k = kinds[i];
    const c = text[i];
    if (k === 'comment' || k === 'heredoc') { flush(); continue; }
    if (k === 'delim') { cur = cur ?? ''; continue; }
    if (k === 'plain') {
      if (/[\s;&|()<>]/.test(c)) { flush(); continue; }
      if (c === '\\' && kinds[i + 1] === 'plain' && i + 1 < text.length) { cur = (cur ?? '') + text[++i]; continue; }
    }
    cur = (cur ?? '') + c;
  }
  flush();
  return words;
}

// The guard refuses a shell word whose whole value, quoted or bare, is `word`;
// a word that merely contains it (`"task complete"`, a `node -e` script) passes.
// Any letter case: `echo COMPLETE`, `echo Eval` and `grep -c "Source" f` were
// refused live (2026-11-16, #5590).
function wholeWord(word) {
  return (text) => shellWords(text).some((w) => w.toLowerCase() === word);
}

// A `git` command with an argument word whose basename (text after the last
// `/`) is `git` or `git-…`, any case, after quote removal: `-- git`, `-- x/git-y`,
// `--grep "git"` were refused live (2026-11-16, #5590); `gitx`, `x-git`,
// `git.md`, `--grep=git` and `"git x"` ran.
const GIT_BASENAME = /^git(?:-[\w-]*)?$/i;
function gitWordArgument(text) {
  const { bare } = views(text);
  // A `$(` or `(` ends the argument list read here: a nested `git` is its own
  // command word, not an argument of this one.
  return commandSegments(bare, 'git').some(([s, e]) => {
    const open = bare.slice(s, e).indexOf('(');
    // A backslash-newline continuation vanishes in shell, joining the word it splits.
    return shellWords(text.slice(s, open === -1 ? e : s + open).replace(/(?<!\\)((?:\\\\)*)\\\r?\n/g, '$1')).slice(1).some((w) => GIT_BASENAME.test(w.slice(w.lastIndexOf('/') + 1)));
  });
}

// A `'` or `"` inside an open `{` in a heredoc body (either delimiter quoting)
// was refused live (2026-11-16, #5590). The brace depth counts over heredoc
// chars only and resets at any other non-newline char, so it never spans a
// non-heredoc gap.
function heredocBraceQuote(text) {
  const kinds = lexShell(text);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (kinds[i] !== 'heredoc') {
      if (text[i] !== '\n') depth = 0;
      continue;
    }
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if ((c === "'" || c === '"') && depth > 0) return true;
  }
  return false;
}

// A call whose last quote never closes: `grep -c "^# " "README.md` was refused live (2026-11-16,
// #5590); the same call with the quote closed ran. A char appended on a new line lexes as quoted
// content exactly when a quote is still open at the end: the newline ends a comment and leaves a
// closing heredoc delimiter line whole.
function unterminatedQuote(text) {
  const last = lexShell(`${text}\nx`)[text.length + 1];
  return last === 'single' || last === 'double';
}

// A backslash right before a space inside a quoted span, single or double: `grep -c "a\ b" f`,
// `grep -c 'a\ b' f` and `grep -c "a\\ b" f` were refused live (2026-11-16, #5590); `"a\\b"` ran.
function quotedBackslashSpace(text) {
  const kinds = lexShell(text);
  for (let i = text.indexOf('\\ '); i !== -1; i = text.indexOf('\\ ', i + 1)) {
    if ((kinds[i] === 'single' || kinds[i] === 'double') && kinds[i + 1] === kinds[i]) return true;
  }
  return false;
}

// A word that starts with `=` and a letter, right after a space or a `|`, quoted or bare (zsh reads a
// bare `=name` as a command path): `grep -c "x =require" f`, `'x =require'`, `"a\|=token"`, `"a|=b"`
// and a bare `=y` were refused live (2026-11-16, #5590); `"=require"`, `"x = require"`, `"x =1"`,
// `"a(=b"`, `"a,=b"` and `"x == y"` ran. Comment and heredoc text was not probed and is not read.
function equalsWord(text) {
  const kinds = lexShell(text);
  for (const m of text.matchAll(/[ |]=[A-Za-z]/g)) {
    const k = kinds[m.index + 1];
    if (k === 'plain' || k === 'single' || k === 'double') return true;
  }
  return false;
}

// Index just past the call's leading run of `NAME=value` statements, each ended by `;`, `&&` or a
// newline. A hand scan: a regex over the same run can split a blank run every way.
function leadingAssignmentsEnd(text, kinds) {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    const m = /^[A-Za-z_]\w{0,255}=/.exec(text.slice(i, i + 258));
    if (!m || kinds[i] !== 'plain') return i;
    let j = i + m[0].length;
    while (j < text.length && !(kinds[j] === 'plain' && /[\s;&|()<>]/.test(text[j]))) j++;
    while (text[j] === ' ' || text[j] === '\t') j++;
    if (text[j] === ';' || text[j] === '\n') i = j + 1;
    else if (text[j] === '&' && text[j + 1] === '&') i = j + 2;
    else return i;
  }
}

// The text `git` anywhere in the call (a case-insensitive substring, as for git-text-redirect-var)
// plus a reference to a literally assigned name whose assignment follows another command. Live
// 2026-11-16 (#5590): `pwd; F="README.md"; grep -c "digit" "$F"`, `pwd; F="README.md"; git log -1 --
// "$F"` and `cd /tmp; W="<own worktree>"; git -C "$W" log -1` were refused ("names git in a form too
// complex"); the same calls with the assignment first, with no `git` text, or with the name never
// referenced ran. A computed value is the older detectors' case, so only a literal one counts here.
// The assignment test is staticNames' (ASSIGN_CONTEXT, LITERAL_VALUE) over fixed windows: staticNames
// itself rescans the line once per assignment (115 s on `A=1; ` x 40000, measured 2026-11-16).
const CONTEXT_WINDOW = 256;
const VALUE_WINDOW = 4096;
function gitTextLateVar(text) {
  if (!/git/i.test(text)) return false;
  const kinds = lexShell(text);
  const lead = leadingAssignmentsEnd(text, kinds);
  const bare = stripQuoted(text);
  const late = new Set();
  for (const m of text.matchAll(/(?<![\w$-])([A-Za-z_]\w*)=/g)) {
    if (m.index < lead || kinds[m.index] !== 'plain') continue;
    const before = bare.slice(Math.max(0, m.index - CONTEXT_WINDOW), m.index);
    if (!ASSIGN_CONTEXT.test(before.slice(before.lastIndexOf('\n') + 1))) continue;
    const at = m.index + m[0].length;
    if (LITERAL_VALUE.test(text.slice(at, at + VALUE_WINDOW))) late.add(m[1]);
  }
  if (late.size === 0) return false;
  return [...stripSingle(text).matchAll(/\$\{?([A-Za-z_]\w*)/g)].some((m) => late.has(m[1]));
}

const GH_JQ_PIPE = new RegExp(`${CMD}gh\\s[^\\n]*--jq[\\s=]+(?:'[^']*\\|[^']*'|"[^"]*\\|[^"]*")`);
const GH_REPO_URL = new RegExp(`${CMD}gh\\s[^\\n]*--repo[\\s=]+["']?(?:https?://)?github\\.com/`);
// Start of the latest `seps` separator that ends at or before the last `status` in text[start, end)
// (one line), or -1.
function latestSeparator(text, start, end, seps, status) {
  if (end - start < status.length) return -1;
  const found = text.slice(start, end).lastIndexOf(status);
  if (found < 0) return -1;
  const at = start + found;
  for (let p = at - 1; p >= start; p -= 1) {
    if (seps.some((s) => p + s.length <= at && text.startsWith(s, p))) return p;
  }
  return -1;
}

// True when a command-position `<word>\s` is chained by one of `seps` onto `status` on the line the
// text after it continues: what `<word>\s[^\n]*?(?:seps)[^\n]*status` matches, without its
// backtracking (seconds on 7,000 characters of `git x; `). The `\s` may be the `\n` itself, so the
// chain is read from just past it. Each line's latest separator is computed once, when the first
// match reaches that line (linear).
function chainedStatus(word, seps, status) {
  const command = new RegExp(`${CMD}${word}\\s`, 'g');
  return (text) => {
    command.lastIndex = 0;
    let lineEnd = -1;
    let sepAt = -1;
    while (command.exec(text) !== null) {
      const from = command.lastIndex;
      if (from > lineEnd) {
        const lineStart = text.lastIndexOf('\n', from - 1) + 1;
        lineEnd = text.indexOf('\n', from);
        if (lineEnd < 0) lineEnd = text.length;
        sepAt = latestSeparator(text, lineStart, lineEnd, seps, status);
      }
      if (from <= sepAt) return true;
    }
    return false;
  };
}

const GH_CHAINED_STATUS = chainedStatus('gh', [';', '&&'], '$?');
const GIT_COMMAND = new RegExp(String.raw`(?:(?:^|[\s;&|(])|${CMD_POSITION}${PATH_PREFIX})git\s+[a-z]`, 'm');
const GIT_IN_SUBSTITUTION = new RegExp(String.raw`\$\(\s*(?:${PATH_PREFIX})?git\s`);
const NODE_EVAL_SCRIPT_VAR = new RegExp(`${CMD}node\\s+(?:-e|-p|--eval|--print)\\s+"[^"]*${VAR}`);
// `>file`, `>>file`, and bash's `&>file` / `&>>file` (stdout and stderr).
const STDOUT_FILE_REDIRECT = /(?:&|(?<![<>&\d]))>>?(?!&)\s*\S/;

// Two same-length views of one Bash call, backslash-newline continuations
// joined: `bare` (quoted, comment and heredoc text blanked: shell structure)
// and `args` (single-quoted, comment and heredoc text blanked: what expands).
function views(text) {
  // Only an unescaped backslash continues a line: `\\` + newline is a literal backslash, then a real break.
  const join = (s) => s.replace(/(?<!\\)((?:\\\\)*)(\\\r?\n)/g, (m, pre, cont) => pre + ' '.repeat(cont.length));
  return { bare: join(stripQuoted(text)), args: join(stripSingle(text)) };
}

// [start, end) of each simple command whose command word is `word`: the word
// at command position (line start, after ; & | ( !, or after a then/do/else/
// if/while/until keyword) in `bare`, through the next ; & | ) or line end.
function commandSegments(bare, word) {
  const re = new RegExp(`(?:^|[;&|(!]|\\b(?:then|do|else|if|while|until)\\s)[ \\t]*(?:${PATH_PREFIX})?${word}(?=[ \\t]|$)`, 'gm');
  const out = [];
  for (const m of bare.matchAll(re)) {
    const start = m.index + m[0].length - word.length;
    const stop = bare.slice(start).search(/[;&|)\n]/);
    out.push([start, stop === -1 ? bare.length : start + stop]);
  }
  return out;
}

// The segment's `args` text with each output redirect (`>`, `>>`, `2>`, `&>`
// and its target) blanked: an output path is not an operand.
function operandText(bare, args, start, end) {
  const seg = args.slice(start, end).split('');
  for (let i = start; i < end; i++) {
    if (bare[i] !== '>') continue;
    const len = /^>>?[ \t]*(?:"[^"\n]*"|[^\s;&|]+)?/.exec(args.slice(i, end))[0].length;
    for (let j = 0; j < len; j++) seg[i - start + j] = ' ';
    i += len - 1;
  }
  return seg.join('');
}

// Names the guard resolves statically: every assignment to the name in the
// call is a literal (`N=5`, `N="a b"`, `N='x'`, a `for N in` list with no `$`
// or backtick). Live 2026-10-24 (#4028): `L=1; gh … --limit "$L"`, `for n in
// 4028; do gh issue view "$n" …`, `W="/abs/wt"; git -C "$W" …` and
// `A=/abs/p.txt; echo digit > "$A"` all ran. A name assigned from `$(…)`,
// `read` or a glob loop, or never assigned in the call (the environment), is
// runtime-computed. Order does not matter, by measurement: live 2026-10-25
// (#4028 re-review), `node "$P/ct-probe-4028-nonexistent.js"; P=/tmp` ran (it
// hit MODULE_NOT_FOUND for `/ct-probe-4028-nonexistent.js`, so P was empty at
// the reference) while the same call with no assignment was refused ("runs node
// with a value computed at runtime (the variable P) …"); the guard resolves a
// literally assigned name wherever the assignment sits, so do not make this
// order-sensitive. The gh/git/redirect detectors apply it to every
// reference; the older sed/node/github-url detectors only to a double-quoted
// one (literalizeQuotedStatic), since node's script operand refuses an
// unquoted literal name (`Q=/abs/nospace && node $Q/x.js`).
const LITERAL_VALUE = /^(?:'[^']*'|"[^"$`\\]*"|[^\s;&|()<>$`'"\\]*)(?=[\s;&|)]|$)/;
const ASSIGN_CONTEXT = /(?:^|[;&|(]|\b(?:then|do|else|export|local|readonly)|[A-Za-z_]\w*=(?:"[^"\n]*"|'[^'\n]*'|\S*))[ \t]*$/;
function staticNames(text) {
  const kinds = lexShell(text);
  const bare = stripQuoted(text);
  const literal = new Map();
  const mark = (name, ok) => literal.set(name, (literal.get(name) ?? true) && ok);
  const lineBefore = (at) => bare.slice(bare.lastIndexOf('\n', at - 1) + 1, at);
  for (const m of text.matchAll(/(?<![\w$-])([A-Za-z_]\w*)=/g)) {
    if (kinds[m.index] !== 'plain' || !ASSIGN_CONTEXT.test(lineBefore(m.index))) continue;
    mark(m[1], LITERAL_VALUE.test(text.slice(m.index + m[0].length)));
  }
  // A loop list with an expansion or a glob char is computed (live 2026-10-25:
  // `for f in *.json; do gh … "$f"; done` was refused).
  for (const m of bare.matchAll(/(?<![\w-])for[ \t]+([A-Za-z_]\w*)[ \t]+in[ \t]([^;\n]*)/g)) {
    const listAt = m.index + m[0].length - m[2].length;
    mark(m[1], !/[$`*?[]/.test(text.slice(listAt, m.index + m[0].length)));
  }
  for (const m of bare.matchAll(/(?<![\w-])read[ \t]+(?:-\w+[ \t]+)*([A-Za-z_]\w*(?:[ \t]+[A-Za-z_]\w*)*)/g)) {
    for (const name of m[1].split(/[ \t]+/)) mark(name, false);
  }
  return new Set([...literal].filter(([, ok]) => ok).map(([name]) => name));
}

// `text` with the `$` of every double-quoted reference to a staticNames name
// (`"$P/x.js"`, `"${P}"`) turned into `_`, same length, for the older
// detectors that key on a bare `$`. Live 2026-10-24/25 (#4028): `P="/abs
// path"` then `node "$P/x.js"`, and `export P=/abs && node "$P/x.js"`, ran;
// the UNQUOTED `Q=/abs/nospace && node $Q/hello.js` was refused, so an
// unquoted reference keeps its `$`.
function literalizeQuotedStatic(text) {
  const known = staticNames(text);
  if (known.size === 0) return text;
  const kinds = lexShell(text);
  const out = text.split('');
  for (const m of text.matchAll(/\$(\{)?([A-Za-z_]\w*)/g)) {
    const closed = !m[1] || text[m.index + m[0].length] === '}';
    if (kinds[m.index] === 'double' && closed && known.has(m[2])) out[m.index] = '_';
  }
  return out.join('');
}

// Whether `s` references a runtime-computed variable: a name not in `known`.
function computedRefs(s, known) {
  return [...s.matchAll(/\$\{?([A-Za-z_]\w*)/g)].some((m) => !known.has(m[1]));
}

// A `$(…)`, backtick or positional (`$1`, `$@`, `$*`) operand: computed at
// runtime. Live 2026-10-25: `git -C "$(pwd)" status --short` was refused, while
// a single `gh issue view "$(echo 4028)" …` call ran, so only git opts in.
const SUBSTITUTION_OR_POSITIONAL = /\$\(|`|\$\{?[0-9@*]/;

function hasVarOperand(text, word, { substitution = false } = {}) {
  const { bare, args } = views(text);
  const known = staticNames(text);
  return commandSegments(bare, word).some(([s, e]) => {
    const operands = operandText(bare, args, s, e);
    return computedRefs(operands, known) || (substitution && SUBSTITUTION_OR_POSITIONAL.test(operands));
  });
}

// More than one command: two non-blank lines, or a ; && || | outside quotes
// (`2>&1` and `&>` are redirects, not separators).
function isCompound(bare) {
  if (bare.split(/\r?\n/).filter((l) => l.trim()).length > 1) return true;
  return /;|&&|\|/.test(bare.replace(/\d*>&\d*|&>>?/g, ''));
}

// gh given a runtime variable as an argument or `<` stdin, in a compound call.
// Comment and heredoc text is data here, never a gh command.
function ghComputedInput(text) {
  return isCompound(views(text).bare) && hasVarOperand(text, 'gh');
}

// The guard matches `git` as a case-insensitive substring of the whole call
// text, comments and heredoc bodies included (live: `# digit` then a variable
// redirect was refused), so the substring test reads the raw text. The
// redirect itself must be an unquoted `>` whose target is a runtime variable.
function gitTextRedirectVar(text) {
  if (!/git/i.test(text)) return false;
  const { bare, args } = views(text);
  const known = staticNames(text);
  const target = /^>>?[ \t]*"?\$\{?([A-Za-z_]\w*)/;
  for (let i = 0; i < bare.length; i++) {
    const m = bare[i] === '>' && target.exec(args.slice(i, i + 64));
    if (m && !known.has(m[1])) return true;
  }
  return false;
}

// Whole-word `git` the way the guard reads node script text: `digit` and
// `git-z.js` ran, `"git log"`, `'git'` and `// the git index` were refused.
const GIT_WORD = /(?<![\w-])git(?![\w-])/i;
const NODE_EVAL_SCRIPT = new RegExp(`${CMD}node\\s+(?:-[\\w-]+(?:=\\S*)?\\s+)*?(?:-e|-p|--eval|--print)\\s+('[^']*'|"(?:[^"\\\\]|\\\\.)*")`, 'g');
const NODE_WORD = new RegExp(`${CMD}node(?![\\w.-])`);

// The script text node is fed: each -e/-p operand of a node command outside
// quotes, comments and heredoc bodies, and each heredoc body opened on a line
// whose command is node. The body is read whole, comments included.
function nodeGitText(text) {
  const kinds = lexShell(text);
  for (const m of text.matchAll(NODE_EVAL_SCRIPT)) {
    if (kinds[m.index] === 'plain' && GIT_WORD.test(m[1])) return true;
  }
  const bare = stripQuoted(text);
  let at = 0;
  for (const line of bare.split('\n')) {
    const end = at + line.length;
    if (NODE_WORD.test(line) && /(?<!<)<<(?!<)/.test(line)) {
      let body = '';
      for (let j = end + 1; j < text.length && (kinds[j] === 'heredoc' || text[j] === '\n' || text[j] === '\r'); j++) body += text[j];
      if (GIT_WORD.test(body)) return true;
    }
    at = end + 1;
  }
  return false;
}

function chainedHeredocWrite(text) {
  return stripQuoted(text).split(/\r?\n/).some((line) => {
    const segments = line.split(/&&|;/);
    return segments.length > 1
      && segments.slice(1).some((s) => /(?<!<)<<(?!<)/.test(s) && STDOUT_FILE_REDIRECT.test(s.replace(/<<-?\s*\S+/, '')));
  });
}

function graphqlMultivarMutation(text) {
  if (!new RegExp(`${CMD}gh\\s+api\\s+graphql\\b`).test(text)) return false;
  const m = /mutation\s*\(([^)]*)\)/.exec(text);
  if (!m) return false;
  if ((m[1].match(/\$\w+\s*:/g) || []).length < 2) return false;
  return /\(\s*\w+\s*:\s*\{/.test(text.slice(m.index + m[0].length));
}

// `git -C .`: the operand is the bare or quoted dot.
const GIT_C_DOT = new RegExp(`${CMD}git\\s+-C\\s+(?:\\.|"\\."|'\\.')(?=\\s|$)`, 'm');
// `git -C <operand>` with an unquoted glob char after the operand's first character, in the same
// simple command; the caller blanks quoted text. What `git\s+-C\s+\S+[^;&|\n]*[*?[]` matches,
// without its backtracking (the overlapping `\S+` and `[^;&|\n]*` rescanned the segment per
// split: seconds on 40,000 characters, pinned in perf/guard-refusals-chained-status-linearity).
// Each segment's last glob char is found once, when the first match reaches it (linear).
const GIT_C_OPERAND = new RegExp(`${CMD}git\\s+-C\\s+(?=\\S)`, 'gm');
function gitCGlob(text) {
  GIT_C_OPERAND.lastIndex = 0;
  let segEnd = -1;
  let lastGlob = -1;
  while (GIT_C_OPERAND.exec(text) !== null) {
    const from = GIT_C_OPERAND.lastIndex;
    if (from > segEnd) {
      segEnd = text.length;
      for (let p = from; p < text.length; p += 1) {
        if (';&|\n'.includes(text[p])) { segEnd = p; break; }
      }
      lastGlob = -1;
      for (let p = from + 1; p < segEnd; p += 1) {
        if ('*?['.includes(text[p])) lastGlob = p;
      }
    }
    if (lastGlob > from) return true;
  }
  return false;
}
// A git command chained by ; && or || onto `$?` on one line: unquoted, or a
// double-quoted word that is exactly "$?" ("exit=$?" runs).
const GIT_CHAINED_STATUS = chainedStatus('git', [';', '&&', '||'], '$?');
const GIT_CHAINED_QUOTED_STATUS = chainedStatus('git', [';', '&&', '||'], '"$?"');

const DETECTORS = [
  {
    id: 'complete-token',
    row: '`echo complete`',
    test: wholeWord('complete'),
  },
  {
    id: 'git-env-var-subst',
    row: '`CT_HOOKS_GIT_TIMEOUT_MS=60000 echo $(echo hi)`',
    test: (t) => t.split(/\r?\n/).some((l) => /(?:^|[\s;&|(])[A-Za-z_]*GIT\w*=/.test(l) && l.includes('$(')),
  },
  {
    id: 'github-url-with-var',
    row: '`echo "https://github.com/o/r/pull/1" --run "$RUN_DIR"`',
    // A github.com inside a comment, a single-quoted span or a heredoc body,
    // beside a runtime variable, ran in a live probe (2026-10-24, #4028).
    test: (t) => { const s = stripSingle(literalizeQuotedStatic(t)); return /github\.com/.test(s) && new RegExp(VAR).test(s); },
  },
  {
    id: 'gh-jq-pipe-chained',
    row: "`gh pr view 1 --repo o/r --json comments --jq '.comments[] \\| .id'; echo exit=$?`; `gh pr view 1 --repo github.com/o/r --json comments && echo exit=$?`",
    test: (t) => (GH_JQ_PIPE.test(t) || GH_REPO_URL.test(t)) && GH_CHAINED_STATUS(stripQuoted(t)),
  },
  {
    id: 'git-text-redirect-var',
    row: "`printf '%s' '[{\"finding\":\"the git index\"}]' > \"$CTX/f.json\"`; `A=\"$(node \"/lit/bin/session-tmp-resolve.js\" --value a.txt)\"` then `echo digit > \"$A\"`",
    test: gitTextRedirectVar,
  },
  {
    id: 'git-in-substitution',
    row: '`echo "$(git rev-parse --short HEAD)"`',
    test: (t) => GIT_IN_SUBSTITUTION.test(t),
  },
  {
    id: 'git-var-operand',
    row: "`git -C \"$PWD\" status --short`; `W=\"$(node -e 'console.log(process.cwd())')\"` then `git -C \"$W\" status --short`; `git -C \"$(pwd)\" status --short` (2026-10-25)",
    test: (t) => hasVarOperand(t, 'git', { substitution: true }),
  },
  {
    id: 'git-C-dot',
    row: '`git -C . rev-parse --short HEAD`',
    test: (t) => GIT_C_DOT.test(t),
  },
  {
    id: 'git-C-glob',
    row: '`git -C "<worktree>" grep -c X -- tools/guard-refusals/*.js`',
    test: (t) => gitCGlob(stripQuoted(t)),
  },
  {
    id: 'git-chained-status',
    row: '`git merge-base --is-ancestor HEAD HEAD; echo exit=$?`',
    test: (t) => GIT_CHAINED_STATUS(stripQuoted(t)) || GIT_CHAINED_QUOTED_STATUS(stripSingle(t)),
  },
  {
    id: 'node-eval-script-var-with-git',
    row: "`git diff --numstat -z {sha} \\| node -e \"require('${CLAUDE_PLUGIN_ROOT}/bin/lib/git-z.js')\"`",
    test: (t) => GIT_COMMAND.test(t) && NODE_EVAL_SCRIPT_VAR.test(t),
  },
  {
    id: 'node-git-text',
    row: "`node -e 'console.log(\"git log is a word here\")'`; `node - <<'EOF'` with `// the git index` in the body",
    test: nodeGitText,
  },
  {
    id: 'sed-var-path',
    row: "`sed -i '' 's/a/b/' \"$B\"`; `sed -n '1,2p' \"$P/README.md\"`",
    test: (t) => new RegExp(`${CMD}sed\\s[^;&|\\n]*\\s"?${VAR}`).test(stripSingle(literalizeQuotedStatic(t))),
  },
  {
    id: 'node-var-script',
    row: '`node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status`; `node "$HOME/x.js"`',
    test: (t) => new RegExp(`${CMD}node\\s+"?\\$[{(A-Za-z_]`).test(literalizeQuotedStatic(t)),
  },
  {
    id: 'node-eval-computed-arg',
    row: "`node -e '<s>' \"$HOME\"`; `A=\"$(node /lit/x.js …)\"` then `node -e '<s>' \"$A\"`",
    test: (t) => new RegExp(`${CMD}node\\s+(?:-e|-p|--eval|--print)\\s+(?:'[^']*'|"(?:[^"\\\\]|\\\\.)*")\\s+"?\\$`).test(literalizeQuotedStatic(t)),
  },
  {
    id: 'graphql-multivar-mutation',
    row: "`gh api graphql -f query='mutation($a:ID!,$b:ID!){ doThing(input:{a:$a,b:$b}){ clientMutationId } }' -f a=1 -f b=2`",
    test: graphqlMultivarMutation,
  },
  {
    id: 'eval-token',
    row: '`echo eval`',
    test: keyword('eval'),
  },
  {
    id: 'source-token',
    row: '`echo source`; `grep -n "source" file.md`',
    test: wholeWord('source'),
  },
  {
    id: 'gh-computed-input',
    row: "`cat > \"$TMPDIR/x.md\" <<'EOF' … EOF` then `gh pr comment N --body-file \"$TMPDIR/x.md\"`; `A=\"$(node \"/lit/bin/session-tmp-resolve.js\" --value a.txt)\"` then `gh issue view \"$A\" --repo o/r --json number`, or `gh issue view N --repo o/r --json number < \"$A\"`",
    test: ghComputedInput,
  },
  // The general chained-heredoc row and the older mkdir -p row it generalizes
  // share one detector.
  {
    id: 'chained-heredoc-write',
    row: "`mkdir -p /abs/dir && cat > /abs/dir/p.js <<'EOF'`",
    test: chainedHeredocWrite,
  },
  {
    id: 'chained-heredoc-write',
    row: "`cd \"<wt>\" && cat > f <<'EOF'`; `echo start && cat > f <<'EOF'`",
    test: chainedHeredocWrite,
  },
  {
    id: 'test-string-compare',
    row: '`test a = b`',
    test: (t) => /(?:^|[\s;&|(])test\s+[^\s"'$-]\S*\s+!?==?\s/m.test(t),
  },
  {
    id: 'git-word-argument',
    row: '`git grep -c "git-discipline" -- f.md`; `git log --oneline -1 -- git`',
    test: gitWordArgument,
  },
  {
    id: 'heredoc-brace-quote',
    row: "`node \"/lit/bin/node-eval-file.js\" a <<'EOF'`; `const r = { a: 'x' };`; `EOF`",
    test: heredocBraceQuote,
  },
  {
    id: 'backslash-space',
    row: '`ls /Users/me/Code\\ Workspaces/repo/README.md`',
    test: (t) => /[^\s\\]\\ (?=\S)/.test(stripQuoted(t)),
  },
  {
    id: 'git-text-late-var',
    row: '`pwd; F="README.md"; grep -c "digit" "$F"`',
    test: gitTextLateVar,
  },
  {
    id: 'quoted-backslash-space',
    row: '`grep -c "a\\ b" README.md`',
    test: quotedBackslashSpace,
  },
  {
    id: 'equals-word',
    row: '`grep -c "x =require" README.md`',
    test: equalsWord,
  },
  {
    id: 'unterminated-quote',
    row: '`grep -c "^# " "README.md`',
    test: unterminatedQuote,
  },
];

// A refusal reason (trace.js REASONS) the guard no longer gives, bound to the §7 passes row that
// records it by that row's exact Example cell. `until` is the day the row was last probed (UTC): a
// refusal with this reason from that day on contradicts the row, so the replay leaves it unexplained.
const FORMER_REASONS = {
  'gh-text': {
    row: "`gh api graphql -f query='query{repository(owner:\"o\",name:\"r\"){issue(number:1){parent{number}}}}'`; `gh issue list --repo o/r --search \"zsh in:title\" --json number`; `for n in 1 2; do gh issue view $n --repo o/r --json number --jq '\"#\\(.number)\"'; done`",
    until: '2026-11-16',
  },
};

// Refused-row Example cell -> why no static detector can decide it. Every other
// refused row has a detector.
const UNDETECTED_ROWS = {
  '`git -C "<main checkout>" rev-parse --short HEAD`; `cd "<main checkout>" && git log --oneline -1`':
    'whether a -C operand or cd target is another checkout is known only at run time: the path text alone cannot tell the shared checkout from any other directory',
};

// The agent substitutes a literal plugin root for these placeholders before it
// runs a command (_shared/worktree-setup.md, "Resolve plugin-supplied values to
// literals once"), so a skill fence that spells the placeholder is not the
// runtime-variable shape the guard sees.
function normalizePlaceholders(text) {
  return text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT(?!\w)/g, '/plugin-root');
}

function detectShapes(text, { placeholders = true } = {}) {
  const subject = placeholders ? normalizePlaceholders(text) : text;
  const ids = [];
  for (const d of DETECTORS) {
    if (!ids.includes(d.id) && d.test(subject)) ids.push(d.id);
  }
  return ids;
}

module.exports = { DETECTORS, UNDETECTED_ROWS, FORMER_REASONS, normalizePlaceholders, detectShapes, lexShell };
