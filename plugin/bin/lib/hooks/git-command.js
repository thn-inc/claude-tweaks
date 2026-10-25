// bin/lib/hooks/git-command.js
'use strict';
const path = require('path');

// Quote-aware top-level split: a single pass tracks single/double-quote state
// and only cuts at separators (&&, ||, ;, |, newline) that are outside any
// quote span. Newline is a segment boundary because gitTargets only ever
// inspects t[0] of each segment to detect a `cd`/`git` command — a bare
// newline (not `&&`/`;`) between two statements otherwise merges them into
// one segment, silently hiding a `cd` that isn't the segment's first token
// (e.g. `VAR="x"\ncd "$VAR" && git commit` — the `cd` never gets seen, so
// the effective cwd used for the commit target stays whatever it was before
// this segment, not where the command will actually run).
// This protects the safety invariant — ambiguity resolves to allow — by
// preventing quoted text (e.g. a commit message containing "&& git -C /x push")
// from being misparsed as additional shell segments that fabricate a target.
function splitSegments(command) {
  return segmentSpans(command).map((s) => s.text);
}

// splitSegments' pass, with each segment's `end`: the index in `command` of the
// separator that ends it (the string's length for the last one). forEachShellSegment
// uses it to find the segment that holds a heredoc opener.
function segmentSpans(command) {
  const str = String(command || '');
  return scanPass((spans) => segmentSpansWith(str, spans));
}

function segmentSpansWith(str, spans) {
  const segments = [];
  let current = '';
  let sub = false; // the segment in progress began inside a top-level backtick span
  const cut = (at) => { segments.push({ text: current, end: at, sub }); current = ''; sub = false; };
  let quote = null; // null | "'" (a double-quoted span is consumed whole below)
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote === "'") {
      // Inside single quotes, backslash has no special meaning in bash.
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }
    // Unquoted: a backslash escapes the next character, so `\"` opens no
    // quote and `\\` is a literal backslash — matching bash semantics.
    if (ch === '\\' && i + 1 < str.length) {
      current += ch + str[i + 1];
      i += 1;
      continue;
    }
    if (ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    // A backtick substitution's text is its own command, read in its own quoting context (#4149):
    // its separators still cut, so a command inside it is walked, but a quote inside it opens
    // nothing past its closing backtick, as bash reads it.
    if (ch === '`') {
      const r = spans.backtick(str, i + 1);
      if (r.closed) {
        const inner = segmentSpans(str.slice(i + 1, r.end - 1));
        current += `\`${inner[0].text}`;
        for (let k = 1; k < inner.length; k += 1) {
          cut(i + 1 + inner[k - 1].end);
          current = inner[k].text;
          sub = true;
        }
        current += '`';
        i = r.end - 1;
        continue;
      }
    }
    // A double-quoted span, or an unquoted `${ … }`, is one piece of a word, with the nesting
    // bash gives it (skipDoubleQuoted): nothing inside it cuts a segment (#4149).
    const nested = ch === '"' ? spans.dq(str, i + 1)
      : ch === '$' && str[i + 1] === '{' ? spans.param(str, i + 2) : null;
    if (nested && (ch === '"' || nested.closed)) {
      current += str.slice(i, nested.end);
      i = nested.end - 1;
      continue;
    }
    if (ch === '&' && str[i + 1] === '&') { cut(i); i += 1; continue; }
    if (ch === '|' && str[i + 1] === '|') { cut(i); i += 1; continue; }
    // `>|` is bash's noclobber-override redirect operator, not a pipe — a
    // glued `|` immediately after `>` (#3080) must not fabricate a segment
    // break here, or the operator token never reaches the tokenizer whole.
    if (ch === '|' && current.endsWith('>')) { current += ch; continue; }
    if (ch === ';' || ch === '|' || ch === '\n') { cut(i); continue; }
    // Unquoted `#` at the start of a word begins a bash comment that runs to
    // the end of the line — real bash never executes anything after it, so
    // any &&/;/| inside it must not fabricate a segment boundary. Only
    // recognized at a word boundary (start of string, or immediately after
    // whitespace/a separator) to match bash's own rule: `#` glued to
    // preceding non-whitespace text (e.g. `foo#bar`) is NOT a comment.
    if (ch === '#' && (i === 0 || /[\s;&|]/.test(str[i - 1]))) {
      let j = i + 1;
      while (j < str.length && str[j] !== '\n') j++;
      i = j - 1; // for-loop's i++ lands exactly on the newline (or end of string)
      continue;
    }
    current += ch;
  }
  cut(str.length);
  return segments;
}

// #4149: the nesting bash applies inside a double-quoted span and an unquoted `${ … }`, shared by
// every scanner that skips quoted text (segmentSpans, splitOnLoneAmpersand, removeQuotedSpans,
// lineLeavesStructureOpen, scanHeredocs, groupEvents). Inside double quotes, `$( … )`, a backtick
// and `${ … }` nest, and a quote inside `$( … )` opens a fresh quoting context, so no `&`, `;`,
// `(`, `)` or newline inside them is structural. Each skipper takes the index just past its
// opener and returns { end, closed }: `end` is the index just past the construct (the input's
// length when it runs off the end) and `closed` says whether its closer was found.
//
// Two bounds keep a pass linear. Nesting deeper than NEST_LEVEL_CAP, or a pass's nested scans
// taking more than NEST_STEPS_PER_CHAR steps per input character (plus NEST_STEPS_FLOOR), stops
// the scan and marks the result `capped`, unclosed. A capped result climbs unchanged to the
// top-level span; from there the pass's reader nests nothing more, and the scanner reads the whole
// pass again as before #4149 (scanPass). The step budget is what bounds a shape whose nested
// construct runs off the end from every top-level span: each span falls back to the plain quote end
// and the next one rescans the same text. Within one top-level call (level 0), each result depends
// only on (kind, start index), so it is memoized for that call: the double-quote fallback re-reads
// a deeper chain from a new index, which the memo scans once.
const NEST_LEVEL_CAP = 32;
const NEST_STEPS_PER_CHAR = 8;
const NEST_STEPS_FLOOR = 4096;
let nestMemo = null; // the current top-level call's memo
// { left }: the steps the pass in progress may still take. Every nested scan is entered through a
// pass's reader (topLevelSpans), which sets it for the call.
let nestBudget = null;
const cappedEnd = (str) => ({ end: str.length, closed: false, capped: true });
// Charges `n` steps to the budget in force; true once it is spent. Outside a nested scan (a
// top-level reader's own backtick or flat quote scan) nothing is charged.
const overBudget = (n) => nestBudget !== null && (nestBudget.left -= n) < 0;

function nestMemoized(kind, str, i, level, scan) {
  if (level > NEST_LEVEL_CAP || overBudget(0)) return cappedEnd(str);
  const top = nestMemo === null;
  if (top) nestMemo = new Map();
  try {
    const key = i * 3 + kind;
    let r = nestMemo.get(key);
    if (r === undefined) {
      r = scan(str, i, level);
      nestMemo.set(key, r);
    }
    return r;
  } finally {
    if (top) nestMemo = null;
  }
}

// A double-quoted span. When a construct nested in it never closes, the span falls back to ending
// at the first unescaped `"` (the reading before #4149), so a nesting this scan cannot follow
// never swallows the rest of the command.
function skipDoubleQuoted(str, i, level = 0) {
  return nestMemoized(0, str, i, level, scanDoubleQuoted);
}

function scanDoubleQuoted(str, i, level) {
  const start = i;
  while (i < str.length) {
    if (overBudget(1)) return cappedEnd(str);
    const c = str[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return { end: i + 1, closed: true };
    const r = c === '$' && str[i + 1] === '(' ? skipCommandSubstitution(str, i + 2, level + 1)
      : c === '$' && str[i + 1] === '{' ? skipParamExpansion(str, i + 2, level + 1)
        : c === '`' ? skipBacktick(str, i + 1) : null;
    if (r && !r.closed) return r.capped ? r : plainDoubleQuoteEnd(str, start);
    i = r ? r.end : i + 1;
  }
  return { end: str.length, closed: false };
}

function plainDoubleQuoteEnd(str, i) {
  while (i < str.length) {
    if (overBudget(1)) return cappedEnd(str);
    if (str[i] === '\\') { i += 2; continue; }
    if (str[i] === '"') return { end: i + 1, closed: true };
    i += 1;
  }
  return { end: str.length, closed: false };
}

// A single-quoted span from just past its opening quote: plain (`'…'`, no escapes) or ANSI-C
// (`$'…'`, where a backslash escapes the next character, so `\'` closes nothing).
function skipSingleQuoted(str, i, ansi) {
  const from = i;
  if (!ansi) {
    const close = str.indexOf("'", i);
    if (overBudget((close === -1 ? str.length : close) - from)) return cappedEnd(str);
    return close === -1 ? { end: str.length, closed: false } : { end: close + 1, closed: true };
  }
  while (i < str.length) {
    if (str[i] === '\\') { i += 2; continue; }
    if (str[i] === "'") return overBudget(i - from) ? cappedEnd(str) : { end: i + 1, closed: true };
    i += 1;
  }
  return overBudget(str.length - from) ? cappedEnd(str) : { end: str.length, closed: false };
}

// A `$( … )` (or `$(( … ))`) body, read as its own command text: quotes (`'…'`, `$'…'`, `"…"`),
// nested substitutions and parens nest, a word-initial `#` comments to the end of the line, and a
// heredoc's body (opened by `<<` outside arithmetic) is skipped raw through its delimiter line, as
// bash reads it, so an apostrophe or `)` in heredoc prose closes nothing. Known limit: a `case`
// pattern's `)` closes the substitution early (inside double quotes the span still ends at its own `"`).
function skipCommandSubstitution(str, i, level = 0) {
  return nestMemoized(1, str, i, level, scanCommandSubstitution);
}

function scanCommandSubstitution(str, i, level) {
  const arith = str[i] === '(';
  let depth = 0;
  let pending = [];
  let wordStart = true;
  while (i < str.length) {
    if (overBudget(1)) return cappedEnd(str);
    const c = str[i];
    if (c === '\\') { i += 2; wordStart = false; continue; }
    const r = c === "'" ? skipSingleQuoted(str, i + 1, false)
      : c === '$' && str[i + 1] === "'" ? skipSingleQuoted(str, i + 2, true)
        : c === '"' ? skipDoubleQuoted(str, i + 1, level + 1)
          : c === '`' ? skipBacktick(str, i + 1)
            : c === '$' && str[i + 1] === '(' ? skipCommandSubstitution(str, i + 2, level + 1)
              : c === '$' && str[i + 1] === '{' ? skipParamExpansion(str, i + 2, level + 1) : null;
    if (r) {
      if (!r.closed) return r;
      i = r.end;
      wordStart = false;
      continue;
    }
    if (c === '#' && wordStart && !arith) {
      const nl = str.indexOf('\n', i);
      const to = nl === -1 ? str.length : nl;
      if (overBudget(to - i)) return cappedEnd(str);
      i = to;
      continue;
    }
    if (c === '<' && str[i + 1] === '<' && !arith) {
      if (str[i + 2] === '<') { i += 3; wordStart = false; continue; }
      const h = readHeredocOpener(str, i + 2);
      if (h && !h.unprovable) pending.push(h);
      i = h ? h.end : i + 2;
      wordStart = false;
      continue;
    }
    if (c === '\n' && pending.length) {
      i += 1;
      for (const h of pending) {
        const body = scanHeredocBody(str, i, h);
        if (overBudget((body.terminated ? body.end : str.length) - i)) return cappedEnd(str);
        if (!body.terminated) return { end: str.length, closed: false };
        i = body.end;
      }
      pending = [];
      wordStart = true;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      if (depth === 0) return { end: i + 1, closed: true };
      depth -= 1;
    }
    wordStart = /[\s;&|()<>]/.test(c);
    i += 1;
  }
  return { end: str.length, closed: false };
}

// A `${ … }` body: quotes (`'…'`, `$'…'`, `"…"`), substitutions, backticks and inner `${` nest; it
// ends at the first other `}`. Bash matches single quotes here when it looks for the closing brace,
// inside double quotes as well, so `${x:-'}'}` and `"${x:-'}'}"` both close at their last `}`.
function skipParamExpansion(str, i, level = 0) {
  return nestMemoized(2, str, i, level, scanParamExpansion);
}

function scanParamExpansion(str, i, level) {
  while (i < str.length) {
    if (overBudget(1)) return cappedEnd(str);
    const c = str[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '}') return { end: i + 1, closed: true };
    const r = c === "'" ? skipSingleQuoted(str, i + 1, false)
      : c === '$' && str[i + 1] === "'" ? skipSingleQuoted(str, i + 2, true)
        : c === '"' ? skipDoubleQuoted(str, i + 1, level + 1)
          : c === '`' ? skipBacktick(str, i + 1)
            : c === '$' && str[i + 1] === '(' ? skipCommandSubstitution(str, i + 2, level + 1)
              : c === '$' && str[i + 1] === '{' ? skipParamExpansion(str, i + 2, level + 1) : null;
    if (r && !r.closed) return r;
    i = r ? r.end : i + 1;
  }
  return { end: str.length, closed: false };
}

// A backtick substitution: it ends at the next unescaped backtick.
function skipBacktick(str, i) {
  const from = i;
  while (i < str.length) {
    if (str[i] === '\\') { i += 2; continue; }
    if (str[i] === '`') return overBudget(i - from) ? cappedEnd(str) : { end: i + 1, closed: true };
    i += 1;
  }
  return overBudget(str.length - from) ? cappedEnd(str) : { end: str.length, closed: false };
}

// One scanner pass's reader of top-level spans: a double-quoted span (dq, from just past its `"`),
// an unquoted `${ … }` (param, from just past `${`) and a backtick substitution (backtick, from
// just past the backtick). `flat` is the reading before #4149: a plain `"` pairing, with `${` and
// a backtick taken as plain characters. The pass's nested scans share one step budget, sized by
// the first string the reader is handed (a pass reads one string). `capped` records that a span
// nested past NEST_LEVEL_CAP or spent the budget; from then on the reader reads flat, so a capped
// pass costs no more nested work before scanPass reads it again.
function topLevelSpans(flat = false) {
  const open = (str, i) => ({ end: i, closed: false });
  let budget = null;
  const reader = { capped: false };
  const nested = (str, i, skip) => {
    if (budget === null) budget = { left: NEST_STEPS_PER_CHAR * str.length + NEST_STEPS_FLOOR };
    const outer = nestBudget;
    nestBudget = budget;
    let r;
    try { r = skip(str, i); } finally { nestBudget = outer; }
    if (r.capped) reader.capped = true;
    return r;
  };
  const isFlat = () => flat || reader.capped;
  reader.dq = (str, i) => (isFlat() ? plainDoubleQuoteEnd(str, i) : nested(str, i, skipDoubleQuoted));
  reader.param = (str, i) => (isFlat() ? open(str, i) : nested(str, i, skipParamExpansion));
  reader.backtick = (str, i) => (isFlat() ? open(str, i) : skipBacktick(str, i));
  return reader;
}

// Runs one scanner pass, `scan(spans)`, and when any span in it was capped runs the whole pass again
// in the flat reading, so a pathological nest reads exactly as it did before #4149: a nested
// reading that falls back to the plain one partway pairs its quotes unlike either reading, which
// can hide a separator both of them see.
function scanPass(scan) {
  const spans = topLevelSpans();
  const r = scan(spans);
  return spans.capped ? scan(topLevelSpans(true)) : r;
}

function stripQuotes(s) {
  return s.replace(/^['"]|['"]$/g, '');
}

// Tokenizer that keeps quoted spans (with spaces) as one token. Also merges a
// quoted span into an immediately-adjacent (no whitespace between) match —
// matching real shell word-splitting, where `"/tmp/safe/"$SUFFIX` is ONE word
// (`/tmp/safe/<value-of-$SUFFIX>`), not two. Without this, resolveCd/isUnresolvable
// only ever see the quoted portion in isolation, judge it fully resolvable, and
// silently drop the unresolvable suffix that would otherwise poison the target.
//
// Returns `{ tokens, singleQuoted, doubleQuoted, leadQuoted, spanKinds }` — `singleQuoted[i]` is true
// when any part of `tokens[i]` was assembled from a single-quoted span, and
// `doubleQuoted[i]` likewise for a double-quoted span (#4015: the redirect scan
// treats a `>` in either as literal text). Real bash never performs
// `$`-expansion inside single quotes (unlike double quotes or bare words), so
// this flag is what lets substituteVars() below refuse to treat a
// single-quoted `'$NAME'` as a variable reference — without it, a token like
// `'$WT/a.js'` and `"$WT/a.js"` are indistinguishable post-tokenize, and the
// substitution step would wrongly expand the single-quoted (never-expanded)
// form, fabricating a target real bash would never produce for that command.
//
// `leadQuoted[i]` is true when `tokens[i]` BEGINS with a quoted span: a quoted `'<<'`
// is a literal argument, whereas an unquoted `<<'EOF'` is a heredoc operator with a
// quoted delimiter (dropRedirections tells them apart by it).
//
// `spanKinds[i]` (#4210) is a string exactly as long as `tokens[i]`, one character
// per character of the token: `b` bare, `e` backslash-escaped (the `\` and the
// character it escapes, in a bare span), `s` single-quoted, `d` double-quoted, `x`
// stray (an unterminated quote character or a lone trailing backslash). Quote
// delimiters are not part of the token, so they carry no mask character. The
// per-token flags above say only THAT a span was quoted; the mask says WHERE, which
// is what lets the glued-redirect scan accept `echo "hi">x` yet refuse `echo "a>b"`.
// Two changes to the token regex make the mask truthful: a bare run now stops at a quote
// (so `foo"bar"` is a bare span plus a double-quoted span, merged into one token as
// bash does), and a double-quoted span is backslash-aware (`\"` does not close it,
// and its value keeps the backslashes as typed).
function tokenize(seg) {
  const out = [];
  const singleQuoted = [];
  const doubleQuoted = [];
  const leadQuoted = [];
  const spanKinds = [];
  const re = /"((?:[^"\\]|\\[\s\S])*)"|'([^']*)'|((?:\\[\s\S]|[^\s"'\\])+)|(\S)/g;
  let m;
  let prevEnd = -1;
  while ((m = re.exec(seg)) !== null) {
    const val = m[1] ?? m[2] ?? m[3] ?? m[4];
    const isSQ = m[2] !== undefined;
    const isDQ = m[1] !== undefined;
    const isBare = m[3] !== undefined;
    let kinds;
    if (isDQ) kinds = 'd'.repeat(val.length);
    else if (isSQ) kinds = 's'.repeat(val.length);
    else if (isBare) kinds = val.replace(/\\[\s\S]|[\s\S]/g, (u) => (u.length === 2 ? 'ee' : 'b'));
    else kinds = 'x';
    if (out.length && m.index === prevEnd) {
      out[out.length - 1] += val;
      spanKinds[spanKinds.length - 1] += kinds;
      if (isSQ) singleQuoted[singleQuoted.length - 1] = true;
      if (isDQ) doubleQuoted[doubleQuoted.length - 1] = true;
    } else {
      out.push(val);
      spanKinds.push(kinds);
      singleQuoted.push(isSQ);
      doubleQuoted.push(isDQ);
      leadQuoted.push(isSQ || isDQ);
    }
    prevEnd = re.lastIndex;
  }
  return { tokens: out, singleQuoted, doubleQuoted, leadQuoted, spanKinds };
}

