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

// Longest first, so `x-amz-signature=1` reports its own key, not `signature`.
const CREDENTIAL_TEXT_SHAPES = [...CREDENTIAL_KEYS]
  .sort((a, b) => b.length - a.length)
  .map((key) => {
    const escaped = escapeRegExp(key);
    return {
      key,
      flag: new RegExp(`(^|[^a-z0-9_])--${escaped}(?=$|[\\s=])`),
      assignment: new RegExp(`(^|[^a-z0-9_])${escaped}\\s*[=:]`),
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

function allowedHostname(entry) {
  try {
    return new URL(entry).hostname;
  } catch {
    return entry.toLowerCase();
  }
}

function checkLink(url, { allowedHosts = [] } = {}) {
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
  for (const rawKey of parsed.searchParams.keys()) {
    const key = normalizeKey(rawKey);
    if (CREDENTIAL_KEY_SET.has(key)) {
      return { ok: false, reason: `credential key in query: ${key}` };
    }
  }
  // Decoded before splitting, and split on `?` as well as `&`: a hash-router URL
  // carries its own query in the fragment (`#/cb?token=abc`, `#/cb%3Ftoken=abc`).
  for (const part of normalizeKey(parsed.hash.slice(1)).split(/[?&]/)) {
    const key = part.split('=', 1)[0];
    if (CREDENTIAL_KEY_SET.has(key)) {
      return { ok: false, reason: `credential key in fragment: ${key}` };
    }
  }
  return { ok: true };
}

function findCredentialInText(text) {
  const normalized = normalizeKey(text);
  if (/authorization\s*:/.test(normalized)) return 'authorization';
  for (const { key, flag, assignment } of CREDENTIAL_TEXT_SHAPES) {
    if (flag.test(normalized) || assignment.test(normalized)) return key;
  }
  return null;
}

module.exports = {
  normalizeKey,
  checkLink,
  findCredentialInText,
};
