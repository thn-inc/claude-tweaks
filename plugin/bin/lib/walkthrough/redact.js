// bin/lib/walkthrough/redact.js — replaces secret-shaped text with a fixed placeholder (#4612).
// Best-effort text defense: it never scans pixels, so a screenshot can still show a secret.
// Its readers go through `redactOrWithhold`, which also screens `residual`: whatever no rule
// removed stays there, so a shape this file misses is that screen's to refuse.
//
// Pure: no git, gh or fs.
'use strict';

const { WITHHELD_TEXT } = require('../wrap-up/packet-contract');
const { findCredentialInText } = require('../wrap-up/packet-links');
const { escapeRegExp } = require('../shared-primitives');

const REDACTED = '[redacted]';

// A match starts only where a token can start. Without this, an unanchored rule restarts
// inside every long token of its own class.
// A literal `\n`, `\r` or `\t` from stringified text also starts a token. A name that absorbs
// the letter (`\ntoken` reads `ntoken`) is screened without it: see `nameIsCredential`.
const AFTER_ESCAPE = '(?<=\\\\[nrt])';
const TOKEN_START = `(?:(?<![A-Za-z0-9_-])|${AFTER_ESCAPE})`;
const OPEN_QUOTE = '["\'`]';
const REST_OF_LINE = '[^\\r\\n]*';
// A `,`, `;` or `)` ends a bare value only before whitespace or the end of the input, so
// `password=pa;ss` goes whole and the comma in `token=abc, next` stays. A quote, escaped or
// not, ends it only before those or another delimiter, so `token=ab"cd` goes whole and
// `f("token=abc")` keeps its closing quote.
const BARE_PLAIN = '[^\\s,;&"\'`)\\\\]';
const BARE_BACKSLASHES = '\\\\+(?!["\'`\\\\])';
const BARE_JOINT = `(?:[,;)](?=\\S)|${BARE_BACKSLASHES}|\\\\*${OPEN_QUOTE}(?=[^\\s,;&)}\\]>]))`;
const BARE_VALUE = `(?:${BARE_PLAIN}+|${BARE_BACKSLASHES}${BARE_PLAIN}*)(?:${BARE_JOINT}${BARE_PLAIN}*)*`;
// Unrolled, so one run of plain characters has one way to match. An unterminated quote
// matches nothing: redacting one word of it would leave the rest looking clean to the screen.
const quoted = (quote) => `${quote}[^${quote}\\\\]*(?:\\\\[\\s\\S][^${quote}\\\\]*)*${quote}`;
// A quote escaped inside a string, as in `{\"token\":\"abc\"}`. After one backslash it closes,
// and a quote after two or more is the value's own, as in `\"ab\\\"cd\"`.
const onceEscapedQuoted = (quote) => `\\\\${quote}[^${quote}]*(?:(?<=\\\\\\\\)${quote}[^${quote}]*)*(?<=(?<!\\\\)\\\\)${quote}`;
// Escaped more than once, as in `{\\\"token\\\":\\\"abc\\\"}`: a quote after two or more closes.
const multiEscapedQuoted = (quote) => `\\\\{2,}${quote}[^${quote}]*(?:(?<!\\\\\\\\)${quote}[^${quote}]*)*(?<=\\\\\\\\)${quote}`;
const QUOTES = ['"', "'", '`'];
const PLAIN_QUOTED = `(?:${QUOTES.map(quoted).join('|')})`;
const ESCAPED_QUOTED = `(?:${[onceEscapedQuoted, multiEscapedQuoted].flatMap((form) => QUOTES.map(form)).join('|')})`;
const QUOTED_VALUE = `(?:${PLAIN_QUOTED}|${ESCAPED_QUOTED})`;
// Text glued to a closing quote is part of the value, as in `"abc"def` or shell's `"ab"'cd'`.
// Closing punctuation is not: `{"token":"abc"}` and `token="abc". next` keep theirs.
const GLUED_QUOTED_VALUE = `(?:${PLAIN_QUOTED}+|${ESCAPED_QUOTED})(?:(?![}\\]>])(?!\\.+(?:\\s|$))${BARE_VALUE})?`;
// Punctuation a placeholder or a JWT may be followed by and still be the whole value.
const CLOSERS = '[\\]})>,;.]*';
// What ends a placeholder or a JWT: whitespace, the end of the input, or a closing quote.
const VALUE_END = `(?:\\s|$|\\\\*${OPEN_QUOTE}(?:[\\s,;&)}\\]>]|$))`;
// A placeholder an earlier rule wrote is a value of its own, so a bare value does not run on
// through `[redacted],"b":2}`. Followed by anything else it is ordinary text.
const PLACEHOLDER_VALUE = `${escapeRegExp(REDACTED)}(?=${CLOSERS}${VALUE_END}|,\\\\*${OPEN_QUOTE}|[}\\]>])`;
// The screen cannot read a key before an escaped quote, so an escaped quote left open cannot be
// left for it: it takes the line.
const VALUE = `(?:${PLACEHOLDER_VALUE}|${GLUED_QUOTED_VALUE}|\\\\+${OPEN_QUOTE}${REST_OF_LINE}|${BARE_VALUE})`;
// A scheme word goes with the value after it. Before an unterminated quote nothing matches, so
// the word is not spent as the value with the credential left behind it. The word and its value
// share a line: `authorization=token` followed by a real newline keeps the next line.
const SCHEME = '(?:bearer|basic|digest|token|negotiate|ntlm|apikey|oauth)[ \\t]+';
const KEYED_VALUE = `(?:${SCHEME}${VALUE}|(?!${SCHEME}${OPEN_QUOTE})${VALUE})`;
// A header's scheme and parameters vary, so its value is the rest of the line. A quoted value
// ends at its quote only where the quote plainly closes it, as in `"Authorization": "x", "y": 1`.
const HEADER_VALUE = `(?:(?:${QUOTED_VALUE}|${escapeRegExp(REDACTED)})(?=\\s*(?:[,;}\\])]|$))|\\S${REST_OF_LINE})`;
// What follows the first character of a separator (`:=`, `==`, `===`, `=>`, `: =`). The lookahead
// keeps a backtrack from spending the separator's own second character as the value.
const SEPARATOR_TAIL = '[=:]*>?(?:\\s+[=:]+>?)*(?![=:])';
const CLOSING_QUOTE = `(?:\\\\*${OPEN_QUOTE})?`;
// The screen flags `authorization` only before a colon, so both forms of the name ask it that.
const AUTHORIZATION_NAME = `(?<name>[A-Za-z0-9_-]*authorization)${CLOSING_QUOTE}\\s*`;
const ADDRESS_DELIMITERS = '\\s,;:"\'`()<>\\[\\]{}@/\\\\=&?#|';
const ADDRESS_CHAR = `[^${ADDRESS_DELIMITERS}]`;
const ADDRESS_HOST_LABEL = `[^${ADDRESS_DELIMITERS}.]+`;
const IS_PLACEHOLDER_RE = new RegExp(`^${escapeRegExp(REDACTED)}${CLOSERS}$`);
const JWT_SEGMENT = '[A-Za-z0-9_-]';
// A JWT of two or three segments and nothing after it, which the JWT rule replaces alone. Any
// other value after `bearer` goes whole, with the word, so no tail survives.
const PLAIN_JWT = `eyJ${JWT_SEGMENT}*\\.${JWT_SEGMENT}+(?:\\.${JWT_SEGMENT}+)?`;
// Spelled out rather than the `i` flag: `eyJ` in the guard must stay as case-sensitive as the
// JWT rule, or the guard would hand `bearer EYJa.b` to a rule that does not take it.
const BEARER = '[Bb][Ee][Aa][Rr][Ee][Rr]';