// Global git flags that consume the NEXT token as a value.
const VALUE_FLAGS = new Set(['-C', '-c', '--exec-path', '--namespace']);
// Flags that make the target unprovable from the command text alone.
const UNPROVABLE_FLAGS = ['--git-dir', '--work-tree'];

// A raw (unquote-stripped) cd/-C argument that is unresolvable to a concrete,
// literal path: no argument, "-", starts with "~", contains "$"/backtick, or
// contains a backslash/double-quote. The last two guard against token-level
// ambiguity: the tokenizer above is escape-aware, but it keeps backslashes in
// the token text as typed, so a value that still carries a backslash or stray
// quote (from an escaped-quote sequence) cannot be trusted as a literal path —
// never claim an unprovable target. Also unresolvable: anything else that looks
// like a FLAG (starts with "-", length > 1) — cd's own flags (-L, -P, -e, -@,
// --) are not path arguments; without this, `cd -P /other-repo` would resolve
// "-P" itself as a literal (almost certainly nonexistent) child directory of
// the current cwd instead of recognizing the real target is unprovable from here.
function isUnresolvable(raw) {
  return (
    raw === undefined ||
    raw === '-' ||
    (raw.length > 1 && raw.startsWith('-')) ||
    raw.startsWith('~') ||
    raw.includes('$') ||
    raw.includes('`') ||
    raw.includes('\\') ||
    raw.includes('"')
  );
}

function isAbsolutePlain(raw) {
  return !isUnresolvable(raw) && path.isAbsolute(raw);
}

// Shared cd-token resolution used by both gitTargets and fileWriteTargets: given
// the current effective cwd (string, or null meaning UNKNOWN) and a `cd`
// command's raw (unquote-stripped) argument, returns the new effective cwd (or
// null when the argument leaves it unprovable). Kept as one function so a
// future fix to cd-resolution edge cases (a new isUnresolvable pattern,
// pushd/popd support, etc.) can never land in one caller and not the other.
function resolveCd(effCwd, raw) {
  if (isUnresolvable(raw)) return null;
  if (effCwd === null) {
    // Unknown cwd: only a plain absolute path restores provability.
    return isAbsolutePlain(raw) ? path.resolve(raw) : null;
  }
  return path.resolve(effCwd, stripQuotes(raw));
}

// Matches a segment that is exactly one token shaped like a simple literal
// variable assignment: NAME=value / NAME="value" / NAME='value' (bash
// permits no space around `=`). A quoted value may hold a space —
// `NAME="a b"` is one token and is tracked — but an unquoted, unescaped space
// (`NAME=a b`) tokenizes into more than one token, which the length check in
// updateAssignment below excludes; that's an accepted narrowing, not a bug,
// since bash reads it as an assignment prefix on command `b`. No `export`, no arrays:
// `export SP=/x` tokenizes to two tokens (`export`, `SP=/x`) and fails the
// length check before this regex ever runs, so `export` needs no separate
// rejection.
const SIMPLE_ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

// Classifies raw (pre-substitution) token array `t` as a simple same-command
// assignment and updates `vars` in place; returns whether it was one (the
// caller `continue`s past handler/cd on true, the same way an existing `cd`
// segment already does). A later assignment of the same name overwrites the
// earlier one; an assignment whose OWN value is unresolvable DELETES any
// earlier mapping for that name rather than leaving it in place — the
// variable's value genuinely changed, so continuing to substitute the stale
// earlier value would itself be a fabricated-target risk, the exact thing
// this module's fail-open posture exists to avoid. Deliberately reads the
// RAW (pre-substitution) token, never the substituted one — this is what
// keeps a chained reference (`B=$A/y`) from ever resolving through a second
// hop: `$A/y`'s raw value still contains `$`, so isUnresolvable rejects it
// here, before substitution would otherwise have had a chance to touch it.
function updateAssignment(vars, t) {
  if (t.length !== 1) return false;
  const m = SIMPLE_ASSIGNMENT_RE.exec(t[0]);
  if (!m) return false;
  const [, name, rawValue] = m;
  const value = stripQuotes(rawValue);
  if (isUnresolvable(value)) vars.delete(name);
  else vars.set(name, value);
  return true;
}

// Matches a token's $NAME / ${NAME} reference.
const VAR_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

// Substitutes a same-command literal assignment into a token, deliberately
// narrow: only a token whose $/backtick content is EXACTLY one $NAME or
// ${NAME} reference to an already-tracked name is rewritten; anything else
// (an unassigned name, a second $ or a backtick elsewhere in the token) is
// returned unchanged and falls through to the existing
// isUnresolvable()/null-target behavior unmodified. Never recursive — the
// substituted value is a literal already proven not to contain `$` (by
// updateAssignment's own isUnresolvable check at assignment time), so there
// is nothing left to re-scan.
function substituteVars(tokens, vars, singleQuoted, spanKinds) {
  if (!vars.size) return tokens;
  return tokens.map((tok, i) => {
    // Real bash never expands `$NAME` inside single quotes — a token built
    // from a single-quoted span is never a variable reference, regardless of
    // its text. Skip it untouched; it falls through to the existing
    // isUnresolvable()/null-target behavior unmodified (see tokenize()'s
    // singleQuoted comment for why this guard exists). With the per-character
    // span mask (#4210) the test is on the `$` itself, below, so `'hi'>$WT/x`
    // still expands its bare `$WT`; without a mask, any single-quoted span skips.
    const kinds = spanKinds && spanKinds[i];
    if (!kinds && singleQuoted && singleQuoted[i]) return tok;
    if (!tok.includes('$') || tok.includes('`')) return tok;
    const matches = [...tok.matchAll(VAR_REF_RE)];
    if (matches.length !== 1) return tok;
    if ((tok.match(/\$/g) || []).length !== 1) return tok;
    const m = matches[0];
    // A `$` inside single quotes, or backslash-escaped, is literal text.
    if (kinds && (kinds[m.index] === 's' || kinds[m.index] === 'e')) return tok;
    const name = m[1] || m[2];
    if (!vars.has(name)) return tok;
    return tok.slice(0, m.index) + vars.get(name) + tok.slice(m.index + m[0].length);
  });
}

// The handler-only entry to the shared segment/token walk, kept for the callers
// that pass a handler and nothing walk-specific: gitTargets (via
// resolvedGitSegments), mkdirTargets, powershellOpaqueCommand and pre-tool-use.js's
// teardownTargets. It delegates to forEachShellSegment, which fileWriteTargets and
// bash-prefilter.js's hasFileRedirection call directly. The walk
// splits the command into shell segments, tokenizes each, and tracks `cd` to
// keep the effective cwd in sync. `handler(t, effCwd, quoting, again)` is
// invoked for every non-cd, non-empty segment with the cwd value in effect for
// it (string, or null meaning UNKNOWN); `quoting` is
// `{ raw, singleQuoted, doubleQuoted, leadQuoted, spanKinds, nestAt }`: the
// pre-substitution tokens, their per-token quote flags from tokenize (#4015 reads
// the first three, #4149's dropRedirections reads `leadQuoted`), their per-character
// span kinds (#4210, see tokenize), and the nesting state at each token's start
// (#4210, see advanceNesting). The nesting state carries from piece to piece within
// one chunk, cd and assignment pieces included: a flat (capped) reading can cut at a
// `|`/`;`/newline inside an inner quote of `"$( … )"`, and the nested context must
// survive that cut. Also tracks same-command literal
// `NAME=value` assignments (see updateAssignment/substituteVars above) and
// substitutes them into every other segment's tokens before `handler`/the `cd`
// branch sees them — one shared point so a future fix to either cd-resolution or
// assignment-substitution can never land in one caller's copy of this
// preamble and not the other's.
//
// #4149: it is the same walk as forEachShellSegment: groups and lone `&` cuts, so a `cd` behind
// `(`/`{` is read with the same scope rules and `handler` may run once per cwd for a segment (its
// fourth argument true on a repeat visit); and heredoc bodies, so a data body's text (a commit
// message line like `1) a`) never reaches the group depth, while a kept body walks as its own chunk.
function forEachCommandSegment(command, cwd, handler, opts) {
  forEachShellSegment(command, cwd, handler, opts);
}

// One segment of forEachShellSegment's walk, already tokenized (`tok`, from tokenize, and
// `nestAt`, the nesting state at each token's start): updates `vars`, calls `handler` for a
// non-cd, non-assignment segment, and returns the effective cwd after it.
function visitSegment(tok, nestAt, effCwd, vars, handler) {
  const { tokens: rawT, singleQuoted, doubleQuoted, leadQuoted, spanKinds } = tok;
  if (!rawT.length) return effCwd;
  if (updateAssignment(vars, rawT)) return effCwd;
  const t = substituteVars(rawT, vars, singleQuoted, spanKinds);
  // `FOO=1 cd /path` really does change the shell's cwd — a preceding
  // assignment on a regular (non-special) builtin like `cd` is scoped only
  // to that command's own execution environment, but `cd` has no
  // subprocess to scope the env change to, so it still runs and changes
  // the CURRENT shell's cwd (verified empirically; #590). `env cd /path`
  // is the opposite case and deliberately NOT normalized here: `env` execs
  // an external `cd` binary that does not exist on a normal system, so it
  // errors and never changes cwd — normalizing it would fabricate a target
  // for a shape that has no real effect.
  let cdLead = 0;
  while (cdLead < t.length && SIMPLE_ASSIGNMENT_RE.test(t[cdLead])) cdLead += 1;
  if (t[cdLead] === 'cd') return resolveCd(effCwd, t[cdLead + 1]);
  handler(t, effCwd, { raw: rawT, singleQuoted, doubleQuoted, leadQuoted, spanKinds, nestAt });
  return effCwd;
}

