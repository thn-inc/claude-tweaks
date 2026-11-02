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
const BARE_VALUE = '[^\\s,;&"\'`)]+';
// Unrolled, so one run of plain characters has one way to match. An unterminated quote
// matches nothing: redacting one word of it would leave the rest looking clean to the screen.
const quoted = (quote) => `${quote}[^${quote}\\\\]*(?:\\\\[\\s\\S][^${quote}\\\\]*)*${quote}`;
const VALUE = `(?:${quoted('"')}|${quoted("'")}|${quoted('`')}|${BARE_VALUE})`;

// Each pattern rule names `value`, and may name the `key` and `close` text kept around it.
// A rule with a `name` group applies only when the credential screen flags that name.
function patternRule(pattern, flags) {
  const re = new RegExp(pattern, flags);
  return (text, render) => text.replace(re, (whole, ...rest) => {
    const { key = '', value, close = '', name } = rest.at(-1);
    if (name !== undefined && findCredentialInText(name) === null) return whole;
    return render(whole, key, value, close);
  });
}

// `name=value`. The value is read only after the name passes, and a name that fails resumes
// right after its separator, so `?next=/cb?token=abc` still reaches `token`. A single regex
// would consume that value with the failing name, and reading it per name would rescan the
// rest of the text once per `a=` in `a=a=a=`.
const ASSIGNMENT_KEY_RE = new RegExp(`${TOKEN_START}([A-Za-z0-9_-]+)["'\`]?\\s*[=:]\\s*`, 'g');
const ASSIGNMENT_VALUE_RE = new RegExp(VALUE, 'y');

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
  patternRule(`(?<![A-Za-z0-9])(?<key>authorization["'\`]?\\s*:\\s*)(?<value>(?:(?:bearer|basic|token)\\s+)?${VALUE})`, 'gi'),
  patternRule('(?<key>://)(?<value>[^\\s/?#]+)(?<close>@)', 'g'),
  // A value never starts with `--`, so `--verbose --api-key abc` does not spend the second flag as the first's value.
  patternRule(`${TOKEN_START}(?<key>(?<name>--[A-Za-z0-9_-]+)(?:=|\\s+))(?!--)(?<value>${VALUE})`, 'g'),
  assignmentRule,
  patternRule(`${TOKEN_START}(?<value>eyJ[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]*)?)`, 'g'),
  // The word goes with the value, unless the value is the JWT the rule above just replaced.
  patternRule(`${TOKEN_START}(?<value>bearer\\s+(?!${escapeRegExp(REDACTED)}(?:\\s|$))\\S+)`, 'gi'),
  patternRule(`${TOKEN_START}(?<value>(?:sk[-_]|ghp_|gho_)${BARE_VALUE})`, 'gi'),
  patternRule('(?<![A-Za-z0-9._%+-])(?<value>[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)', 'g'),
];

function redactText(raw) {
  let count = 0;
  // A later rule sees an earlier rule's placeholder, which is not a second secret.
  const keepKey = (whole, key, value, close) => {
    if (value === REDACTED) return whole;
    count += 1;
    return `${key}${REDACTED}${close}`;
  };
  const removeWhole = () => ' ';

  const text = RULES.reduce((current, rule) => rule(current, keepKey), raw);
  const residual = RULES.reduce((current, rule) => rule(current, removeWhole), raw);
  return { text, count, residual };
}

module.exports = { redactText, REDACTED };
