// bin/lib/console/finding-path.js — the finding-location grammar shared by console/resolve.js (finding keys) and
// log-decision's aggregate-reproduction detector, so the writer and the reader agree on what a location is.
// The path of a finding key `{lens}|{path}:{line}` (#4582): `@ + ~ % $` join the plain class, and `[id]` / `(group)` count only as a
// closed group inside one segment, so a citation wrapped in them (`[src/a.ts:4]`) still keys the bare path. A space, `=` and `,` stay out.
'use strict';

const FINDING_PATH = String.raw`(?:[A-Za-z0-9_./@+~%$-]|\[{1,2}[A-Za-z0-9_.@+~%$-]+\]{1,2}|\([A-Za-z0-9_.@+~%$-]+\))+\.[A-Za-z0-9]+`;

module.exports = { FINDING_PATH };