// Consumes every leading global git flag (-C <dir>, -c <k>=<v>, --exec-path,
// --namespace, --git-dir, --work-tree, and any other unrecognized `-...`
// flag) starting at token index `i`, resolving -C against `dir` the same way
// gitTargets always has. Returns the index of the first non-flag token (the
// subcommand), the resolved dir (or null if UNKNOWN), and whether the
// target became unprovable. Shared by gitTargets and teardownTargets so a
// future global-flag fix lands once for both instead of drifting between two
// hand-kept copies — teardownTargets used to check only a literal `-C`
// immediately after `git`, so any other global flag (`-c ...`, `--no-pager`,
// etc.) ahead of `worktree remove` defeated its parser entirely and silently
// allowed tearing down a worktree still assigned to a non-terminal run.
function skipGlobalFlags(t, i, dir, pathImpl = path) {
  let unprovable = false;
  while (i < t.length && t[i].startsWith('-')) {
    const flag = t[i];
    if (UNPROVABLE_FLAGS.some((u) => flag === u || flag.startsWith(u + '='))) { unprovable = true; i += flag.includes('=') ? 1 : 2; continue; }
    // Use an explicit index-bound check (i + 1 < t.length), not a truthy
    // check on t[i + 1] — a truthy check treats a genuinely-present but
    // EMPTY value (`-C ""`, which real git treats as equivalent to
    // omitting -C entirely) as "no value follows", mis-consuming only the
    // flag token and leaving the leftover '' to be misread as the git
    // subcommand two lines below.
    if (flag === '-C' && i + 1 < t.length) {
      const raw = t[i + 1];
      if (raw === '') {
        // git leaves cwd unchanged for an empty -C, so `dir` stays verbatim.
        // Resolving it would normalize the string and hand the worktree gate
        // a different target than an omitted -C (e.g. `C:\repo` vs `/repo` on
        // Windows) — #3314.
      } else if (isUnresolvable(raw)) {
        unprovable = true;
      } else if (pathImpl.isAbsolute(raw)) {
        dir = pathImpl.resolve(raw);
      } else if (dir === null) {
        // Relative -C while cwd is UNKNOWN — cannot prove the target.
        unprovable = true;
      } else {
        dir = pathImpl.resolve(dir, raw);
      }
      i += 2;
      continue;
    }
    if (VALUE_FLAGS.has(flag) && i + 1 < t.length) { i += 2; continue; }
    i += 1;
  }
  return { index: i, dir, unprovable };
}

// Finds the real `git` command word in a segment's raw token array, looking
// past three equivalent shapes a real shell treats identically to a bare
// `git` invocation (#590):
//   - leading `NAME=value` assignment tokens: `FOO=1 git commit -m x`
//   - the `env` builtin, plus ITS OWN leading flags/assignments, ahead of the
//     real command: `env git commit -m x`, `env -i git commit -m x`,
//     `env FOO=1 git commit -m x`
//   - a directory-qualified executable ending in `/git`: `/usr/bin/git commit`
// (any combination of the three also resolves, e.g. `FOO=1 /usr/bin/git …`
// or `env FOO=1 /usr/bin/git …`.)
//
// Returns `{ index, dir, unprovable }` — `index` is -1 when, after
// normalization, the leading token still isn't `git` (ambiguity resolves to
// "not git", the same never-fabricate-a-target posture as the rest of this
// module). `dir` starts at the caller's effective cwd and moves when env's
// own `-C <dir>` / `--chdir[=]<dir>` flag changes where the command runs —
// skipping those flags without consuming their value made
// `env -C <main-checkout> git commit` read as not-git at all (the dir token
// became the presumed lead) and `env --chdir=/x git commit` resolve its
// target against the wrong directory. `-u`/`--unset <name>` likewise
// consumes its value so the name is never mistaken for the command word.
// Still not full env(1) parsing (see #590's Gotchas): `-S`/`--split-string`
// re-splits an opaque program string, which is statically unknowable — the
// same deliberately-uncovered class as `sh -c`/`python -c` (see
// fileWriteTargets' header) — so it falls through to the not-git default.
function findGitLead(t, dir) {
  let unprovable = false;
  let i = 0;
  while (i < t.length && SIMPLE_ASSIGNMENT_RE.test(t[i])) i += 1;
  if (t[i] === 'env') {
    i += 1;
    while (i < t.length) {
      const tok = t[i];
      if (SIMPLE_ASSIGNMENT_RE.test(tok)) { i += 1; continue; }
      if (tok === '-' || !tok.startsWith('-')) break;
      // Both spellings env accepts: separate value (`-C <dir>`, `--chdir <dir>`)
      // and attached value (`-C<dir>`, `--chdir=<dir>`). Skipping the attached
      // short form as a generic flag left the resolved dir at the caller's cwd
      // while git was still detected as lead — the same silent-allow bypass as
      // the separate form, one spelling over.
      if (tok === '-C' || tok === '--chdir' || tok.startsWith('--chdir=') || (tok.startsWith('-C') && tok.length > 2)) {
        const attached = tok.startsWith('--chdir=') ? tok.slice('--chdir='.length)
          : tok.startsWith('-C') && tok.length > 2 ? tok.slice(2)
          : null;
        const raw = attached !== null ? attached : t[i + 1];
        const resolved = resolveCd(dir, raw);
        if (resolved === null) unprovable = true;
        else dir = resolved;
        i += attached !== null ? 1 : 2;
        continue;
      }
      if (tok === '-u' || tok === '--unset') { i += 2; continue; }
      i += 1;
    }
  }
  if (i >= t.length) return { index: -1, dir, unprovable };
  const lead = t[i];
  if (lead === 'git' || lead.endsWith('/git')) return { index: i, dir, unprovable };
  return { index: -1, dir, unprovable };
}

// Shared findGitLead -> skipGlobalFlags preamble: resolves one command
// segment's real git lead and the subcommand position/dir past any global
// flags, in the one index/unprovable/dir-null check sequence both gitTargets
// and teardownTargets (pre-tool-use.js) need. Returns `{ index, dir }` (index
// is the resolved SUBCOMMAND token position) or null when the segment isn't
// git, or the target is unprovable / cwd-unknown-with-no-provable--C. A
// single shared point so a future fix to this preamble lands once for both
// callers instead of drifting between two hand-kept copies — the exact gap
// #1308 closed for teardownTargets, which used to skip this preamble
// entirely and check a bare `toks[0] !== 'git'` instead.
function resolveGitCommand(t, effCwd) {
  const lead = findGitLead(t, effCwd);
  if (lead.index === -1) return null;
  const { index, dir, unprovable } = skipGlobalFlags(t, lead.index + 1, lead.dir);
  if (lead.unprovable || unprovable || dir === null) return null;
  return { index, dir };
}

// #976 (IL-141): git-plumbing subcommands that mutate tracked state or refs
// OUTSIDE the commit/push pair gitTargets already classified — every one of
// these previously bypassed E1/worktree-always/pipeline-shadow enforcement
// entirely, since an unrecognized `sub` never became a target at all.
// Evidence-driven, deliberately narrow (see the Gotchas this closes): each
// entry is a subcommand that is UNAMBIGUOUSLY a write in every ordinary
// invocation, not merely capable of one under some flag combination.
//   - `mv`         — renames/moves a tracked file (index + working tree).
//   - `rm`          — removes a tracked file from the index (working tree
//                     too, unless `--cached`) — always a mutation, with or
//                     without `--cached`.
//   - `update-ref`  — directly rewrites a ref (a branch pointer) — pure
//                     plumbing, no read-only form.
//   - `apply`       — applies a patch to the working tree/index.
// Deliberately NOT included in this pass: `stash`, `reset`, `checkout`,
// `switch`, `restore`, `merge`, `rebase`, `cherry-pick`. Each has a common,
// genuinely read-only or non-mutating invocation shape (`stash list`/`show`,
// `reset` with no path args just moves HEAD's *reflog* pointer inside the
// SAME worktree it's run in and is routinely run from a script for its exit
// code alone, `checkout <branch>` with no path args, etc.) that a one-level
// subcommand check cannot distinguish from the mutating form without
// resolving a second token — the exact "pattern-matching every git
// subcommand indiscriminately" this record's own Gotchas warns against.
// Extend evidence-driven, on a real incident, not speculatively.
const PLUMBING_WRITE_SUBCOMMANDS = new Set(['mv', 'rm', 'update-ref', 'apply']);

// #2065: one shared traversal for every consumer that needs "every git
// invocation in this command, resolved" — checkGitStashWarn and gitTargets
// used to each run their own forEachCommandSegment + resolveGitCommand walk
// over the identical command/cwd, a second full quote-aware parse on the hot
// path (every Bash tool call, every session). This is the one walk; classification
// over its result (gitTargetsFrom below) is what tells "commit"/"push"/plumbing
// apart from "stash" apart from everything else — the traversal itself stays
// ignorant of which subcommand pre-tool-use.js's callers each care about.
function resolvedGitSegments(command, cwd, opts) {
  const segments = [];
  let pieceStart = 0; // where the current piece's first-cwd visit began pushing
  forEachCommandSegment(command, cwd, (t, effCwd, _quoting, again) => {
    if (!again) pieceStart = segments.length;
    const resolved = resolveGitCommand(t, effCwd);
    if (!resolved) return;
    // A repeat visit under another cwd (after a brace group) that resolves to the same dir adds nothing.
    if (again && segments.slice(pieceStart).some((s) => s.dir === resolved.dir && s.index === resolved.index)) return;
    segments.push({ tokens: t, index: resolved.index, dir: resolved.dir });
  }, opts);
  return segments;
}

// Pure classification over an already-resolved segment list — no traversal of
// its own. `gitTargets` below is the convenience wrapper kept for every
// existing caller (post-tool-use.js, tests) that still wants "parse and
// classify" in one call.
function gitTargetsFrom(segments) {
  const targets = [];
  for (const { tokens: t, index, dir } of segments) {
    const sub = t[index];
    if (sub === 'commit' || sub === 'push' || PLUMBING_WRITE_SUBCOMMANDS.has(sub)) {
      targets.push({ action: sub, dir });
    }
  }
  return targets;
}

function gitTargets(command, cwd, opts) {
  return gitTargetsFrom(resolvedGitSegments(command, cwd, opts));
}

// #3061: does this command invoke `powershell`/`pwsh` with `-Command` or
// `-EncodedCommand`? Both hand the interpreter literal (or base64) script
// text this module cannot read — the exact class `sh -c`/`python -c` already
// are, deliberately left unparsed (see fileWriteTargets' header just below).
// Unlike that class, this is the one PowerShell shape pre-tool-use.js's
// checkPowershellOpaqueCommand gate treats as a content-agnostic DENY rather
// than falling through to this module's usual "ambiguity resolves to allow"
// — so this function only has to answer "is the shape present", never try to
// read what the text contains. `-File <path>` alone (no -Command, no
// -EncodedCommand) is a plain script-path invocation — the same
// not-opaque-text category `bash script.sh` already falls into by never
// matching any guarded word at all — and this function does not flag it.
// Case-insensitive (Windows exe lookups and PowerShell's own flag matching
// both are); abbreviated flag forms (-Com, -EncodedCom, …) are deliberately
// NOT matched, the same narrow-miss posture every best-effort parser in this
// module already accepts in exchange for never fabricating a false deny.
const POWERSHELL_LEADS = new Set(['powershell', 'pwsh']);
const POWERSHELL_OPAQUE_FLAGS = new Set(['-command', '-encodedcommand']);
function powershellOpaqueCommand(command, cwd) {
  let found = false;
  forEachCommandSegment(command, cwd, (t) => {
    if (found || !t.length) return;
    let i = 0;
    while (i < t.length && SIMPLE_ASSIGNMENT_RE.test(t[i])) i += 1;
    if (i >= t.length) return;
    const lead = t[i].toLowerCase().replace(/\.exe$/, '');
    const cut = Math.max(lead.lastIndexOf('/'), lead.lastIndexOf('\\'));
    const base = cut >= 0 ? lead.slice(cut + 1) : lead;
    if (!POWERSHELL_LEADS.has(base)) return;
    for (let j = i + 1; j < t.length; j++) {
      if (POWERSHELL_OPAQUE_FLAGS.has(t[j].toLowerCase())) { found = true; return; }
    }
  });
  return found;
}

// Best-effort detection of non-git, non-Edit/Write direct file-write shapes in
// a Bash command. Every shape here is a word in GUARDED_PROGRAM_WORDS.write (below),
// from which bash-prefilter.js derives PRE_TOOL_USE_WORDS — so a shape added there
// is covered by construction. The pairing is the design constraint: a branch
// here whose command word the prefilter skips is dead code, because bin/hooks.js
// exits before the full handler loads; that asymmetry is exactly what let
// `sed -i` bypass the gate silently for months (#70). The differential corpus in
// tests/hooks-bash-prefilter.test.js pins the pairing against this parser (#3092).
//
// Still NOT covered, and deliberately (see the coverage block in
// skills/_shared/policy-schema-coverage.md for the measured rationale):
//   - `python -c`, `sh -c`, `awk` program strings — the write target lives
//     inside an opaque program and is not statically knowable at any cost.
//
// Bare shell redirection (`>`, `>>`, `>|`, `&>`, `&>>`, fd-prefixed `N>`/`N>>`)
// IS covered (#3080): redirectWriteTargets below scans every segment's token
// list regardless of t[0], since a redirection isn't gated by a command word
// the way the shapes above are. bash-prefilter.js's hasFileRedirection keeps
// the common `2>&1`/`> /dev/null` shapes on the skip path (#70's dead-code
// trap applies here too — a parser branch the prefilter never reaches for
// real traffic is dead).
//
// Ambiguity resolves to "no target" (allow), matching gitTargets' own safety
// posture: never fabricate a target from a path this can't prove.
const DEVNULL_LIKE = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);

function resolveWriteTarget(effCwd, raw) {
  if (isUnresolvable(raw)) return null;
  const stripped = stripQuotes(raw);
  // An explicitly-empty token is never a file. It reaches here as BSD sed's
  // separate backup suffix (`sed -i '' ...`); without this it would resolve to
  // effCwd itself and flag the whole directory as a write target.
  if (stripped === '') return null;
  if (DEVNULL_LIKE.has(stripped)) return null;
  if (path.isAbsolute(stripped)) return path.resolve(stripped);
  if (effCwd === null) return null; // cwd UNKNOWN and a relative path — not provable
  return path.resolve(effCwd, stripped);
}

