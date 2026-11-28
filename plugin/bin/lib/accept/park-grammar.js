// bin/lib/accept/park-grammar.js
// Pure, requires nothing: the line grammar of the local-acceptance park's four Deploy status
// fields (#4615), shared by park.js and accept-entry.js (whose refresh leaves a parked packet
// alone) so neither requires the other. TARGET_RE is defined once, here: packetStateOf and
// parkFieldsOf both take its first match over the section text, so they agree on which
// `target:` counts, mid-line ones included.
'use strict';

const PARK_REASON = 'awaiting-local-acceptance';
const TARGET_RE = /(?:^|\s)target:[ \t]*([^\s,]+)/;
const REASON_LINE_RE = /^reason:[ \t]*(\S+)$/;
const HEAD_LINE_RE = /^park-head:[ \t]*(\S+)$/;
const BASE_LINE_RE = /^park-base:[ \t]*(\S+)$/;

function firstMatch(texts, re) {
  for (const text of texts) {
    const match = re.exec(text);
    if (match) return match[1];
  }
  return null;
}

// texts: the trimmed lines of a Deploy status section.
function parkFieldsOf(texts) {
  const target = TARGET_RE.exec(texts.join('\n'))?.[1] ?? null;
  const reason = firstMatch(texts, REASON_LINE_RE);
  return {
    parked: target === 'local' && reason === PARK_REASON, target, reason,
    headSha: firstMatch(texts, HEAD_LINE_RE), baseSha: firstMatch(texts, BASE_LINE_RE),
  };
}

module.exports = { PARK_REASON, TARGET_RE, REASON_LINE_RE, HEAD_LINE_RE, BASE_LINE_RE, parkFieldsOf };
