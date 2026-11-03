// bin/lib/wrap-up/packet-contract.js — the acceptance packet's shared vocabulary
// (#4611): one schema version, the comment markers, fact and claim vocabularies,
// the section order, and the credential keys. Every packet module imports these,
// so a value is stated here once.
//
// Pure: no git, gh or fs.
'use strict';

const SCHEMA_VERSION = 1;
const PACKET_MARKER = `<!-- acceptance-packet: v${SCHEMA_VERSION} -->`;
const PACKET_MARKER_RE = /^<!-- acceptance-packet: v(\d+) -->/;
const LOCAL_START = '<!-- acceptance-packet:start -->';
const LOCAL_END = '<!-- acceptance-packet:end -->';

const FACT_KINDS = Object.freeze([
  'change', 'check', 'story', 'finding', 'link', 'recording', 'flag', 'decision', 'deploy', 'proof',
]);
const FACT_STATUSES = Object.freeze(['passed', 'failed', 'skipped', 'not-run']);
const CLAIM_SECTIONS = Object.freeze([
  'what-changed', 'test-guide', 'tried-to-break', 'least-confident', 'risk-proofs',
]);

// The kinds a claim in each section may cite. risk-proofs also needs at least
// one `flag` and at least one proof fact among its refs; those rules belong to the
// validator. `proof` is the planned-proof kind (#4618): a proof a plan promised for a risk flag,
// carrying its own status, so a risk proof citing only proofs is filed by it, not asserted.
const SECTION_KINDS = Object.freeze({
  'what-changed': Object.freeze(['change']),
  'test-guide': Object.freeze(['story', 'link']),
  'tried-to-break': Object.freeze(['story', 'check']),
  'least-confident': Object.freeze(['finding']),
  'risk-proofs': Object.freeze(['flag', 'check', 'story', 'recording', 'link', 'proof']),
});

// Render order.
const SECTIONS = Object.freeze([
  ['what-changed', 'What changed'],
  ['recording', 'Recording'],
  ['test-guide', 'Test guide'],
  ['couldnt-test', "Couldn't test"],
  ['tried-to-break', 'Tried to break'],
  ['least-confident', 'Least confident'],
  ['risk-proofs', 'Risk proofs'],
  ['decisions', 'Decisions left for you'],
  ['deploy', 'Deploy status'],
].map(([key, heading]) => Object.freeze({ key, heading })));

const MAX_PACKET_CHARS = 60000;

// `Surface:` values whose Test guide lists commands and renders no links.
const COMMANDS_ONLY_SURFACES = Object.freeze(['infra', 'backend']);

const CREDENTIAL_KEYS = Object.freeze([
  'token', 'access_token', 'password', 'passwd', 'secret', 'session', 'sessionid',
  'jwt', 'auth', 'key', 'api_key', 'sig', 'signature', 'x-amz-signature',
]);

const FACT_ID_RE = /^[a-z][a-z-]*:(?:[A-Za-z0-9._\/#:@-]|%[0-9A-F]{2})+$/;
const FACT_KEY_SAFE_CHAR_RE = /^[A-Za-z0-9._\/#:@-]$/;

// Percent-encodes every character outside FACT_ID_RE's literal alphabet, so a
// real path (`+page.svelte`, `[slug]`, a space) can never fail FACT_ID_RE and
// stop the packet at render. Buffer, not encodeURIComponent: that one leaves
// `!~*'()` bare and throws on a lone surrogate.
function encodeFactKey(raw) {
  let encoded = '';
  for (const char of raw) {
    if (FACT_KEY_SAFE_CHAR_RE.test(char)) {
      encoded += char;
      continue;
    }
    for (const byte of Buffer.from(char, 'utf8')) {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return encoded;
}

// The `partial` note gather adds for a named input that will not read: written by
// acceptance-packet.js, and read by the renderer, which tells a lost `--flags` input
// from "no kept risk flags".
const notReadNote = (flag) => `${flag} input not read — treated as absent`;

const VERIFICATION_WORDS = Object.freeze(['tested', 'verified', 'works']);
const VERIFICATION_CLAIM_RE = new RegExp(`\\b(${VERIFICATION_WORDS.join('|')})\\b`, 'i');

module.exports = Object.freeze({
  SCHEMA_VERSION,
  PACKET_MARKER,
  PACKET_MARKER_RE,
  LOCAL_START,
  LOCAL_END,
  FACT_KINDS,
  FACT_STATUSES,
  CLAIM_SECTIONS,
  SECTION_KINDS,
  SECTIONS,
  MAX_PACKET_CHARS,
  COMMANDS_ONLY_SURFACES,
  CREDENTIAL_KEYS,
  FACT_ID_RE,
  encodeFactKey,
  notReadNote,
  VERIFICATION_WORDS,
  VERIFICATION_CLAIM_RE,
});