// A redirection's RHS that is a file-descriptor duplication (`>&2`, `2>&1`),
// or an fd close/move (`>&-`, `>&3-`), never a file target — distinct from
// resolveWriteTarget's unresolvable set because the shape (a bare `&` followed
// by digits or `-`) is specific to redirection syntax and would otherwise read
// as a plausible-looking relative path.
function isFdDupTarget(raw) {
  return /^&(\d+-?|-)$/.test(raw);
}

// Matches a write-redirection operator at the START of a token, optionally
// fd-prefixed (`2>`, `1>>`) or in `&>`/`&>>` combined-stream form, capturing
// whatever follows the operator in the SAME token (a glued target, or '' for
// a standalone operator whose target is the next token). `<` (input
// redirection) and `>&N`/`N>&M` (fd duplication, handled by the caller once it
// has the full candidate target) are not matched as write operators here.
const REDIRECT_OP_RE = /^\d*(>>|>\||>)(.*)$/;
const AMP_REDIRECT_OP_RE = /^&(>>|>)(.*)$/;

function matchRedirectOperator(tok) {
  const m = REDIRECT_OP_RE.exec(tok) || AMP_REDIRECT_OP_RE.exec(tok);
  return m ? m[2] : null;
}

// #3989/#4149 heredoc-body stripping (see stripHeredocBodies below). A body is
// stripped only when the opener line feeds it to a known data reader: an allowlist,
// because any program not named here (a shell, `make -f -`, `at`, a glob-named
// `/bin/ba[s]h`) may run the body as commands, and the set of those cannot be listed.
const DATA_READER_WORDS = new Set(['cat', 'tee', 'git', 'gh', 'read', 'node', 'python', 'python3', 'jq', 'wc']);
// Commands that run what follows them: followed to the program they run.
const READER_WRAPPER_WORDS = new Set(['sudo', 'doas', 'env', 'nice', 'time', 'nohup', 'command', 'exec']);
// `env` options that choose the program it runs: -S/--split-string re-splits a string into a
// command line, -P searches another PATH. Matched in a short-option cluster too (`-iS…`).
const ENV_PROGRAM_FLAG_RE = /^-(?:[^-]*[SP]|-s)/;
// Programs that neither read stdin nor run an argument. They pass the reader check only as a
// stand-alone neighbour segment's own program (never behind a wrapper), and only in a segment
// with no command substitution, which could read the body (`cat <<EOF | echo $(bash)`).
// `git add` passes the same way (see isInertNeighbour).
const INERT_NEIGHBOUR_WORDS = new Set(['cd', 'mkdir', 'true', ':', 'echo', 'printf']);
// `git` reads its body as data only for these subcommands. Any other can run its
// arguments as a program (`git bisect run sh`, `git rebase -x sh`) and so is no reader.
const GIT_DATA_SUBCOMMANDS = new Set(['commit', 'tag', 'notes', 'apply', 'am', 'hash-object', 'interpret-trailers', 'update-ref', 'cat-file']);

// A program token names its program unambiguously only as a bare word or an absolute
// path; `./cat` and `bin/cat` run whatever file sits there, not the reader `cat`.
function isBareOrAbsoluteProgram(tok) {
  return !tok.includes('/') || /^(?:\/|[A-Za-z]:\/)/.test(tok);
}

