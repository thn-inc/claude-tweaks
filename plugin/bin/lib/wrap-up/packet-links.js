// bin/lib/wrap-up/packet-links.js — which links and text the acceptance packet may
// carry (#4611): a link must be http(s), on an allowed host, and free of credential
// keys; a command or Test-guide claim must not show a credential shape.
//
// Pure: no git, gh or fs.
'use strict';

const { CREDENTIAL_KEYS } = require('./packet-contract');
const { escapeRegExp } = require('../shared-primitives');

const MAX_DECODE_ROUNDS = 3;
const ESCAPE_RUN_RE = /(?:%[0-9A-Fa-f]{2})+/g;
const ESCAPE_CHARS = 3;
const MAX_UTF8_BYTES = 4;
const CREDENTIAL_KEY_SET = new Set(CREDENTIAL_KEYS);

// `_` and `-` count as boundaries, so `GITHUB_TOKEN=` and `--client-secret` match.
// A miss posts a secret publicly; a false positive only drops one entry visibly.
const LEFT_BOUNDARY = '(?:^|[^a-z0-9])';
const CLOSING_QUOTE = '["\'`]?';
const AUTHORIZATION_HEADER_RE = new RegExp(`${LEFT_BOUNDARY}authorization${CLOSING_QUOTE}\\s*:`);
const URL_USERINFO_RE = /:\/\/[^\s/?#]+@/;
const LEFTOVER_ESCAPE_RE = /%[0-9a-f]{2}/g;

// Longest first, so `x-amz-signature=1` reports its own key, not `signature`.
// `-` and `_` are interchangeable inside a key: `--api-key` is `api_key`.
const CREDENTIAL_SHAPES = [...CREDENTIAL_KEYS]
  .sort((a, b) => b.length - a.length)
  .map((key) => {
    const spelled = key.split(/[-_]/).map(escapeRegExp).join('[-_]');
    return {
      key,
      flag: new RegExp(`${LEFT_BOUNDARY}--(?:[a-z0-9]+[-_])*${spelled}(?=$|[\\s=])`),
      assignment: new RegExp(`${LEFT_BOUNDARY}${spelled}${CLOSING_QUOTE}\\s*[=:]`),
      nestedAssignment: new RegExp(`${LEFT_BOUNDARY}${spelled}\\s*=`),
    };
  });

function tryDecode(escapes) {
  try {
    return decodeURIComponent(escapes);
  } catch {
    return null;
  }
}

// Decodes a run of %HH escapes one UTF-8 sequence at a time, longest first, so
// an invalid byte stays literal without taking its valid neighbours with it.
function decodeEscapeRun(run) {
  let out = '';
  let at = 0;
  while (at < run.length) {
    let width = ESCAPE_CHARS;
    let piece = run.slice(at, at + ESCAPE_CHARS);
    for (let bytes = MAX_UTF8_BYTES; bytes >= 1; bytes -= 1) {
      const decoded = tryDecode(run.slice(at, at + bytes * ESCAPE_CHARS));
      if (decoded !== null) {
        width = bytes * ESCAPE_CHARS;
        piece = decoded;
        break;
      }
    }
    out += piece;
    at += width;
  }
  return out;
}

// Whole-string decodeURIComponent is not enough here: one stray `%` makes it throw,
// which would hide every encoded key in the same text from the credential screens.
function normalizeKey(raw) {
  let value = String(raw);
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    const decoded = value.replace(ESCAPE_RUN_RE, decodeEscapeRun);
    if (decoded === value) break;
    value = decoded;
  }
  return value.toLowerCase();
}

// Normalized text for the shape regexes. An escape left after decoding (an invalid
// byte) becomes a space, so `%FF%74oken=` still has a boundary before the key.
function screenText(raw) {
  return normalizeKey(raw).replace(LEFTOVER_ESCAPE_RE, ' ');
}

// An entry is a base URL or a bare host, port and IPv6 included. `new URL` alone
// reads `localhost:3000` as scheme `localhost:` and rejects `::1`, so a schemeless
// entry parses as http. An unparseable entry matches no host.
function allowedHostname(entry) {
  const isBareIpv6 = !entry.includes('[') && entry.split(':').length > 2;
  const hostPart = isBareIpv6 ? `[${entry}]` : entry;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? entry : `http://${hostPart}`;
  try {
    return new URL(candidate).hostname;
  } catch {
    return null;
  }
}

// The first credential key among the exact keys, else a nested `{key}=` anywhere
// in the text: `?next=/cb?token=abc`, `?a=1;token=abc`, `#/cb/token=abc`.
function refusedKey(exactKeys, text) {
  const exact = exactKeys.find((key) => CREDENTIAL_KEY_SET.has(key));
  if (exact) return exact;
  const screened = screenText(text);
  const nested = CREDENTIAL_SHAPES.find(({ nestedAssignment }) => nestedAssignment.test(screened));
  return nested ? nested.key : null;
}

function checkLink(url, options) {
  const allowedHosts = Array.isArray(options?.allowedHosts) ? options.allowedHosts : [];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'unparseable url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'scheme not http(s)' };
  }
  const hostname = parsed.hostname.toLowerCase();
  const hosts = allowedHosts.filter((entry) => typeof entry === 'string').map(allowedHostname);
  if (!hosts.includes(hostname)) {
    return { ok: false, reason: `host not allowed: ${hostname}` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credential in userinfo' };
  }
  const query = parsed.search.slice(1);
  const queryKey = refusedKey([...parsed.searchParams.keys()].map(normalizeKey), query);
  if (queryKey) return { ok: false, reason: `credential key in query: ${queryKey}` };
  // Decoded before splitting, and split on `?` as well as `&`: a hash-router URL
  // carries its own query in the fragment (`#/cb?token=abc`, `#/cb%3Ftoken=abc`).
  const fragment = parsed.hash.slice(1);
  const fragmentKeys = normalizeKey(fragment).split(/[?&]/).map((part) => part.split('=', 1)[0]);
  const fragmentKey = refusedKey(fragmentKeys, fragment);
  if (fragmentKey) return { ok: false, reason: `credential key in fragment: ${fragmentKey}` };
  return { ok: true };
}

function findCredentialInText(text) {
  const screened = screenText(text);
  if (AUTHORIZATION_HEADER_RE.test(screened)) return 'authorization';
  // Raw as well as decoded: decoding `%2F` in a password would end the userinfo early.
  if (URL_USERINFO_RE.test(String(text)) || URL_USERINFO_RE.test(screened)) return 'password';
  for (const { key, flag, assignment } of CREDENTIAL_SHAPES) {
    if (flag.test(screened) || assignment.test(screened)) return key;
  }
  return null;
}

module.exports = {
  normalizeKey,
  checkLink,
  findCredentialInText,
};