// Whether the screen flags a name followed by its suffix. A literal `\n`, `\r` or `\t` from
// stringified text puts the escape's letter at the front of the name (`\ntoken` reads `ntoken`), so
// a name behind a backslash is screened again without its first letter.
function nameIsCredential(name, suffix, charBefore) {
  if (findCredentialInText(`${name}${suffix}`) !== null) return true;
  return charBefore === '\\' && /^[nrt]/.test(name) && findCredentialInText(`${name.slice(1)}${suffix}`) !== null;
}

// Each pattern rule names `value`, and may name the `key` and `close` text kept around it.
// A rule with a `name` group applies only when the credential screen flags that name
// followed by `nameSuffix`.
function patternRule(pattern, flags, nameSuffix = '') {
  const re = new RegExp(pattern, flags);
  return (text, render) => text.replace(re, (whole, ...rest) => {
    const { key = '', value, close = '', name } = rest.at(-1);
    // A replace callback ends with (offset, input string, named groups), so the character before
    // the match is `input[offset - 1]`.
    if (name !== undefined && !nameIsCredential(name, nameSuffix, rest.at(-2)[rest.at(-3) - 1])) return whole;
    return render(whole, key, value, close);
  });
}

// `name=value`. The value is read only after the name passes, and a name that fails resumes
// right after its separator, so `?next=/cb?token=abc` still reaches `token`. A single regex
// would consume that value with the failing name, and reading it per name would rescan the
// rest of the text once per `a=` in `a=a=a=`.
const ASSIGNMENT_KEY_RE = new RegExp(`${TOKEN_START}([A-Za-z0-9_-]+)${CLOSING_QUOTE}\\s*[=:]${SEPARATOR_TAIL}\\s*`, 'g');
const ASSIGNMENT_VALUE_RE = new RegExp(KEYED_VALUE, 'iy');

