// bin/lib/accept/park-grammar.js
// Pure, requires nothing: the line grammar of the local-acceptance park's three Deploy status
// fields (#4615), shared by park.js and accept-entry.js (whose refresh leaves a parked packet
// alone) so neither requires the other. The target token is packetStateOf's (up to whitespace
// or a comma), so both readers agree on what `target:` says.
'use strict';

const PARK_REASON = 'awaiting-local-acceptance';
const TARGET_LINE_RE = /^target:[ \t]*([^\s,]+)/;
const REASON_LINE_RE = /^reason:[ \t]*(\S+)$/;
const HEAD_LINE_RE = /^park-head:[ \t]*(\S+)$/;

function firstMatch(texts, re) {
  for (const text of texts) {
    const match = re.exec(text);
    if (match) return match[1];
  }
  return null;
}

// texts: the trimmed lines of a Deploy status section.
function parkFieldsOf(texts) {
  const target = firstMatch(texts, TARGET_LINE_RE);
  const reason = firstMatch(texts, REASON_LINE_RE);
  return { parked: target === 'local' && reason === PARK_REASON, target, reason, headSha: firstMatch(texts, HEAD_LINE_RE) };
}

module.exports = { PARK_REASON, TARGET_LINE_RE, REASON_LINE_RE, HEAD_LINE_RE, parkFieldsOf };
