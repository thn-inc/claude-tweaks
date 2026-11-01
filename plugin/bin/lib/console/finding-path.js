// bin/lib/console/finding-path.js — the finding-location grammar shared by console/resolve.js (finding keys) and
// log-decision's aggregate-reproduction detector, so the writer and the reader agree on what a location is.
// The path of a finding key `{lens}|{path}:{line}` (#4582): `@ + ~ % $` join the plain class, and `[id]` / `(group)` count only as a
// closed group inside one segment, so a citation wrapped in them (`[src/a.ts:4]`) still keys the bare path. A space, `=` and `,` stay out.
'use strict';

const FINDING_PATH = String.raw`(?:[A-Za-z0-9_./@+~%$-]|\[{1,2}[A-Za-z0-9_.@+~%$-]+\]{1,2}|\([A-Za-z0-9_.@+~%$-]+\))+\.[A-Za-z0-9]+`;

// A finding's lens as a key reads it: a quoted multi-word lens (`lens "3f Test quality"`) keys on its first token, the
// one findingKey yields. Captures the token in group 1 (quoted) or group 2 (bare); an empty `lens ""` names no lens.
const FINDING_LENS = String.raw`lens\s+(?:"([A-Za-z0-9_-]+)[^"]*"|"?([A-Za-z0-9_-]+)"?)`;

// The two-finding coincidence clause review step 3 writes (step3-lens-dispatch.md: `lens "L" findings P:A / P:B share
// a location …`), compiled with the `i` flag by both sides (#4581): resolve.js lineKeys keys its second location, and
// the aggregate detector exempts exactly the clauses lineKeys keys. Groups: 1|2 the lens, 3 the second path, 4 its line.
const COINCIDENCE = String.raw`\b${FINDING_LENS}\s+findings\s+${FINDING_PATH}:\d+\s+\/\s+(${FINDING_PATH}):(\d+)\s+share a location`;

module.exports = { FINDING_PATH, FINDING_LENS, COINCIDENCE };
