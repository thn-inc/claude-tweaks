'use strict';

// The Origin axis has three states (see skills/_shared/work-record.md):
//   producer    — one of record.js's ORIGINS, carried as a by:* label
//   side-effect — a record created by another skill's flow, carried as an
//                 `Origin: {context}` body line with deliberately no label
//   human       — neither signal; absence IS the signal
//
// This module resolves a record to one of those three, and emits a fourth
// `kind` of its own for the cases it cannot:
//   unstructured — NOT a taxonomy state. This classifier's own artifact for an
//                 Origin line it could not reduce to a class: text still over
//                 MAX_SOURCE_LENGTH after normalization (source
//                 'unstructured'), or text that normalizes to nothing at all
//                 (source 'empty-origin'). Nothing coherent is inside it, so
//                 consumers must never grade it — see trust.js's
//                 UNGRADABLE_KIND.
//
// IMPORTANT: Consumers must key on both `kind` AND `source` together to build
// trust tables (e.g., `kind:source`). The `kind` field disambiguates the
// provenance axis; the `source` field identifies the trust class within that kind.
// Keying on both is also what keeps the classifier's own bucket unforgeable: a
// genuine `Origin: unstructured` body line resolves to `side-effect:unstructured`,
// never to this module's `unstructured:unstructured`.
//
// A `by:*` label needs triage access to apply, but an `Origin:` body line is
// plain text any issue author can type — so only a trusted author's line may
// claim a side-effect class (`authorTrust`, from issueAuthorTrust below); an
// untrusted author's line is ignored and the record resolves human. An
// `unknown` author (no attestation on the payload) fails OPEN to the line, the
// pre-gate behaviour: absent evidence is not evidence of a forger. The
// association is the author's current one, as seen by the fetching token: a
// former collaborator's old records, or a private org member seen through a
// token without org visibility, can read CONTRIBUTOR/NONE, so their `Origin:`
// lines count as untrusted and the record resolves human — the fail-closed
// direction, accepted.
//
// This module reads that axis. It never writes one, and never extends ORIGINS.
//
// The Origin line is the record's OWN line (record-payload.js's ownOriginLine,
// #4502): a line inside a fenced block or under a `## Absorbed: …` heading is
// someone else's text and never counts; one under `## Original request` does.
const { ORIGINS, ownOriginLine } = require('./record.js');
const { TRUSTED_AUTHOR_ASSOCIATIONS, commentAssociation } = require('./comment-trust.js');

const BY_LABEL = /^by:(.+)$/;
// A trailing source reference makes the context per-record unique, which would
// explode the class count and give every cell a sample size of one. This is
// stripped AFTER clause truncation so that trailing punctuation doesn't defeat
// the pattern (e.g., "from #42." still matches).
const TRAILING_SOURCE = /\s+from\s+(#\d+|session recall)$/i;

const MAX_SOURCE_LENGTH = 60;

// Truncate at the first clause boundary (comma or period at bracket depth zero,
// followed by whitespace or end-of-string) to normalize legacy records that
// differ only in trailing details (e.g., "captured 2026-06-14" vs "2026-06-13").
// Must NOT truncate at punctuation inside parentheses or other brackets.
// Stray closing brackets are inert — floor the depth counter at zero so an
// unmatched ')' cannot corrupt the depth state of a subsequent '(...)' pair.
function truncateAtClauseBoundary(source) {
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (ch === ',' || ch === '.')) {
      // Check if followed by whitespace or end-of-string
      const nextChar = i + 1 < source.length ? source[i + 1] : ' ';
      if (nextChar === ' ' || nextChar === '\t' || nextChar === '\n' || i + 1 === source.length) {
        return source.slice(0, i);
      }
    }
  }
  return source;
}

// record: a `gh --json` issue (camelCase `authorAssociation`, `author.is_bot`)
// or a REST issue (`author_association`, `user.type`). Bots are trusted — the
// plugin's own automation files records under a bot identity.
// Returns 'trusted' | 'untrusted' | 'unknown' (no attestation on the payload).
function issueAuthorTrust(record) {
  const r = record && typeof record === 'object' ? record : {};
  if ((r.author && r.author.is_bot === true) || (r.user && r.user.type === 'Bot')) return 'trusted';
  const association = commentAssociation(r);
  if (association === null) return 'unknown';
  return TRUSTED_AUTHOR_ASSOCIATIONS.has(association) ? 'trusted' : 'untrusted';
}

function resolveProvenance({ labels, body, authorTrust } = {}) {
  const names = Array.isArray(labels) ? labels : [];
  for (const name of names) {
    const match = BY_LABEL.exec(name);
    if (match && ORIGINS.includes(match[1])) {
      return { kind: 'producer', source: match[1] };
    }
  }

  // ownOriginLine anchors to line start so prose describing the convention is
  // not mistaken for a provenance claim, and its capture is `.*?`, not `.+?`, so
  // a bare `Origin:` line (returned as '') still enters the branch below and
  // resolves to the ungradable bucket — an empty marker is malformed provenance,
  // not the absent marker (null) that means human-filed.
  const line = authorTrust === 'untrusted' ? null : ownOriginLine(body);
  if (line !== null) {
    // Truncate at clause boundaries first (before stripping trailing source),
    // so that punctuation after "from #N" doesn't prevent the pattern from matching.
    let source = truncateAtClauseBoundary(line).trim();
    // Then strip the trailing source reference.
    source = source.replace(TRAILING_SOURCE, '').trim();
    // Lowercase and check length. If still exceeds MAX_SOURCE_LENGTH, return
    // kind: 'unstructured' to distinguish overflow from structured contexts.
    // A real Origin line always yields kind: 'side-effect', so they cannot collide.
    source = source.toLowerCase();
    if (source.length > MAX_SOURCE_LENGTH) {
      return { kind: 'unstructured', source: 'unstructured' };
    }
    if (source) return { kind: 'side-effect', source };
    // An Origin line that normalizes to nothing ("Origin: .", "Origin:   ") is
    // a malformed provenance marker, not an absent one. Falling through to
    // human:human would merge it into a real trust class — a false merge, the
    // strictly worse direction: a false split only delays one class's verdict,
    // while a merge makes a real class's verdict wrong. Resolve it to the
    // ungradable bucket instead, under its own source so the operator can see
    // which defect produced it.
    return { kind: 'unstructured', source: 'empty-origin' };
  }

  return { kind: 'human', source: 'human' };
}

// True when the body carries an own `Origin:` line by the same ownOriginLine rule
// resolveProvenance reads, so callers that select records for an author-trust
// lookup (author-association.js) select exactly the ones the gate will judge.
function hasOriginLine(body) {
  return ownOriginLine(body) !== null;
}

module.exports = { resolveProvenance, issueAuthorTrust, hasOriginLine, PRODUCERS: ORIGINS };
