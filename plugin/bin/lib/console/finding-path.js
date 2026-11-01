// The path of a finding key `{lens}|{path}:{line}` (#4582): `@ + ~ % $` join the plain class, and `[id]` / `(group)` count only as a
// closed group inside one segment, so a citation wrapped in them (`[src/a.ts:4]`) still keys the bare path. A space, `=` and `,` stay out.
const FINDING_PATH = String.raw`(?:[A-Za-z0-9_./@+~%$-]|\[{1,2}[A-Za-z0-9_.@+~%$-]+\]{1,2}|\([A-Za-z0-9_.@+~%$-]+\))+\.[A-Za-z0-9]+`;

module.exports = { FINDING_PATH };
