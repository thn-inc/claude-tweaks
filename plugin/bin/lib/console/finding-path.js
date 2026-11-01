// bin/lib/console/finding-path.js — the finding-location grammar shared by console/resolve.js (finding keys) and
// log-decision's aggregate-reproduction detector, so the writer and the reader agree on what a location is.
// The path of a finding key `{lens}|{path}:{line}` (#4582): `@ + ~ % $` join the plain class, and `[id]` / `(group)` count only as a
// closed group inside one segment, so a citation wrapped in them (`[src/a.ts:4]`) still keys the bare path. A space, `=` and `,` stay out.
'use strict';

const FINDING_PATH_CLASS = String.raw`A-Za-z0-9_./@+~%$-`; // the plain class, also locationCandidates' boundary test (#4632)
const FINDING_LENS_CLASS = String.raw`A-Za-z0-9_-`; // a lens token, on STAGED and verdict lines alike (#4632)
// One path character or closed group; FINDING_PATH is a run of them ending in `.ext`, so its last unit plus that `.ext`
// is itself a match.
const FINDING_PATH_UNIT = String.raw`(?:[${FINDING_PATH_CLASS}]|\[{1,2}[A-Za-z0-9_.@+~%$-]+\]{1,2}|\([A-Za-z0-9_.@+~%$-]+\))`;
const FINDING_PATH = String.raw`${FINDING_PATH_UNIT}+\.[A-Za-z0-9]+`;

// A finding's lens as a key reads it: a quoted multi-word lens (`lens "3f Test quality"`) keys on its first token, the
// one findingKey yields. Captures the token in group 1 (quoted) or group 2 (bare); an empty `lens ""` names no lens.
const FINDING_LENS = String.raw`lens\s+(?:"([${FINDING_LENS_CLASS}]+)[^"]*"|"?([${FINDING_LENS_CLASS}]+)"?)`;

// The two-finding coincidence clause review step 3 writes (step3-lens-dispatch.md: `lens "L" findings P:A / P:B share
// a location …`), compiled with the `i` flag by both sides (#4581): resolve.js lineKeys keys its second location, and
// the aggregate detector exempts a clause only when FINDING_PATH reads both locations. A location is raw text up to its
// first `:line`, so a path holding a space still reads (#4632), one FINDING_PATH cannot read (`src/a:9`) still matches,
// so lineKeys keeps that line open, and a location never spans a second finding (`a.js:1, b.js:2`), which also keeps the
// scan linear. Groups: 1|2 the lens, 3 the first location, 4 the second through `share a location`.
const COINCIDENCE_LOCATION = String.raw`(?:(?!:\d).)+:\d+`;
const COINCIDENCE = String.raw`\b${FINDING_LENS}\s+findings\s+(${COINCIDENCE_LOCATION})\s+\/\s+(${COINCIDENCE_LOCATION}\s+share a location)`;

module.exports = { FINDING_PATH_CLASS, FINDING_LENS_CLASS, FINDING_PATH_UNIT, FINDING_PATH, FINDING_LENS, COINCIDENCE };