function assignmentRule(text, render) {
  let out = '';
  let copied = 0;
  ASSIGNMENT_KEY_RE.lastIndex = 0;
  for (let match = ASSIGNMENT_KEY_RE.exec(text); match; match = ASSIGNMENT_KEY_RE.exec(text)) {
    if (!nameIsCredential(match[1], '=', text[match.index - 1])) continue;
    ASSIGNMENT_VALUE_RE.lastIndex = ASSIGNMENT_KEY_RE.lastIndex;
    const value = ASSIGNMENT_VALUE_RE.exec(text);
    if (!value) continue;
    const end = ASSIGNMENT_VALUE_RE.lastIndex;
    out += text.slice(copied, match.index) + render(text.slice(match.index, end), match[0], value[0], '');
    copied = end;
    ASSIGNMENT_KEY_RE.lastIndex = end;
  }
  return out + text.slice(copied);
}

// Order matters: a keyed rule runs before the shape rules that would match its value alone,
// so `api_key=sk_live_1` keeps its key and counts once.
const RULES = [
  patternRule(`${TOKEN_START}(?<key>${AUTHORIZATION_NAME}:${SEPARATOR_TAIL}\\s*)(?<value>${HEADER_VALUE})`, 'gi', ':'),
  // After a scheme word the rest of the line goes, as for the header. The screen does not flag
  // this form, so an open quote cannot be left for it: it takes the line too.
  patternRule(`${TOKEN_START}(?<key>${AUTHORIZATION_NAME}=${SEPARATOR_TAIL}\\s*)(?<value>(?:${SCHEME}\\S${REST_OF_LINE}|${VALUE}|${OPEN_QUOTE}${REST_OF_LINE}))`, 'gi', ':'),
  patternRule('(?<key>://)(?<value>[^\\s/?#]+)(?<close>@)', 'g'),
  // A value never starts with `--`, so `--verbose --api-key abc` does not spend the second flag as the first's value.
  patternRule(`${TOKEN_START}(?<key>(?<name>--[A-Za-z0-9_-]+)(?:\\s*[=:]${SEPARATOR_TAIL}\\s*|\\s+))(?!--)(?<value>${KEYED_VALUE})`, 'gi'),
  assignmentRule,
  // Before the JWT rule, so a JWT with a tail goes whole as one replacement. A plain JWT is left
  // to the JWT rule below, and the placeholder guard keeps a second pass from changing anything.
  // Its value ends as any other does, so `"bearer abc", "x"` keeps what surrounds it. The `\S+` is
  // for what no value form takes, such as an unterminated quote.
  patternRule(`${TOKEN_START}(?<value>${BEARER}\\s+(?!(?:${escapeRegExp(REDACTED)}|${PLAIN_JWT})${CLOSERS}${VALUE_END})(?:${VALUE}|\\S+))`, 'g'),
  patternRule(`${TOKEN_START}(?<value>eyJ${JWT_SEGMENT}*(?:\\.${JWT_SEGMENT}+)+)`, 'g'),
  // `_` and `-` count as boundaries, as they do in packet-links.js, so `prefix_sk_live_abc` keeps
  // only `prefix_`. A letter or digit does not, so `task_list` is left alone.
  patternRule(`(?:(?<![A-Za-z0-9])|${AFTER_ESCAPE})(?<value>(?:sk[-_]|gh[pousr]_|github_pat_)${BARE_VALUE})`, 'gi'),
  // A local part may hold an apostrophe but not start with one, so `'bob@x.com'` keeps its quotes.
  patternRule(`(?<!${ADDRESS_CHAR})(?<value>(?=${ADDRESS_CHAR})(?:${ADDRESS_CHAR}|'){1,64}@${ADDRESS_HOST_LABEL}(?:\\.${ADDRESS_HOST_LABEL})*)`, 'g'),
];

function redactText(raw) {
  let count = 0;
  // A later rule sees an earlier rule's placeholder, which is not a second secret.
  const keepKey = (whole, key, value, close) => {
    if (IS_PLACEHOLDER_RE.test(value)) return whole;
    count += 1;
    return `${key}${REDACTED}${close}`;
  };
  // The second pass drops each match for a space, not nothing, so the text either side of it cannot
  // fuse into a credential-shaped token the screen then misreads as a leftover.
  const removeWhole = () => ' ';

  const text = RULES.reduce((current, rule) => rule(current, keepKey), raw);
  const residual = RULES.reduce((current, rule) => rule(current, removeWhole), raw);
  return { text, count, residual };
}

// The text a recording string may carry onward, and how many values went from it. The text keeps
// a shape left for the screen, so the screen reads `residual`, where the placeholders that would
// trip it are gone. A value it flags is withheld whole, and nothing of it counts as replaced.
function redactOrWithhold(raw) {
  const { text, count, residual } = redactText(raw);
  return findCredentialInText(residual) ? { text: WITHHELD_TEXT, count: 0 } : { text, count };
}

module.exports = { redactText, redactOrWithhold, REDACTED };
