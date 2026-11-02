// bin/lib/walkthrough/redact.js — replaces secret-shaped text with a fixed placeholder (#4612).
// Best-effort text defense: it never scans pixels, so a screenshot can still show a secret.
// Its reader is `renderRecordingSection`, which also screens `residual`: whatever no rule
// removed stays there, so a shape this file misses is that screen's to refuse.
//
// Pure: no git, gh or fs.
'use strict';

const { findCredentialInText } = require('../wrap-up/packet-links');
const { escapeRegExp } = require('../shared-primitives');

const REDACTED = '[redacted]';

// A match starts only where a token can start. Without this, an unanchored rule restarts
// inside every long token of its own class.
const TOKEN_START = '(?<![A-Za-z0-9_-])';
// A `,`, `;` or `)` ends a bare value only before whitespace or the end of the input, so
// `password=pa;ss` goes whole and the comma in `token=abc, next` stays.
const BARE_CHARS = '[^\\s,;&"\'`)]';
const BARE_VALUE = `${BARE_CHARS}+(?:[,;)](?=\\S)${BARE_CHARS}*)*`;
// Unrolled, so one run of plain characters has one way to match. An unterminated quote
// matches nothing: redacting one word of it would leave the rest looking clean to the screen.
const quoted = (quote) => `${quote}[^${quote}\\\\]*(?:\\\\[\\s\\S][^${quote}\\\\]*)*${quote}`;
// A quote escaped inside a string, as in `{\"token\":\"abc\"}`. One backslash closes it; a quote
// after two or more is the value's own, as in `\"ab\\\"cd\"`.
const escapedQuoted = (quote) => `\\\\${quote}[^${quote}]*(?:(?<=\\\\\\\\)${quote}[^${quote}]*)*(?<=(?<!\\\\)\\\\)${quote}`;
const QUOTES = ['"', "'", '`'];
const QUOTED_VALUE = `(?:${[...QUOTES.map(quoted), ...QUOTES.map(escapedQuoted)].join('|')})`;
const OPEN_QUOTE = '["\'`]';
const REST_OF_LINE = '[^\\r\\n]*';
// The screen cannot read a key before an escaped quote, so an escaped quote left open cannot be
// left for it: it takes the line.
const VALUE = `(?:${QUOTED_VALUE}|\\\\${OPEN_QUOTE}${REST_OF_LINE}|${BARE_VALUE})`;
// A scheme word goes with the value after it. Before an unterminated quote nothing matches, so
// the word is not spent as the value with the credential left behind it.
const SCHEME = '(?:bearer|basic|digest|token|negotiate)\\s+';
const KEYED_VALUE = `(?:${SCHEME}${VALUE}|(?!${SCHEME}${OPEN_QUOTE})${VALUE})`;
// A header's scheme and parameters vary, so its value is the rest of the line. A quoted value
// ends at its quote only where the quote plainly closes it, as in `"Authorization": "x", "y": 1`.
const HEADER_VALUE = `(?:${QUOTED_VALUE}(?=\\s*(?:[,;}\\])]|$))|\\S${REST_OF_LINE})`;
// What follows the first character of a separator (`:=`, `==`, `===`, `=>`, `: =`). The lookahead
// keeps a backtrack from spending the separator's own second character as the value.
const SEPARATOR_TAIL = '[=:]*>?(?:\\s+[=:]+>?)*(?![=:])';
const CLOSING_QUOTE = `(?:\\\\?${OPEN_QUOTE})?`;
// The screen flags `authorization` only before a colon, so both forms of the name ask it that.
const AUTHORIZATION_NAME = `(?<name>[A-Za-z0-9_-]*authorization)${CLOSING_QUOTE}\\s*`;
const ADDRESS_DELIMITERS = '\\s,;:"\'`()<>\\[\\]{}@/\\\\=&?#|';
const ADDRESS_CHAR = `[^${ADDRESS_DELIMITERS}]`;
const ADDRESS_HOST_LABEL = `[^${ADDRESS_DELIMITERS}.]+`;
const IS_PLACEHOLDER_RE = new RegExp(`^${escapeRegExp(REDACTED)}[\\]})>,;.]*$`);

// Each pattern rule names `value`, and may name the `key` and `close` text kept around it.
// A rule with a `name` group applies only when the credential screen flags that name
// followed by `nameSuffix`.
function patternRule(pattern, flags, nameSuffix = '') {
  const re = new RegExp(pattern, flags);
  return (text, render) => text.replace(re, (whole, ...rest) => {
    const { key = '', value, close = '', name } = rest.at(-1);
    if (name !== undefined && findCredentialInText(`${name}${nameSuffix}`) === null) return whole;
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
    if (findCredentialInText(`${match[1]}=`) === null) continue;
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
  // The screen does not flag this form, so an open quote cannot be left for it: it takes the line.
  patternRule(`${TOKEN_START}(?<key>${AUTHORIZATION_NAME}=${SEPARATOR_TAIL}\\s*)(?<value>(?:${KEYED_VALUE}|(?:${SCHEME})?${OPEN_QUOTE}${REST_OF_LINE}))`, 'gi', ':'),
  patternRule('(?<key>://)(?<value>[^\\s/?#]+)(?<close>@)', 'g'),
  // A value never starts with `--`, so `--verbose --api-key abc` does not spend the second flag as the first's value.
  patternRule(`${TOKEN_START}(?<key>(?<name>--[A-Za-z0-9_-]+)(?:=|\\s+))(?!--)(?<value>${KEYED_VALUE})`, 'gi'),
  assignmentRule,
  patternRule(`${TOKEN_START}(?<value>eyJ[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]*)?)`, 'g'),
  // The word goes with the value, unless the value is the JWT the rule above just replaced.
  patternRule(`${TOKEN_START}(?<value>bearer\\s+(?!${escapeRegExp(REDACTED)}(?![A-Za-z0-9_-]))\\S+)`, 'gi'),
  // `_` and `-` count as boundaries, as they do in packet-links.js, so `prefix_sk_live_abc` keeps
  // only `prefix_`. A letter or digit does not, so `task_list` is left alone.
  patternRule(`(?<![A-Za-z0-9])(?<value>(?:sk[-_]|ghp_|gho_)${BARE_VALUE})`, 'gi'),
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
  const removeWhole = () => ' ';

  const text = RULES.reduce((current, rule) => rule(current, keepKey), raw);
  const residual = RULES.reduce((current, rule) => rule(current, removeWhole), raw);
  return { text, count, residual };
}

module.exports = { redactText, REDACTED };