// One group: `(ls)`, `$(date)`, `<(b)` — no nesting, and no `$`, backtick, backslash, `<`, `>` or quote inside.
// Fd digits may follow the `)` (`(ls)2>x` is a subshell with a `2>` redirect).
const BALANCED_GROUP_RE = /^[$<]?\([^()\\$`<>"']*\)\d*$/;

// #4015/#4210: bash ends a word at an unquoted `>`, so `echo foo>x` redirects exactly
// like `echo foo > x`, and the word before it may hold quoted spans (`echo "hi">x`).
// `kinds` is the token's per-character span mask (tokenize): only a BARE `>` is an
// operator, so a `>` inside any quote or escaped stays literal. Returns the index just
// past the glued operator in `raw`, or null when the token holds none.
//
// The prefix before the operator is accepted only when every character is quoted
// (`s`/`d`), escaped (`e`: `foo\ bar>x` is the word `foo bar`), or bare and not `$`,
// backtick or `(` — each of those can put the `>` inside an expansion, and an unquoted
// `(` inside a bare word is only arithmetic (`((i>0))`, where `>` is a comparison),
// `$(`, `<(` or extglob syntax. A stray character in the prefix rejects it; ambiguity
// resolves to no target. A leading `>` (k === 0) is leadingRedirectOpEnd's case.
//
// The one exception is a prefix that is exactly one all-bare, un-nested group: it ends
// at its `)`, so the `>` after it is a redirect (BALANCED_GROUP_RE).
//
// `nest` is the nesting state at the token's start (advanceNesting); a `>` reached
// inside a nested context is quoted in bash, so it yields null.
function gluedRedirectOpEnd(raw, kinds, nest) {
  let k = 0;
  while (k < raw.length && !(raw[k] === '>' && kinds[k] === 'b')) k += 1;
  if (k === 0 || k === raw.length || isNested(advanceNesting(nest, raw, kinds, k))) return null;
  let plain = true;
  for (let j = 0; j < k; j += 1) {
    const kind = kinds[j];
    if (kind === 's' || kind === 'd' || kind === 'e') continue;
    if (kind === 'b' && !'$`('.includes(raw[j])) continue;
    plain = false;
    break;
  }
  if (!plain && !(kinds.slice(0, k) === 'b'.repeat(k) && BALANCED_GROUP_RE.test(raw.slice(0, k)))) return null;
  const second = raw[k + 1];
  const twoChar = (second === '>' || second === '|') && kinds[k + 1] === 'b';
  return k + (twoChar ? 2 : 1);
}

// #4210 F3: the start-anchored operator (`>`, `>>`, `>|`, `N>`, `&>`, `&>>`) read on the
// token as typed. Every operator character, fd digits and `&` included, must be bare: a
// quoted leading `>` (`echo ">x"`, `--body "> reply"`) is a word, and so is a `>` that a
// `$VAR` expands to. Returns the index just past the operator, or null.
function leadingRedirectOpEnd(raw, kinds, nest) {
  if (isNested(nest)) return null;
  let k = 0;
  const amp = raw[0] === '&' && kinds[0] === 'b';
  if (amp) k = 1;
  else while (k < raw.length && raw[k] >= '0' && raw[k] <= '9' && kinds[k] === 'b') k += 1;
  if (raw[k] !== '>' || kinds[k] !== 'b') return null;
  const second = raw[k + 1];
  const twoChar = (second === '>' || (second === '|' && !amp)) && kinds[k + 1] === 'b';
  return k + (twoChar ? 2 : 1);
}

// #4210 F1: a `$(`, `${` or backtick inside double quotes opens a nested context, and a
// `"` inside it starts a NEW quote that the tokenizer reads as closing the outer one —
// so a `>` bash keeps quoted (`echo "$(jq ".a>1" f)"`) gets kind `b`. Only the `d`
// characters are real shell syntax at that level, so the walk reads only them: `$(`/`${`
// open, a backtick toggles, and once nested a `(`/`{` opens, a `)`/`}` closes and a `'`
// starts a span whose parens are literal. A `\` skips the next `d` character.
// `stack` holds one character per open level: `c` for `$(` or `(`, `g` for a bare `{`,
// `p` for `${`. Inside a `${ … }` the `(`, `)`, `{` and `'` are literal word text
// (`"${x:-(}"`, `"${x:-it's}"`), so only a `}` closes it.
// Over-counting only leaves the state nested, which resolves no target.
function advanceNesting(nest, raw, kinds, end) {
  let { stack, tick, sq } = nest;
  for (let j = 0; j < end; j += 1) {
    if (kinds[j] !== 'd') continue;
    const c = raw[j];
    if (sq) { if (c === "'") sq = false; continue; }
    if (c === '\\') { if (kinds[j + 1] === 'd') j += 1; continue; }
    if (c === '`') tick = !tick;
    else if (c === '$' && (raw[j + 1] === '(' || raw[j + 1] === '{') && kinds[j + 1] === 'd') {
      stack += raw[j + 1] === '(' ? 'c' : 'p';
      j += 1;
    } else if (stack !== '' || tick) {
      const inParam = stack.endsWith('p');
      if (inParam) { if (c === '}') stack = stack.slice(0, -1); }
      else if (c === "'") sq = true;
      else if (stack !== '' && (c === '(' || c === '{')) stack += c === '(' ? 'c' : 'g';
      else if (stack !== '' && (c === ')' || c === '}')) stack = stack.slice(0, -1);
    }
  }
  return { stack, tick, sq };
}

function isNested(nest) {
  return nest.stack !== '' || nest.tick || nest.sq;
}

const NOT_NESTED = Object.freeze({ stack: '', tick: false, sq: false });

// The program names one raw token may stand for, lowercased, with quotes and
// backslashes removed: `bas\h`, `'/bin/bash'`, `C:\bin\sh.exe` each yield a name.
// A leading group or process-substitution opener (`(`, `{`, `>(`, `<(`) is
// dropped, then a glued redirection (`sh<<EOF`), then a trailing group closer
// (`bash)`, `bash;`, `}`), before the basename lookup.
function programNames(tok) {
  const s = tok.replace(/["']/g, '').replace(/^(?:[({]|[<>]\()+/, '').replace(/[<>].*$/, '').replace(/[);}]+$/, '');
  const bySlash = s.split('/').pop().replace(/\\/g, '');
  const byBackslash = s.split(/[\\/]/).pop();
  return [bySlash, byBackslash].map((n) => n.replace(/\.exe$/i, '').toLowerCase());
}

// `str` with its quoted spans removed, read the way splitSegments reads quotes: outside
// quotes and inside double quotes a backslash escapes the next character (an escaped
// quote opens or closes nothing), a double-quoted span nests as skipDoubleQuoted reads it,
// and single quotes have no escapes. An escaped pair outside quotes is kept as written. An
// unterminated span is kept, so text the shell might still run stays visible.
function removeQuotedSpans(str) {
  return scanPass((spans) => removeQuotedSpansWith(str, spans));
}

function removeQuotedSpansWith(str, spans) {
  let out = '';
  let span = '';
  let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote === null) {
      if (ch === '\\' && i + 1 < str.length) { out += ch + str[i + 1]; i += 1; continue; }
      if (ch === '"') {
        // Nested as bash reads it (skipDoubleQuoted); an unterminated span is kept.
        const r = spans.dq(str, i + 1);
        if (!r.closed) return out + str.slice(i);
        i = r.end - 1;
        continue;
      }
      if (ch === "'") { quote = ch; span = ch; continue; }
      // A backtick substitution keeps its text, read in its own quoting context (segmentSpans).
      if (ch === '`') {
        const r = spans.backtick(str, i + 1);
        if (r.closed) { out += `\`${removeQuotedSpans(str.slice(i + 1, r.end - 1))}\``; i = r.end - 1; continue; }
      }
      out += ch;
      continue;
    }
    span += ch;
    if (ch === quote) { quote = null; span = ''; }
  }
  return out + span;
}

// `seg` cut at every unquoted lone `&`, which ends the command before it and backgrounds it. `&&`,
// `&>`, `>&` and `<&` are not cut. The `&` of a `|&` (stdout and stderr piped on) starts the segment
// once splitSegments has cut its `|`, so its blank left piece is skipped and the piped-to program
// is what gets checked.
function splitOnLoneAmpersand(seg) {
  return scanPass((spans) => splitOnLoneAmpersandWith(seg, spans));
}

function splitOnLoneAmpersandWith(seg, spans) {
  const pieces = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < seg.length; i += 1) {
    const c = seg[i];
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (c === '\\') { i += 1; continue; }
    if (c === "'") { quote = c; continue; }
    // A backtick substitution is skipped whole: an `&` or a quote inside it is its own command's.
    if (c === '`') {
      const r = spans.backtick(seg, i + 1);
      if (r.closed) { i = r.end - 1; continue; }
    }
    // A double-quoted span or an unquoted `${ … }` nests as bash reads it (skipDoubleQuoted).
    const nested = c === '"' ? spans.dq(seg, i + 1) : c === '$' && seg[i + 1] === '{' ? spans.param(seg, i + 2) : null;
    if (nested && (c === '"' || nested.closed)) { i = nested.end - 1; continue; }
    if (c !== '&' || seg[i + 1] === '&' || seg[i + 1] === '>' || /[&<>|]/.test(seg[i - 1] || '')) continue;
    pieces.push(seg.slice(start, i));
    start = i + 1;
  }
  pieces.push(seg.slice(start));
  return pieces;
}

// True when the command sets the configuration of the git at `tokens[p]`: a -c/--config-env
// global flag before its subcommand (at `sub`), or a NAME=value assignment ahead of it (`assigned`,
// e.g. GIT_CONFIG_COUNT/KEY/VALUE). Configuration can make any subcommand run a command that reads
// stdin (`git -c core.fsmonitor='sh -s' commit -F -` runs the body), so such a git is neither an
// inert neighbour nor a data reader.
function gitIsConfigured(tokens, p, sub, assigned) {
  return assigned || tokens.slice(p + 1, sub).some((t) => t === '-c' || t.startsWith('--config-env'));
}

// True when the program at `tokens[p]` neither reads stdin nor runs an argument: an
// INERT_NEIGHBOUR_WORDS program, or `git add` (past git's global flags, and not configured by the
// command: gitIsConfigured) without --pathspec-from-file (its abbreviations included), which reads
// pathspecs from stdin. A command substitution is lineFeedsOnlyDataReaders' check.
function isInertNeighbour(tokens, p) {
  if (p >= tokens.length || !isBareOrAbsoluteProgram(tokens[p])) return false;
  const names = programNames(tokens[p]);
  if (names.every((n) => INERT_NEIGHBOUR_WORDS.has(n))) return true;
  if (!names.every((n) => n === 'git')) return false;
  const sub = skipGlobalFlags(tokens, p + 1, '/').index;
  return tokens[sub] === 'add'
    && !gitIsConfigured(tokens, p, sub, p > 0)
    && !tokens.some((t) => t.startsWith('--pathspec-f'));
}

// A heredoc operator (`<<`, but not the here-string `<<<`) in a command's text.
const OWN_HEREDOC_OPENER_RE = /(^|[^<])<<(?!<)/;

// Whether `text` holds a command substitution: a backtick, a `$(`, or a `$((` that bash does not
// close as arithmetic. Arithmetic ends at a `))` past its own balanced parens; a `$((` whose first
// unbalanced `)` is not doubled (`$((bash) )`, `$((sh); true)`) is a `$(` holding a subshell, and
// one that never closes is no arithmetic either.
function hasCommandSubstitution(text) {
  const arith = []; // per open `$((`: the parens opened inside it and not yet closed
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '`') return true;
    if (c === '$' && text[i + 1] === '(') {
      if (text[i + 2] !== '(') return true;
      arith.push(0);
      i += 2;
    } else if (arith.length && c === '(') arith[arith.length - 1] += 1;
    else if (arith.length && c === ')') {
      if (arith[arith.length - 1] > 0) arith[arith.length - 1] -= 1;
      else if (text[i + 1] !== ')') return true;
      else { arith.pop(); i += 1; }
    }
  }
  return arith.length > 0;
}

// True when every command on the opener's logical line is a known data reader, so
// the body it receives is data. The line is cut into commands at segment separators and at
// every lone `&` (splitOnLoneAmpersand). Per command: a group or process-substitution token
// (`(`, `{`, `}`, `>(`, `<(`) fails (its consumer may sit on a later line or inside
// the substitution); after NAME=value assignments, an inert neighbour (isInertNeighbour)
// passes; reader wrappers (sudo, env, ...) are skipped together with the flags and
// assignments that follow a wrapper, so a wrapper option's value (`sudo -u bob`) lands on
// the program slot and fails, and an `env` program-choosing flag (-S, -P) fails; the program word
// must then resolve ($NAME and backticks do not), be a bare name or an absolute path,
// and every spelling the parser can read from it must be a reader; `git` is a reader
// only for a data subcommand (GIT_DATA_SUBCOMMANDS), found past its global flags, and only
// when the command does not configure it (gitIsConfigured; an assignment behind a wrapper
// counts too, as in `env GIT_CONFIG_COUNT=1 git commit`). The
// group check reads the segment with its quoted spans removed (tokenize has already
// dropped the quotes), so a quoted `(.a)` is data, not a group. A command that carries a
// command substitution (hasCommandSubstitution) anywhere, quoted or not, is neither a reader nor
// a neighbour, unless it is the heredoc's own command (it holds an unquoted `<<`), no pipe feeds
// it and every substitution stands before its first `<<`: bash expands those words before it
// attaches the heredoc, so they read the shell's stdin, while a redirection word after the `<<`
// is expanded with the body already on fd 0 (`cat <<'EOF' > "$(bash)"` runs the body), and in a
// piped-to element a substitution reads the pipe (`| jq "$(bash)"` runs the body, and so does
// `cat <<'A' | jq "$(sh)" <<'B'`). Fails closed, so the body stays visible to the scan.
function lineFeedsOnlyDataReaders(lineText) {
  const lineSpans = segmentSpans(lineText);
  for (let s = 0; s < lineSpans.length; s += 1) {
    const sep = s === 0 ? '' : lineText.slice(lineSpans[s - 1].end, lineSpans[s - 1].end + 2);
    let fed = sep[0] === '|' && sep !== '||'; // a `|` or `|&` pipes into the next command
    for (const seg of splitOnLoneAmpersand(lineSpans[s].text)) {
      if (seg.trim() === '') continue; // the blank piece before a `|&`'s `&`
      const pipedInto = fed;
      fed = false;
      // The own command's words from its first `<<` on (the raw match, which comes no later than
      // the unquoted one) must hold no substitution.
      const own = !pipedInto && OWN_HEREDOC_OPENER_RE.test(removeQuotedSpans(seg));
      if (hasCommandSubstitution(own ? seg.slice(seg.search(OWN_HEREDOC_OPENER_RE)) : seg)) return false;
      if (!checkReaderCommand(seg)) return false;
    }
  }
  return true;
}

// One command of lineFeedsOnlyDataReaders: true when it is an inert neighbour or a data reader.
function checkReaderCommand(seg) {
  const unquoted = removeQuotedSpans(seg).split(/\s+/);
  if (unquoted.some((t) => /^[({]/.test(t) || t === '}' || /[<>]\(/.test(t))) return false;
  const { tokens } = tokenize(seg.trim());
  let p = 0;
  while (p < tokens.length && SIMPLE_ASSIGNMENT_RE.test(tokens[p])) p += 1;
  if (isInertNeighbour(tokens, p)) return true;
  let assigned = p > 0;
  while (p < tokens.length && isBareOrAbsoluteProgram(tokens[p]) && programNames(tokens[p]).every((n) => READER_WRAPPER_WORDS.has(n))) {
    const isEnv = programNames(tokens[p]).includes('env');
    p += 1;
    while (p < tokens.length && (tokens[p].startsWith('-') || SIMPLE_ASSIGNMENT_RE.test(tokens[p]))) {
      if (isEnv && ENV_PROGRAM_FLAG_RE.test(tokens[p])) return false;
      if (SIMPLE_ASSIGNMENT_RE.test(tokens[p])) assigned = true;
      p += 1;
    }
  }
  if (p >= tokens.length || /[$`]/.test(tokens[p]) || !isBareOrAbsoluteProgram(tokens[p])) return false;
  const names = programNames(tokens[p]);
  if (!names.every((n) => DATA_READER_WORDS.has(n))) return false;
  if (names.includes('git')) {
    const sub = skipGlobalFlags(tokens, p + 1, '/').index;
    if (gitIsConfigured(tokens, p, sub, assigned) || !GIT_DATA_SUBCOMMANDS.has(tokens[sub])) return false;
  }
  return true;
}

// Reads a heredoc operand starting just after `<<`: an optional `-`, blanks, then
// the delimiter word. The word ends at unquoted whitespace or a shell metachar.
// Returns { delim, quoted, stripTabs, end }, { unprovable: true, end } for a
// `$'...'`/`$"..."` delimiter, or null when the operand is empty or its quoting
// is unterminated (not an opener).
function readHeredocOpener(str, j) {
  let stripTabs = false;
  if (str[j] === '-') { stripTabs = true; j += 1; }
  while (str[j] === ' ' || str[j] === '\t') j += 1;
  const start = j;
  let quote = null;
  while (j < str.length) {
    const c = str[j];
    if (quote === "'") { if (c === "'") quote = null; j += 1; continue; }
    if (c === '\\' && j + 1 < str.length) { j += 2; continue; }
    if (quote === '"') { if (c === '"') quote = null; j += 1; continue; }
    if (c === '"' || c === "'") { quote = c; j += 1; continue; }
    if (/[\s;&|<>()]/.test(c)) break;
    j += 1;
  }
  if (quote !== null) return null;
  const raw = str.slice(start, j);
  // Bash decodes `$'...'` / `$"..."` in the delimiter word, which this parser
  // does not, so the terminator cannot be known: the opener is unprovable.
  if (/\$['"]/.test(raw)) return { unprovable: true, end: j };
  const delim = decodeHeredocWord(raw);
  if (!delim) return null;
  return { delim, quoted: /["'\\]/.test(raw), stripTabs, end: j };
}

// The delimiter word as bash reads it: quotes removed, single-quoted text literal,
// a backslash escaping the next character outside single quotes (inside double
// quotes only before $ ` " \ or a newline). Null when a quote is unterminated.
function decodeHeredocWord(raw) {
  let out = '';
  for (let k = 0; k < raw.length; k += 1) {
    const c = raw[k];
    if (c === "'") {
      const close = raw.indexOf("'", k + 1);
      if (close === -1) return null;
      out += raw.slice(k + 1, close);
      k = close;
    } else if (c === '"') {
      let m = k + 1;
      while (m < raw.length && raw[m] !== '"') {
        if (raw[m] === '\\' && m + 1 < raw.length && '$`"\\\n'.includes(raw[m + 1])) {
          out += raw[m + 1];
          m += 2;
        } else {
          out += raw[m];
          m += 1;
        }
      }
      if (m >= raw.length) return null;
      k = m;
    } else if (c === '\\' && k + 1 < raw.length) {
      out += raw[k + 1];
      k += 1;
    } else {
      out += c;
    }
  }
  return out;
}

// True when `s` ends in an odd-length run of backslashes (a line continuation).
// A linear backward count: a regex run match backtracks quadratically.
function endsInOddBackslashRun(s) {
  let n = 0;
  while (n < s.length && s[s.length - 1 - n] === '\\') n += 1;
  return n % 2 === 1;
}

// Scans one heredoc body starting at index p, through the line equal to the
// delimiter (leading tabs ignored for `<<-`, one trailing `\r` ignored). `text` is
// the body without that closing line. With no closing line the body runs to end of
// string and `terminated` is false. For an unquoted delimiter, bash joins a line that
// ends in an odd run of backslashes with the next one before comparing, so `E\` +
// `OF` closes the body; a quoted delimiter takes no continuation. A trailing odd
// backslash with no next line is left as-is. The run is counted on the raw line, so
// only backslash-LF continues (backslash-CR-LF does not, as in bash); the delimiter
// match still tolerates one trailing `\r`, which can only close a body earlier. The
// joined line is built from its raw parts in one join, so a long continuation chain
// costs linear time; the parity of the last raw part decides each continuation (the
// part before it, minus its continuing backslash, ends in an even run).
function scanHeredocBody(str, p, h) {
  const bodyStart = p;
  while (p < str.length) {
    let end = str.indexOf('\n', p);
    if (end === -1) end = str.length;
    let line = str.slice(p, end);
    if (!h.quoted && end < str.length && endsInOddBackslashRun(line)) {
      const parts = [];
      while (end < str.length && endsInOddBackslashRun(line)) {
        parts.push(line.slice(0, -1));
        const nextStart = end + 1;
        end = str.indexOf('\n', nextStart);
        if (end === -1) end = str.length;
        line = str.slice(nextStart, end);
      }
      parts.push(line);
      line = parts.join('');
    }
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (h.stripTabs) line = line.replace(/^\t+/, '');
    if (line === h.delim) return { end: Math.min(end + 1, str.length), terminated: true, text: str.slice(bodyStart, p) };
    p = end + 1;
  }
  return { end: str.length, terminated: false, text: str.slice(bodyStart) };
}

// A line ending in `|`, `&&` or `||` (optionally followed by a comment) continues
// onto the next line, so a later command receives its bodies.
const CONTINUATION_RE = /(?:\|\||&&|\|)\s*(?:#.*)?$/;

// Reserved words that open a compound command, keyed to the word that closes it.
const COMPOUND_OPENERS = new Map([['if', 'fi'], ['for', 'done'], ['while', 'done'], ['until', 'done'], ['select', 'done'], ['case', 'esac']]);
// Reserved words after which the next word is again at command position.
const COMMAND_PREFIX_WORDS = new Set(['if', 'while', 'until', 'then', 'do', 'else', 'elif', '!', 'time']);

// True when the logical line `line` leaves a structure open at its end, so a later line
// may hand a heredoc body to a consumer this line cannot show (`{` … `} | bash`): an
// unquoted paren or brace (`(`, `$(`, `<(`, `>(`, `((`, `{`, `${`) or backtick left
// unclosed, or a compound-command opener (if, for, while, until, select, case) at command
// position with no closer (fi, done, esac) at command position after it on the line. An
// unquoted `$'` counts too: ANSI-C quoting honours `\'`, which this scan does not follow.
// Biased to "open": an opener counts wherever it may be one, a closer only where it
// surely is one, so the count can only undercount closers. A `)` closes nothing while a
// `case` is open on the line (it may be a pattern's), and a `}` closes a brace group only
// as a word at command position after `;` or `&`.
function lineLeavesStructureOpen(line) {
  const stack = []; // '(' | '{' | '${'
  const open = { fi: 0, done: 0, esac: 0 };
  let cmdPos = true; // the next word is at command position
  let closerPos = true; // ...directly after `;`, `;;` or `&`, where a closer may stand
  let word = '';
  let plain = true; // the word has no quoted, escaped or expanded part
  const spans = topLevelSpans();
  const endWord = () => {
    if (word === '') return;
    const w = word;
    const isPlain = plain;
    word = '';
    plain = true;
    const atCmd = cmdPos;
    const atCloser = closerPos;
    cmdPos = false;
    closerPos = false;
    if (!isPlain) return;
    if (w === '{') { stack.push('{'); cmdPos = true; return; }
    if (w === '}') { if (atCloser && stack[stack.length - 1] === '{') stack.pop(); return; }
    if (atCmd && COMPOUND_OPENERS.has(w)) open[COMPOUND_OPENERS.get(w)] += 1;
    else if (atCloser && Object.prototype.hasOwnProperty.call(open, w)) open[w] = Math.max(0, open[w] - 1);
    if (atCmd && COMMAND_PREFIX_WORDS.has(w)) cmdPos = true;
  };
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '\\') { word += c + (line[i + 1] || ''); plain = false; i += 1; continue; }
    if (c === '"') {
      // Nested as bash reads it (skipDoubleQuoted), so a `)` inside a quoted "$( )" closes nothing.
      // A span left open, a capped one among them (the line's spans share one step budget:
      // topLevelSpans), leaves the line open (fail closed).
      const r = spans.dq(line, i + 1);
      if (!r.closed) return true;
      word += line.slice(i, r.end);
      plain = false;
      i = r.end - 1;
      continue;
    }
    if (c === "'" || c === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += c !== "'" && line[j] === '\\' ? 2 : 1;
      if (j >= line.length) return true;
      word += line.slice(i, j + 1);
      plain = false;
      i = j;
      continue;
    }
    if (c === '$' && line[i + 1] === "'") return true;
    if (c === '$' && line[i + 1] === '(') { endWord(); stack.push('('); cmdPos = true; i += 1; continue; }
    if (c === '$' && line[i + 1] === '{') { stack.push('${'); word += '${'; plain = false; i += 1; continue; }
    if (c === '}' && stack[stack.length - 1] === '${') { stack.pop(); word += c; plain = false; continue; }
    if (c === '#' && word === '') break;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { endWord(); continue; }
    if (c === ';' || (c === '&' && line[i + 1] !== '&' && line[i + 1] !== '>')) {
      endWord();
      while (line[i + 1] === ';' || line[i + 1] === '&') i += 1;
      cmdPos = true;
      closerPos = true;
      continue;
    }
    if (c === '&' && line[i + 1] === '&') { endWord(); i += 1; cmdPos = true; continue; }
    if (c === '|') { endWord(); if (line[i + 1] === '|' || line[i + 1] === '&') i += 1; cmdPos = true; continue; }
    if (c === '(') { endWord(); stack.push('('); cmdPos = true; continue; }
    if (c === ')') {
      endWord();
      if (open.esac === 0 && stack[stack.length - 1] === '(') stack.pop();
      cmdPos = true;
      continue;
    }
    if (c === '<' || c === '>' || c === '&') {
      endWord();
      if (line[i + 1] === '(') { stack.push('('); cmdPos = true; i += 1; continue; }
      while (/[<>&|]/.test(line[i + 1] || '')) i += 1;
      continue;
    }
    word += c;
  }
  endWord();
  return stack.length > 0 || open.fi > 0 || open.done > 0 || open.esac > 0;
}

// Shells whose script is one bash-like program: a kept body on a line naming one of these has its
// own heredoc openers planned and nothing more (see walkShellChunk).
const KNOWN_SHELL_WORDS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash']);

// Plans one logical line's heredoc bodies, which start at index `start`:
//   rest  - a body is unterminated: the text from `start` on is kept as written;
//   keep  - each body is returned as its own chunk ({ at, text, shell }, `at` being its
//           opener's index in the outer text, `shell` whether a token on the line names a
//           KNOWN_SHELL_WORDS program), because a structure is open (`lineOpen`:
//           left open on an earlier line or on this one), the line feeds them to
//           something other than a known data reader, the line continues, or an
//           unquoted body expands `$(` or a backtick; `end` is the index after the last;
//   strip - every body is data; `end` is the index after the last one.
function planHeredocBodies(str, start, pending, lineText, lineOpen) {
  const bodies = [];
  let p = start;
  for (const h of pending) {
    const body = scanHeredocBody(str, p, h);
    if (!body.terminated) return { kind: 'rest' };
    bodies.push({ h, text: body.text });
    p = body.end;
  }
  const keep = lineOpen || CONTINUATION_RE.test(lineText) || !lineFeedsOnlyDataReaders(lineText);
  const expands = bodies.some(({ h, text }) => !h.quoted && /\$\(|`/.test(text));
  if (keep || expands) {
    const shell = tokenize(lineText).tokens.some((tok) => programNames(tok).some((n) => KNOWN_SHELL_WORDS.has(n)));
    return { kind: 'keep', end: p, bodies: bodies.map(({ h, text }) => ({ at: h.at, text, shell })) };
  }
  return { kind: 'strip', end: p };
}

// The single char-level pass behind stripHeredocBodies. Quote, escape, and comment
// handling mirror splitSegments, so a `<<` inside quotes or after a word-boundary
// `#` is never an opener. Every terminated body is cut out of the outer text with its
// closing line, so the outer scan resumes after the delimiter with fresh quote state and
// never plans an opener inside a body; a kept body is returned as its own chunk.
function scanHeredocs(str) {
  return scanPass((spans) => scanHeredocsWith(str, spans));
}

function scanHeredocsWith(str, spans) {
  const out = [];
  let outLen = 0;
  const emit = (s) => { out.push(s); outLen += s.length; };
  const bodies = []; // kept bodies, { at, text, shell }, in order
  // null | "'" | '"'. A double-quoted span is emitted whole, nested as skipDoubleQuoted reads it,
  // unless it holds a `<<` after a `$(`: then it is read a character at a time (`"`), so a heredoc
  // opened inside its substitution is found (#4210, below).
  let quote = null;
  // Each open `"$( … )"` substitution (#4210): its paren depth and where its own text starts. A
  // heredoc opened inside one is planned against that text (`cat <<'EOF'`), never the outer line,
  // since the substitution's command is the one that reads the body.
  const subs = [];
  // Parens left open by a `((` or `$((`: `((` opens two and every single paren inside counts, so
  // `((cd x && ls) | cat)` (bash's nested-subshell reading) closes at its final `)`. It spans
  // lines, as a multi-line `((`/`$((` does in bash, so a `<<` on a later line inside it is a shift.
  let parenDepth = 0;
  let bracketDepth = 0; // unclosed `$[`; arithmetic only, so it spans lines as bash's does
  let pending = []; // heredocs opened on the current logical line, in order
  let sticky = false; // a structure was left open on an earlier line: keep every later body
  let lineStart = 0;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (quote === "'") {
      emit(ch);
      if (ch === "'") quote = null;
      i += 1;
    } else if (ch === '\\' && i + 1 < str.length) {
      emit(ch + str[i + 1]);
      i += 2;
    } else if (quote === '"' && ch === '$' && str[i + 1] === '(' && str[i + 2] !== '(') {
      // #4210: `"$( … )"` is a command-substitution context whose text is shell again, so
      // a heredoc opened inside it (`"$(cat <<'EOF' … EOF\n)"`, the commit-message idiom)
      // is found, and its body no longer reads as quotes. `subs` holds one paren depth per
      // open substitution; the `)` that closes the last one returns to the double quote.
      emit('$(');
      subs.push({ depth: 1, start: i + 2 });
      quote = null;
      i += 2;
    } else if (quote === '"') {
      emit(ch);
      if (ch === '"') quote = null;
      i += 1;
    } else if (ch === '"') {
      const end = spans.dq(str, i + 1).end;
      if (/\$\((?!\()[\s\S]*<</.test(str.slice(i, end))) {
        quote = ch;
        emit(ch);
        i += 1;
      } else {
        emit(str.slice(i, end));
        i = end;
      }
    } else if (ch === '`' && spans.backtick(str, i + 1).closed) {
      // A backtick substitution is its own command text: a quote or `<<` inside it opens nothing
      // out here, so a heredoc inside it keeps its body in the outer text, visible.
      const end = skipBacktick(str, i + 1).end;
      emit(str.slice(i, end));
      i = end;
    } else if (ch === "'") {
      quote = ch;
      emit(ch);
      i += 1;
    } else if (ch === '#' && (i === 0 || /[\s;&|]/.test(str[i - 1]))) {
      let j = str.indexOf('\n', i);
      if (j === -1) j = str.length;
      emit(str.slice(i, j));
      i = j;
    } else if (ch === '\n') {
      const lineText = str.slice(subs.length ? Math.max(lineStart, subs[subs.length - 1].start) : lineStart, i);
      i += 1;
      emit(ch);
      sticky = sticky || lineLeavesStructureOpen(lineText);
      if (pending.length) {
        const plan = planHeredocBodies(str, i, pending, lineText, sticky);
        if (plan.kind === 'rest') {
          emit(str.slice(i));
          break;
        }
        if (plan.kind === 'keep') bodies.push(...plan.bodies);
        i = plan.end;
      }
      pending = [];
      lineStart = i;
    } else if (ch === '$' && str[i + 1] === '[') {
      bracketDepth += 1;
      emit('$[');
      i += 2;
    } else if (ch === '[' && bracketDepth > 0) {
      bracketDepth += 1; // an array subscript inside `$[ … ]` nests
      emit(ch);
      i += 1;
    } else if (ch === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      emit(ch);
      i += 1;
    } else if (ch === '(' && (parenDepth > 0 || str[i + 1] === '(')) {
      const n = parenDepth > 0 ? 1 : 2;
      parenDepth += n;
      emit(str.slice(i, i + n));
      i += n;
    } else if (ch === ')' && parenDepth > 0) {
      parenDepth -= 1;
      emit(ch);
      i += 1;
    } else if (subs.length > 0 && (ch === '(' || ch === ')')) {
      subs[subs.length - 1].depth += ch === '(' ? 1 : -1;
      if (subs[subs.length - 1].depth === 0) {
        subs.pop();
        quote = '"';
      }
      emit(ch);
      i += 1;
    } else if (ch === '<' && str[i + 1] === '<' && str[i + 2] === '<') {
      emit('<<<'); // a here-string is never a heredoc
      i += 3;
    } else if (ch === '<' && str[i + 1] === '<') {
      // A `<<` inside an open `((...))` or `$[...]` is an arithmetic shift, not an opener.
      const h = parenDepth === 0 && bracketDepth === 0 ? readHeredocOpener(str, i + 2) : null;
      if (h && h.unprovable) {
        emit(str.slice(i));
        break;
      }
      if (h) {
        h.at = outLen;
        emit(str.slice(i, h.end));
        pending.push(h);
        i = h.end;
      } else {
        emit('<<');
        i += 2;
      }
    } else {
      emit(ch);
      i += 1;
    }
  }
  return { outer: out.join(''), bodies };
}

// Splits a command into its outer shell text and the heredoc bodies the scan cannot
// prove are data. Returns { outer, bodies }: `outer` is the command with every
// terminated body and its closing-delimiter line removed (the opener line keeps its
// newline, so whatever follows the delimiter starts its own segment); `bodies` lists
// each kept body as { at, text, shell }, `at` being the index of its `<<` in `outer`, `text`
// the body without its closing line and `shell` whether its opener line names a known
// shell (planHeredocBodies). A body fed to a known data reader is dropped; any
// other (fed to another program, an unquoted body that expands, a continuation line, a
// structure left open) is kept: see planHeredocBodies. An unterminated body leaves the
// text from its opener on in `outer` as written. Any internal failure returns the input
// as `outer` with no bodies (the pre-#3989 scan).
function stripHeredocBodies(command) {
  if (typeof command !== 'string') return { outer: command, bodies: [] };
  try {
    return scanHeredocs(command);
  } catch {
    return { outer: command, bodies: [] };
  }
}

// Heredoc nesting past this depth is scanned as plain text with no body split out.
// Each level rescans its own body, so the cap bounds a deep nest's cost at this many
// passes over the input.
const MAX_HEREDOC_NESTING = 8;

// Group structure of one segment, for walkShellChunk (#4149): a `(` or `{` at command position
// opens a group and the `)` or `}` that matches it closes it, so a `cd` behind `(`/`{` is read as
// a `cd` scoped to its group. Returns the segment as { text } pieces and { open } / { close } /
// { bg } events, in order ({ bg } at a lone `&`, which backgrounds the and-or list before it);
// `g.stack` carries the open groups and nesting parens across segments. Any
// other `(` (`$(`, `$((`, `<(`, an array, a glob) only nests until its `)`. A `)` while a `case` is
// open in the innermost group is a pattern's, and a `)` that matches nothing (a group this walk
// never saw open, as in `if (…)`): either one closes nothing but cuts the text, so the command
// after it is a piece of its own and a glued closer (`f.js)`) is not part of a word.
function groupEvents(seg, g) {
  // Each change to the group state is journaled as its undo, so a second (flat) pass starts again
  // from the state this one started from.
  const undo = [];
  return scanPass((spans) => {
    while (undo.length) undo.pop()();
    return groupEventsWith(seg, g, spans, undo);
  });
}

function groupEventsWith(seg, g, spans, undo) {
  const events = [];
  let start = 0;
  let atCmd = true; // the next word is at command position
  const top = () => g.stack[g.stack.length - 1] || g.root;
  const count = (frame, d) => { if (frame.kind === 'p') g.nesting += d; };
  const push = (frame) => { g.stack.push(frame); count(frame, 1); undo.push(() => { count(g.stack.pop(), -1); }); };
  const pop = () => { const frame = g.stack.pop(); count(frame, -1); undo.push(() => { g.stack.push(frame); count(frame, 1); }); };
  // Whether the current piece began inside a nesting frame (`$(`, `<(`, ...): its commands run in a
  // subshell, so their `cd` and assignments never reach the outer walk. A group frame opened there
  // carries `sub` the same way.
  let inSub = g.nesting > 0;
  let pieceNesting = g.nesting; // the nesting the current piece began at
  let tail = false; // the current piece follows the closer of a substitution: the rest of its command
  const setCaseDepth = (frame, d) => { const was = frame.caseDepth; frame.caseDepth = d; undo.push(() => { frame.caseDepth = was; }); };
  const cut = (at, ev) => {
    if (at > start) events.push({ text: seg.slice(start, at), sub: inSub, tail });
    if (ev) events.push(ev);
    start = at + 1;
    inSub = g.nesting > 0;
    pieceNesting = g.nesting;
    tail = false;
  };
  const nest = (n, cmd) => {
    for (let k = 0; k < n; k += 1) push({ kind: 'p', caseDepth: 0, arith: n === 2 });
    atCmd = cmd;
  };
  let parens = null; // parenMatches(seg), computed at the first `((` at command position
  let i = 0;
  while (i < seg.length) {
    const c = seg[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i += 1; continue; }
    if (c === '(') {
      // An arithmetic `(( … ))` command nests like `$(( … ))`, so it stays one piece and the
      // redirect scan reads its body as a comparison (compoundBodyEnd, #4015), not as a group's
      // commands. Any other `((` is two subshells (`((cd x && ls) | cat)`).
      if (atCmd && seg[i + 1] === '(') {
        if (parens === null) parens = parenMatches(seg);
        const inner = parens.get(i + 1);
        if (inner !== undefined && seg[inner + 1] === ')') { nest(2, false); i += 2; continue; }
      }
      if (atCmd) {
        const frame = { kind: '(', caseDepth: 0, sub: g.nesting > 0 };
        push(frame);
        cut(i, { open: frame });
      } else nest(1, false);
      i += 1;
      continue;
    }
    if (c === ')') {
      const t = top();
      if (t.caseDepth === 0 && t.kind === 'p') {
        // The `)` of a substitution this piece began inside ends that piece, so the closer is part
        // of no word (`cp a f.js )`), and the text after it is the rest of the command the
        // substitution sits in, run out there (`$(true; cd /tmp) > f.js` writes from the outer cwd).
        pop();
        if (g.nesting < pieceNesting) { cut(i, null); tail = true; }
        atCmd = false;
      }
      else if (t.caseDepth === 0 && t.kind === '(') { pop(); cut(i, { close: t }); atCmd = false; }
      else { cut(i, null); atCmd = true; }
      i += 1;
      continue;
    }
    if (c === '<' || c === '>' || c === '&') {
      let j = i + 1;
      while (j < seg.length && /[<>&|]/.test(seg[j])) j += 1;
      if (c !== '&' && j === i + 1 && seg[j] === '(') { nest(1, true); i = j + 1; continue; }
      if (c === '&' && j === i + 1) {
        // A lone `&` ends the and-or list before it and runs it in the background. When it starts
        // the segment it is the `&` of `|&` (segmentSpans has cut the `|`), which pipes on: it is
        // dropped from the text, with no background. Inside a substitution or a group in one it
        // backgrounds that subshell's own list (`sub`: the walk resets the sub run, never the outer
        // cwd); inside `$(( ))` it is arithmetic, so it is left alone.
        if (!top().arith) cut(i, i > 0 ? { bg: true, sub: g.nesting > 0 } : null);
        atCmd = true;
      }
      // Any other operator is a redirection. Its target is read as an ordinary word, which ends
      // command position: bash recognizes no reserved word after a redirection (`> f {` is no group).
      i = j;
      continue;
    }
    const wStart = i;
    let w = '';
    let plain = true;
    let subst = 0; // 1 for `$(`, 2 for `$((`
    while (i < seg.length && !/[\s()<>&;|]/.test(seg[i])) {
      const ch = seg[i];
      if (ch === '\\') { i += 2; plain = false; continue; }
      if (ch === "'") {
        const close = seg.indexOf("'", i + 1);
        i = close === -1 ? seg.length : close + 1;
        plain = false;
        continue;
      }
      // A double-quoted span or an unquoted `${ … }` nests as bash reads it (skipDoubleQuoted), so an
      // `&` or `)` inside it is no background and closes no group.
      const nested = ch === '"' ? spans.dq(seg, i + 1) : ch === '$' && seg[i + 1] === '{' ? spans.param(seg, i + 2) : null;
      if (nested && (ch === '"' || nested.closed)) {
        i = nested.end;
        plain = false;
        continue;
      }
      if (ch === '`' || (ch === '$' && seg[i + 1] === "'")) {
        const q = ch === '$' ? "'" : ch;
        let j = ch === '$' ? i + 2 : i + 1;
        while (j < seg.length && seg[j] !== q) j += seg[j] === '\\' ? 2 : 1;
        i = j + 1;
        plain = false;
        continue;
      }
      if (ch === '$' && seg[i + 1] === '(') { subst = seg[i + 2] === '(' ? 2 : 1; break; }
      w += ch;
      i += 1;
    }
    if (subst) { nest(subst, subst === 1); i += 1 + subst; continue; }
    if (i === wStart) { i += 1; continue; } // a stray separator character: never a word
    if (!plain || !atCmd) { atCmd = false; continue; }
    const t = top();
    if (w === '{') {
      const frame = { kind: '{', caseDepth: 0, sub: g.nesting > 0 };
      push(frame);
      cut(wStart, { open: frame });
      continue; // still at command position
    }
    if (w === '}' && t.kind === '{') { pop(); cut(wStart, { close: t }); atCmd = false; continue; }
    if (w === 'case') setCaseDepth(t, t.caseDepth + 1);
    else if (w === 'esac') setCaseDepth(t, Math.max(0, t.caseDepth - 1));
    atCmd = COMMAND_PREFIX_WORDS.has(w);
  }
  if (seg.length > start) events.push({ text: seg.slice(start), sub: inSub, tail });
  return events;
}

// For one segment, the index of the `)` that matches each `(` (absent when it never closes), in one
// linear pass. groupEvents reads a `((` at command position as bash does: arithmetic when the paren
// after its first `(` closes at a `)` directly followed by another `)`. Bash reads that matched pair
// with quotes, so a `)` in a quoted span or a backtick substitution closes nothing here either.
function parenMatches(seg) {
  const match = new Map();
  const stack = [];
  for (let i = 0; i < seg.length; i += 1) {
    const c = seg[i];
    if (c === '\\') { i += 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < seg.length && seg[j] !== c) j += c !== "'" && seg[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (c === '(') stack.push(i);
    else if (c === ')' && stack.length) match.set(stack.pop(), i);
  }
  return match;
}

// visitSegment for each cwd the walk may be in (a list, as after a brace group), deduplicated.
// `handler` gets a fourth argument, true on every visit of the piece after the first, so a
// consumer can drop a target that does not depend on the cwd (`git -C /x`) the second time.
// The piece is tokenized once; `nest.value` is the chunk's nesting state (advanceNesting,
// #4210), read at the piece's start and advanced past it once, however many cwds visit it.
function visitUnderEach(text, cwds, vars, handler, nest) {
  const tok = tokenize(text.trim());
  const nestAt = tok.tokens.map((w, i) => {
    const at = nest.value;
    nest.value = advanceNesting(nest.value, w, tok.spanKinds[i], w.length);
    return at;
  });
  const next = [];
  cwds.forEach((c, k) => {
    const n = visitSegment(tok, nestAt, c, vars, k === 0 ? handler : (t, effCwd, quoting) => handler(t, effCwd, quoting, true));
    if (!next.includes(n)) next.push(n);
  });
  return next;
}

// The walk behind forEachCommandSegment, over every piece of text the shell may run (#3989/#4149): the
// outer text, then each kept heredoc body as its own chunk, right after the segment
// that holds its opener. A chunk starts from fresh quote state, the cwd in effect at
// its opener and a copy of the outer assignments; whatever cwd or assignment it changes
// is discarded, so the outer walk resumes after the delimiter with its own state. A
// chunk's own openers are planned within the chunk; a chunk whose opener line names no
// known shell (make, at, ...) may not run as one script, so it is also walked whole, with no
// inner opener planned. Each segment is walked through its groups (groupEvents): a cwd set
// inside a subshell ends at its `)`; after a brace group's `}` (whose `cd` persists unless the
// group is piped, so its scope end cannot be placed) the walk continues under both the inner and
// the outer cwd, so `handler` may run once per cwd for a segment (visitUnderEach). A lone `&`
// backgrounds the and-or list before it, which runs in a subshell: the cwd returns to what it was
// where that list began (after the last `;`, newline, `&` or group opener).
//
// The walk carries at most CWD_SET_CAP cwds at once. Each brace group's `}` and each tail can add
// a cwd, and every later piece is visited once per cwd, so a command with many distinct `cd`
// paths would be quadratic. Past the cap the set collapses, failing closed, to the caller's
// `opts.overflowCwd` (a path, or a function returning one, called at most once; pre-tool-use passes
// the main checkout, so a relative target resolves where the worktree gate denies it) together
// with the walk's own starting cwd (where a worktree-local shadow is denied).
const CWD_SET_CAP = 16; // four groups each with a relative cd already make 2^4 cwds
function forEachShellSegment(command, cwd, handler, opts = {}) {
  const start = cwd || '.';
  let collapsed = null;
  const overflow = () => {
    if (collapsed === null) {
      const o = typeof opts.overflowCwd === 'function' ? opts.overflowCwd() : opts.overflowCwd;
      collapsed = o && o !== start ? [o, start] : [start];
    }
    return collapsed;
  };
  walkShellChunk(String(command || ''), [start], new Map(), handler, 0, true, overflow);
}

// The union of two cwd lists, collapsed to `overflow()` past CWD_SET_CAP.
function joinCwds(a, b, overflow) {
  const out = [...a, ...b.filter((c) => !a.includes(c))];
  return out.length > CWD_SET_CAP ? overflow() : out;
}

function walkShellChunk(text, cwds, vars, handler, depth, plan, overflow) {
  const { outer, bodies } = plan && depth < MAX_HEREDOC_NESTING ? stripHeredocBodies(text) : { outer: text, bodies: [] };
  const g = { root: { kind: 'root', caseDepth: 0 }, stack: [], nesting: 0 };
  let cur = cwds;
  // A piece inside a substitution or a backtick span runs in a subshell: it is visited from the
  // cwd and assignments in effect, and what it changes holds only for the pieces after it in the
  // same run of sub pieces, never for the outer walk. A group opened inside the substitution is
  // scoped within that run (its saved cwd is the sub cwd), so its events do not end the run; the
  // next outer piece (the text after the substitution's closer among them) or outer group event does.
  // The run keeps its own and-or list start, so a lone `&` inside it backgrounds only the run's list.
  let subCur = null;
  let subVars = null;
  let subListStart = null;
  const startSubRun = () => {
    if (subCur !== null) return;
    subCur = cur;
    subVars = new Map(vars);
    subListStart = cur;
  };
  let listStart = cwds; // the cwds where the current and-or list began
  // A tail piece (the rest of a command after a substitution's closer) is visited on its own, so
  // whether a `cd` or an assignment in it runs (`x=$(…) cd /x`) or is an argument (`echo $(…) cd
  // /x`) is unknown: its cwd is added to the ones in effect (failing closed), and what it assigns
  // is dropped, as before the closer cut it (forgetting a name would drop the targets that use it).
  const nest = { value: NOT_NESTED }; // carried across this chunk's pieces in text order (#4210)
  const visitPiece = (ev, pieceCwds, pieceVars) => {
    if (!ev.tail) return visitUnderEach(ev.text, pieceCwds, pieceVars, handler, nest);
    const next = visitUnderEach(ev.text, pieceCwds, new Map(pieceVars), handler, nest);
    return joinCwds(pieceCwds, next, overflow);
  };
  let b = 0;
  const runBodies = (until, bodyCwds) => {
    for (; b < bodies.length && bodies[b].at < until; b += 1) {
      walkShellChunk(bodies[b].text, bodyCwds, new Map(vars), handler, depth + 1, true, overflow);
      if (!bodies[b].shell) walkShellChunk(bodies[b].text, bodyCwds, new Map(vars), handler, depth + 1, false, overflow);
    }
  };
  for (const span of segmentSpans(outer)) {
    const before = cur;
    for (const ev of groupEvents(span.text, g)) {
      if (ev.open ? ev.open.sub || span.sub : ev.close ? ev.close.inSubRun : ev.bg && (ev.sub || span.sub)) {
        startSubRun();
        if (ev.open) {
          ev.open.inSubRun = true;
          ev.open.saved = subCur;
          ev.open.savedList = subListStart;
          subListStart = subCur;
        } else if (ev.close) {
          const { saved } = ev.close;
          subCur = ev.close.kind === '(' ? saved : joinCwds(saved, subCur, overflow);
          subListStart = ev.close.savedList;
        } else subCur = subListStart;
        continue;
      }
      if (ev.open) {
        ev.open.saved = cur;
        ev.open.savedList = listStart;
        listStart = cur;
      } else if (ev.close) {
        const { saved } = ev.close;
        cur = ev.close.kind === '(' ? saved : joinCwds(saved, cur, overflow);
        listStart = ev.close.savedList;
      } else if (ev.bg) cur = listStart;
      else if (ev.sub || span.sub) {
        startSubRun();
        subCur = visitPiece(ev, subCur, subVars);
        continue;
      } else cur = visitPiece(ev, cur, vars);
      subCur = null;
    }
    runBodies(span.end, before);
    // `&&`, `||` and `|` continue the and-or list; `;`, a newline or the end start a new one.
    if (outer[span.end] !== '&' && outer[span.end] !== '|') {
      listStart = cur;
      if (subCur !== null) subListStart = subCur;
    }
  }
  runBodies(Infinity, cur);
}

// Where a `[[ … ]]` or `(( … ))` segment's body ends: the `>` inside one is a
// comparison (`[[ a>b ]]`, `(( x>y ))`), never a redirection, so the redirect scan
// starts at the token after the closing word. 0 for any other segment; an
// unterminated body (a glued closer such as `y))`) is skipped whole, which fails
// open (#4015). A compound command may follow a control keyword on the same
// segment (`if (( x>y ))`, `while [[ a>b ]]`), so the keywords are skipped first.
const COMPOUND_LEAD_WORDS = new Set(['if', 'elif', 'while', 'until', 'then', 'do', 'else', '!']);

function compoundBodyEnd(t) {
  let lead = 0;
  while (lead < t.length && COMPOUND_LEAD_WORDS.has(t[lead])) lead += 1;
  const closer = t[lead] === '[[' ? ']]' : t[lead] === '((' ? '))' : null;
  if (closer === null) return 0;
  const end = t.indexOf(closer, lead);
  return end === -1 ? t.length : end + 1;
}

// Redirection-target scan (#3080): unlike fileWriteTargets' other shapes, a
// redirection carries no command word — `echo`, `printf`, `cat`, or nothing
// at all can precede it — so this runs over the WHOLE token list regardless
// of t[0], not gated by WRITE_SHAPES. Same fail-closed posture as the rest of
// this module: an unresolvable target ($VAR, backtick, `$(...)` process
// substitution — all caught by resolveWriteTarget's isUnresolvable check)
// resolves to no target, never a guess. `>(...)` process substitution and fd
// duplications (`>&2`, `2>&1`) are not file targets either.
//
// Heredoc bodies (#3989): fileWriteTargets walks forEachShellSegment, so a `>`
// inside a body fed to a known data reader is not a redirection. A body fed to any
// other program is scanned as its own chunk, because that text may run as shell
// (see lineFeedsOnlyDataReaders for the allowlist).
//
// Span-aware scan (#4015, #4210): given `quoting.spanKinds` (the walk handler's third
// argument), the operator is found on the PRE-substitution token and its
// per-character span mask, so a quoted, escaped or `$`-expanded `>` never counts — at
// the token's start (leadingRedirectOpEnd: `echo ">x"` is a word) or glued to a word
// (gluedRedirectOpEnd: `foo>x`, `"hi">x`). The target is read from the
// post-substitution token, so `>$WT/x` still resolves. A prefix that is one balanced
// one-word group (`(ls)>out`, `$(date)>x`, `<(b)>out`) also qualifies; `((i>0))` does
// not. `quoting.nestAt[i]` is the nesting state (advanceNesting) at token i's start,
// carried across tokens and pieces by the walk (visitUnderEach), so a `>` inside
// `"$( … )"` stays quoted even after a token or piece break. Without
// `quoting.spanKinds` the scan is start-anchored on the substituted token only.
//
// A `[[ … ]]` or `(( … ))` segment holds a comparison, not a redirection
// (compoundBodyEnd), so the scan starts after its closing word. The walk keeps an
// arithmetic `((…))` command in one piece (groupEvents), so its `((` reaches here.
function redirectWriteTargets(t, effCwd, quoting) {
  const out = [];
  const kindsOf = quoting && quoting.spanKinds;
  for (let i = compoundBodyEnd(t); i < t.length; i += 1) {
    let rawTarget = null;
    if (!kindsOf) rawTarget = matchRedirectOperator(t[i]);
    else {
      const raw = quoting.raw[i];
      const nest = quoting.nestAt ? quoting.nestAt[i] : NOT_NESTED;
      let opEnd = leadingRedirectOpEnd(raw, kindsOf[i], nest);
      if (opEnd === null) opEnd = gluedRedirectOpEnd(raw, kindsOf[i], nest);
      if (opEnd !== null) {
        // substituteVars rewrites at most one `$` reference per token, so exactly one
        // side of the operator changed: read the target from whichever side survived.
        const head = raw.slice(0, opEnd);
        const tail = raw.slice(opEnd);
        if (t[i] === raw) rawTarget = tail;
        else if (t[i].startsWith(head)) rawTarget = t[i].slice(head.length);
        else if (t[i].endsWith(tail)) rawTarget = tail;
      }
    }
    if (rawTarget === null) continue;
    if (rawTarget === '') {
      i += 1; // consume the target token too — never re-scan it as its own operator
      rawTarget = t[i];
    }
    if (rawTarget === undefined || isFdDupTarget(rawTarget) || rawTarget.startsWith('(')) continue;
    const file = resolveWriteTarget(effCwd, rawTarget);
    if (file) out.push(file);
  }
  return out;
}

// Split a shape's argument list into positionals and the flags seen, given the
// flags that consume the FOLLOWING token as their value. Long `--flag=value`
// forms are self-contained and never consume the next token. `--` ends option
// parsing, as it does for every one of these commands.
function partitionArgs(rest, valueFlags) {
  const positionals = [];
  const flags = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { positionals.push(...rest.slice(i + 1)); break; }
    if (a.startsWith('-') && a !== '-') {
      flags.push(a);
      if (valueFlags.has(a) && i + 1 < rest.length) i += 1;
      continue;
    }
    positionals.push(a);
  }
  return { positionals, flags };
}

// Does this flag list request an in-place edit? Without one, sed and perl only
// read, and a read of the main checkout must stay allowed — so this gate is
// what keeps the shape from denying ordinary inspection commands.
//
// Detection can't just look for a literal `-i`: GNU attaches the backup suffix
// (`-i.bak`), and short flags bundle (`perl -pi -e`, `sed -ni`).
function hasInPlaceFlag(flags) {
  return flags.some((f) => {
    if (f === '--in-place' || f.startsWith('--in-place=')) return true;
    if (f.startsWith('--') || !f.startsWith('-')) return false;
    if (f.startsWith('-I')) return false; // perl's include path — not in-place
    if (f.startsWith('-i')) return true; // -i, -i.bak
    return /^-[A-Za-z]+$/.test(f) && f.includes('i'); // bundled: -pi, -ni
  });
}

// The Bash write shapes this function recognizes. Load-bearing, not
// descriptive: the guard below drops any segment whose command word is absent
// here, so adding a branch without adding its name makes that branch dead
// code. pre-tool-use.js's GATE_COVERAGE re-exports this list, GUARDED_PROGRAM_WORDS.write
// (below) carries it into bash-prefilter.js's PRE_TOOL_USE_WORDS, and
// tests/hooks-gate-coverage.test.js pins it to the prose in
// skills/_shared/policy-schema-coverage.md — so widening this array is what forces the
// documentation to be updated (#138).
const WRITE_SHAPES = Object.freeze(['cp', 'mv', 'tee', 'sed', 'perl', 'install', 'ln', 'truncate', 'dd']);

// Every program word a guard parser in this module keys on, by parser family —
// bash-prefilter.js derives BOTH of its word sets from this, so a parser keyed on
// a new word is reached by adding it here, never by editing a second list (#3092).
//   git:   findGitLead's lead (`git`, or a path ending `/git`, which the prefilter
//          reaches by basename) and the `env` wrapper it walks past —
//          gitTargets, resolvedGitSegments, and teardownTargets (pre-tool-use.js).
//          `env` is superset hygiene, kept for parity with the retired
//          `Bash(env -*)` predicate: every env-wrapped command these parsers
//          resolve also carries `git`, so no test can witness it alone.
//   mkdir: mkdirTargets' command word
//   write: fileWriteTargets' shapes
//   powershell: powershellOpaqueCommand's lead (`powershell`, `pwsh`) — pre-tool-use
//          only (#3061); post-tool-use's POST_TOOL_USE_WORDS stays scoped to the
//          git family, since this gate has nothing to check after the fact.
// tests/hooks-bash-prefilter.test.js's differential corpus runs the real parsers
// and fails when a targeted command's word is missing here — for the commands it
// lists, so a parser keyed on a new word also needs a corpus line there.
const GUARDED_PROGRAM_WORDS = Object.freeze({
  git: Object.freeze(['git', 'env']),
  mkdir: Object.freeze(['mkdir']),
  write: WRITE_SHAPES,
  powershell: Object.freeze([...POWERSHELL_LEADS]),
});

// Per-shape value-consuming flags. Wrong entries here shift which token is read
// as a positional, so each is taken from the command's own documented options
// rather than guessed.
const SED_VALUE_FLAGS = new Set(['-e', '-f', '--expression', '--file', '-l', '--line-length']);
const PERL_VALUE_FLAGS = new Set(['-e', '-E', '-I', '-m', '-M', '-F', '-x']);
const INSTALL_VALUE_FLAGS = new Set(['-m', '--mode', '-o', '--owner', '-g', '--group', '-t', '--target-directory', '-S', '--suffix']);
const LN_VALUE_FLAGS = new Set(['-t', '--target-directory', '-S', '--suffix']);
const TRUNCATE_VALUE_FLAGS = new Set(['-s', '--size', '-r', '--reference', '-o', '--io-blocks']);

// `-t DIR` / `--target-directory[=]DIR` names the destination explicitly, which
// makes EVERY positional a source rather than the last one being the target.
// Shared by cp/mv/install/ln, all of which accept it.
function explicitTargetDir(rest) {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if ((a === '-t' || a === '--target-directory') && i + 1 < rest.length) return rest[i + 1];
    if (a.startsWith('--target-directory=')) return a.slice('--target-directory='.length);
  }
  return null;
}

// sed and perl share a program/file split: with -e/-f supplying the program,
// EVERY positional is a file; without one, the FIRST positional IS the program
// and only the rest are files.
function inPlaceEditTargets(rest, valueFlags, scriptFlags) {
  const { positionals, flags } = partitionArgs(rest, valueFlags);
  if (!hasInPlaceFlag(flags)) return []; // read-only invocation — nothing written
  const programSupplied = flags.some((f) => scriptFlags.some((s) => f === s || f.startsWith(`${s}=`)));
  return programSupplied ? positionals : positionals.slice(1);
}

// A redirection operator at the start of a token, optionally fd- or `&`-prefixed: `>f`, `2>&1`,
// `>>f`, `>|f`, `&>f`, `<in`, `<&3`, `<>f`. A heredoc or here-string (`<<`) and a process
// substitution (`<(…)`, `>(…)`, which is a file argument) do not match.
const REDIRECTION_TOKEN_RE = /^(?:\d+|&)?(?:>>|>\||>&|<>|<&|>|<)(?![<(])/;

// Drops heredoc (`<<EOF`, `<<-EOF`) and here-string (`<<<x`) operator tokens and every
// redirection token (REDIRECTION_TOKEN_RE), each with the word after it when the operator
// stands alone (`<< EOF`, `> /dev/null`), so none is read as a write shape's files; the
// redirection's own target is reported by redirectWriteTargets. A token that begins with a
// quoted span (`'<<'`, `'>f'`) is a literal argument, not an operator, and stays
// (`leadQuoted`, from tokenize).
function dropRedirections(tokens, leadQuoted) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (leadQuoted && leadQuoted[i]) { out.push(tok); continue; }
    if (tok.startsWith('<<')) {
      if (/^<<<?-?$/.test(tok)) i += 1;
      continue;
    }
    const m = REDIRECTION_TOKEN_RE.exec(tok);
    if (!m) { out.push(tok); continue; }
    if (tok.length === m[0].length) i += 1;
  }
  return out;
}

function fileWriteTargets(command, cwd, opts) {
  const targets = [];
  forEachShellSegment(command, cwd, (tokens, effCwd, quoting) => {
    // Redirection has no command word, so it runs for every segment
    // regardless of t[0] — never gated by the WRITE_SHAPES check below (#3080).
    for (const file of redirectWriteTargets(tokens, effCwd, quoting)) targets.push({ action: 'write', file });
    // A heredoc/here-string operator is input and a redirection is reported above, so
    // neither is a file the shape writes.
    const t = dropRedirections(tokens, quoting.leadQuoted);
    if (!WRITE_SHAPES.includes(t[0])) return;
    if (t[0] === 'tee') {
      // tee genuinely writes to EVERY non-flag argument, not just the
      // first — `tee a.txt b.txt` writes both files. .find() silently
      // dropped every destination after the first.
      for (const arg of t.slice(1).filter((a) => !a.startsWith('-'))) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'write', file });
      }
      return;
    }

    if (t[0] === 'cp' || t[0] === 'mv') {
      // `-t DIR` / `--target-directory[=]DIR` names the real destination
      // directory explicitly; every remaining positional argument is a
      // SOURCE, not the destination — the plain "last positional arg is
      // the destination" rule below only applies when neither form is
      // present.
      const rest = t.slice(1);
      const targetDirRaw = explicitTargetDir(rest);
      const nonFlags = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '-t' || a === '--target-directory') { i += 1; continue; }
        if (a.startsWith('-')) continue; // other flags — never a positional
        nonFlags.push(a);
      }
      const action = t[0] === 'cp' ? 'copy' : 'move';
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action, file });
      } else if (nonFlags.length >= 2) {
        const file = resolveWriteTarget(effCwd, nonFlags[nonFlags.length - 1]);
        if (file) targets.push({ action, file });
      }
      return;
    }

    if (t[0] === 'sed' || t[0] === 'perl') {
      // Only an in-place edit writes; a plain `sed -n .. file` is a read and
      // must stay allowed even in the main checkout.
      const isSed = t[0] === 'sed';
      const raw = inPlaceEditTargets(
        t.slice(1),
        isSed ? SED_VALUE_FLAGS : PERL_VALUE_FLAGS,
        isSed ? ['-e', '-f', '--expression', '--file'] : ['-e', '-E'],
      );
      for (const arg of raw) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'edit', file });
      }
      return;
    }

    if (t[0] === 'install') {
      // Same source→dest shape as cp, plus `-d`, under which EVERY positional
      // is a directory being created rather than a source.
      const rest = t.slice(1);
      const { positionals, flags } = partitionArgs(rest, INSTALL_VALUE_FLAGS);
      const targetDirRaw = explicitTargetDir(rest);
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action: 'install', file });
        return;
      }
      const creatingDirs = flags.some((f) => (
        f === '-d' || f === '--directory' || (/^-[A-Za-z]+$/.test(f) && f.includes('d'))
      ));
      // `-d`: every positional is a directory being created. Otherwise the
      // last positional is the destination and needs a source before it.
      let written = [];
      if (creatingDirs) written = positionals;
      else if (positionals.length >= 2) written = positionals.slice(-1);
      for (const arg of written) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'install', file });
      }
      return;
    }

    if (t[0] === 'ln') {
      // The LINK name is what gets created — the last positional. With a single
      // positional the link lands in the cwd under the source's basename.
      const rest = t.slice(1);
      const targetDirRaw = explicitTargetDir(rest);
      const { positionals } = partitionArgs(rest, LN_VALUE_FLAGS);
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action: 'link', file });
        return;
      }
      if (positionals.length >= 2) {
        const file = resolveWriteTarget(effCwd, positionals[positionals.length - 1]);
        if (file) targets.push({ action: 'link', file });
      } else if (positionals.length === 1) {
        const file = resolveWriteTarget(effCwd, path.basename(stripQuotes(positionals[0])));
        if (file) targets.push({ action: 'link', file });
      }
      return;
    }

    if (t[0] === 'truncate') {
      // Every positional is truncated — and truncation CREATES the file when it
      // does not exist, so this writes regardless of `-c`.
      const { positionals } = partitionArgs(t.slice(1), TRUNCATE_VALUE_FLAGS);
      for (const arg of positionals) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'truncate', file });
      }
      return;
    }

    if (t[0] === 'dd') {
      // dd takes keyword arguments, not flags: the destination is `of=`.
      for (const arg of t.slice(1)) {
        const bare = stripQuotes(arg);
        if (!bare.startsWith('of=')) continue;
        const file = resolveWriteTarget(effCwd, bare.slice('of='.length));
        if (file) targets.push({ action: 'write', file });
      }
      return;
    }
  }, opts);
  // forEachShellSegment may visit a segment under two cwds, or a kept body twice (planned and
  // whole), so the same target can come back more than once: report each one once.
  const seen = new Set();
  return targets.filter(({ action, file }) => {
    const key = `${action}\0${file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// mkdir target parser — deliberately separate from WRITE_SHAPES/fileWriteTargets
// (#692): WRITE_SHAPES feeds the worktree-always Bash-write gate's coverage,
// which tests/hooks-gate-coverage.test.js pins to skills/_shared/policy-schema-coverage.md's
// prose; folding mkdir in there would widen that unrelated gate as a side effect.
// The pipeline-shadow guard (pre-tool-use.js) is this function's only consumer.
// mkdir takes no flag that both consumes a value AND could plausibly be confused
// with a positional except -m/--mode; every other positional is a target — mkdir
// can create several directories in one invocation.
const MKDIR_VALUE_FLAGS = new Set(['-m', '--mode']);
function mkdirTargets(command, cwd, opts) {
  const targets = [];
  let pieceStart = 0; // where the current piece's first-cwd visit began pushing
  forEachCommandSegment(command, cwd, (t, effCwd, _quoting, again) => {
    if (!again) pieceStart = targets.length;
    if (t[0] !== 'mkdir') return;
    const { positionals } = partitionArgs(t.slice(1), MKDIR_VALUE_FLAGS);
    for (const arg of positionals) {
      const file = resolveWriteTarget(effCwd, arg);
      // A repeat visit under another cwd (after a brace group) adds an absolute path only once.
      if (file && !(again && targets.slice(pieceStart).some((x) => x.file === file))) targets.push({ action: 'mkdir', file });
    }
  }, opts);
  return targets;
}

module.exports = {
  gitTargets, gitTargetsFrom, resolvedGitSegments, fileWriteTargets, mkdirTargets, splitSegments, tokenize, forEachCommandSegment, skipGlobalFlags, findGitLead, resolveGitCommand, powershellOpaqueCommand, WRITE_SHAPES, GUARDED_PROGRAM_WORDS, redirectWriteTargets, stripHeredocBodies, forEachShellSegment,
  // The heredoc reader vocabularies, pinned against policy-schema-coverage.md's prose (#4149).
  DATA_READER_WORDS, READER_WRAPPER_WORDS, GIT_DATA_SUBCOMMANDS, INERT_NEIGHBOUR_WORDS,
};
