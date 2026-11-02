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

// Keys compare with `-` and `_` removed from both sides, so `session_id` is
// `sessionid` and `--api-key` is `apikey` is `api_key`. Reports use the constant's spelling.
const stripSeparators = (key) => key.replace(/[-_]/g, '');
// Longest first: an all-caps word splits at the longest key it ends with.
const STRIPPED_KEYS_LONGEST_FIRST = CREDENTIAL_KEYS.map(stripSeparators).sort((a, b) => b.length - a.length);

// `_` and `-` count as boundaries, so `GITHUB_TOKEN=` and `--client-secret` match.
// A miss posts a secret publicly; a false positive only drops one entry visibly.
const LEFT_BOUNDARY = '(?:^|[^a-z0-9])';
const CLOSING_QUOTE = '["\'`]?';
const AUTHORIZATION_HEADER_RE = new RegExp(`${LEFT_BOUNDARY}authorization${CLOSING_QUOTE}\\s*:`);
const URL_USERINFO_RE = /:\/\/[^\s/?#]+@/;
const LEFTOVER_ESCAPE_RE = /%[0-9a-f]{2}/gi;
const BRACKET_GROUP_RE = /\[[^[\]]*\]/g;
const UPPER_RUN_RE = /[A-Z]{3,}/g;

// Longest first, so `x-amz-signature=1` reports its own key, not `signature`.
const CREDENTIAL_SHAPES = [...CREDENTIAL_KEYS]
  .sort((a, b) => b.length - a.length)
  .map((key) => {
    const spelled = `${[...stripSeparators(key)].map(escapeRegExp).join('[-_]*')}[-_]*`;
    return {
      key,
      flag: new RegExp(`${LEFT_BOUNDARY}--(?:[a-z0-9]+[-_])*${spelled}(?=$|[\\s=])`),
      assignment: new RegExp(`${LEFT_BOUNDARY}${spelled}${CLOSING_QUOTE}\\s*[=:]`),
      nestedAssignment: new RegExp(`${LEFT_BOUNDARY}${spelled}\\s*=`),
      // A whole key (a bare query key or fragment part), alone or as a compound's last word.
      bare: new RegExp(`(?:^|[-_])${spelled}$`),
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
function decodeText(raw) {
  let value = String(raw);
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    const decoded = value.replace(ESCAPE_RUN_RE, decodeEscapeRun);
    if (decoded === value) break;
    value = decoded;
  }
  return value;
}

function normalizeKey(raw) {
  return decodeText(raw).toLowerCase();
}

// An all-caps word ending in a key splits before it (`CLIENTSECRET` is `CLIENT_SECRET`),
// unless the word is the key itself. Lowercase concatenations (`monkey`) are left alone.
function splitUpperRun(run) {
  const lower = run.toLowerCase();
  const suffix = STRIPPED_KEYS_LONGEST_FIRST.find((key) => lower.length > key.length && lower.endsWith(key));
  return suffix ? `${run.slice(0, -suffix.length)}_${run.slice(-suffix.length)}` : run;
}

// Marks the word boundaries a lowercased string would lose, before lowercasing: a
// camelCase or letter/digit change becomes `_`, so `authToken` reads `auth_token`
// and `v2token` reads `v2_token`. Every pattern here is a single character.
function markWordBoundaries(text) {
  return text
    .replace(UPPER_RUN_RE, splitUpperRun)
    .replace(/[a-z](?=[A-Z])/g, '$&_')
    .replace(/[A-Z](?=[A-Z][a-z])/g, '$&_')
    .replace(/[A-Za-z](?=[0-9])/g, '$&_')
    .replace(/[0-9](?=[A-Za-z])/g, '$&_');
}

// Normalized text for the shape regexes. An escape left after decoding (an invalid
// byte) becomes a space, so `%FF%74oken=` still has a boundary before the key.
function screenText(raw) {
  const decoded = decodeText(raw).replace(LEFTOVER_ESCAPE_RE, ' ');
  return markWordBoundaries(decoded).toLowerCase();
}

// The screens the key shapes run over. A bracket opens a new word (`user[password]=`
// reads `user_password=`, `token[]=` reads `token_=`), and a whole bracket group may
// also sit between a key and its `=` (`token[sub]=`), so that group is dropped.
function keyScreens(screened) {
  return [
    screened.replace(/\[/g, '_').replace(/\]/g, ''),
    screened.replace(BRACKET_GROUP_RE, ' '),
  ];
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

function bareKey(rawKey) {
  const screens = keyScreens(screenText(rawKey)).map((screen) => screen.trim());
  const shape = CREDENTIAL_SHAPES.find(({ bare }) => screens.some((screen) => bare.test(screen)));
  return shape ? shape.key : null;
}

// The first credential key among the exact keys (decoded, case kept: `authToken`),
// else a nested `{key}=` anywhere in the text: `?next=/cb?token=abc`,
// `?a=1;token=abc`, `#/cb/token=abc`.
function refusedKey(exactKeys, text) {
  const exact = exactKeys.map(bareKey).find(Boolean);
  if (exact) return exact;
  const screens = keyScreens(screenText(text));
  const nested = CREDENTIAL_SHAPES.find(({ nestedAssignment }) => screens.some((screen) => nestedAssignment.test(screen)));
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
  // `+` is a space in a query, so `?token+=abc` is the key `token`. Replaced before
  // decoding: an encoded `%2B` is a literal plus.
  const query = parsed.search.slice(1).replace(/\+/g, ' ');
  const queryKey = refusedKey([...parsed.searchParams.keys()], query);
  if (queryKey) return { ok: false, reason: `credential key in query: ${queryKey}` };
  // Decoded before splitting, and split on `?` as well as `&`: a hash-router URL
  // carries its own query in the fragment (`#/cb?token=abc`, `#/cb%3Ftoken=abc`).
  const fragment = parsed.hash.slice(1);
  const fragmentKeys = decodeText(fragment).split(/[?&]/).map((part) => part.split('=', 1)[0]);
  const fragmentKey = refusedKey(fragmentKeys, fragment);
  if (fragmentKey) return { ok: false, reason: `credential key in fragment: ${fragmentKey}` };
  return { ok: true };
}

function findCredentialInText(text) {
  const screened = screenText(text);
  if (AUTHORIZATION_HEADER_RE.test(screened)) return 'authorization';
  // Raw as well as decoded: decoding `%2F` in a password would end the userinfo early.
  if (URL_USERINFO_RE.test(String(text)) || URL_USERINFO_RE.test(screened)) return 'password';
  const screens = keyScreens(screened);
  for (const { key, flag, assignment } of CREDENTIAL_SHAPES) {
    if (screens.some((screen) => flag.test(screen) || assignment.test(screen))) return key;
  }
  return null;
}

module.exports = {
  normalizeKey,
  checkLink,
  findCredentialInText,
};
