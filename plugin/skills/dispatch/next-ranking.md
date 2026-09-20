# Dispatch Step 3 — The `next` Ranking Script

Referenced by `skills/dispatch/SKILL.md` Step 3 — reused by the bare drain's per-iteration loop
and its deprecated `next` alias (`--budget 1`, one iteration). Run this verbatim — it picks
exactly one group from `dispatch-groups.json` (`queue-pull-script.md`'s output) by priority band
(high > medium > low > unprioritized), oldest-first within a band, using each group's
highest-priority (then oldest) member as its representative. Also reads this run's session-scoped
`dispatch-exclusions.json` (#1752, `bin/lib/dispatch/exclusions.js`'s `readExclusions`) and
excludes any group with a member matching a `reason: 'oversized'` entry's `records` — a headless
firing has nobody present to see the Oversized-group report's surfaced line, so the bare drain
(and its `next` alias) is the form that must not auto-select an oversized group at all (#1228).
Writes the picked group (or `null`, when no candidate remains) to `dispatch-next-pick.json`.

**Also filters on `reason: 'firing'` entries in the same `dispatch-exclusions.json`** — every
record this same bare-drain firing already dispatched to a terminal outcome short of
`build-test-ok` (SKILL.md's Loop step appends one such entry per excluded number via
`appendExclusion`; see the false assumption that mechanism's introduction corrects,
`firing-exclusion.md`). Absent or unreadable is treated as `[]`, never an error — the file may not
exist yet on a firing's first iteration, and `next`'s single-iteration alias never needs it at all.
A group with any member excluded under `reason: 'firing'` is excluded from the candidate pool for
the rest of the firing, exactly like an oversized group — the record's labels alone (`auto:build`
present, no `bot:blocked`) do not change on a claim-contest/in-flight stop or a pre-retry-ceiling
build/test failure, so without this the same firing's very next iteration re-selects the identical
group and reproduces the identical stop. Both reasons are checked together, via one
`groupIsExcluded(g, entries, ['oversized', 'firing'])` call — no separate key derivation for each.

```bash
eval "$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  const os = require('os'); const path = require('path');
  const files = { DISPATCH_GROUPS: 'dispatch-groups.json', DISPATCH_EXCLUSIONS: 'dispatch-exclusions.json', DISPATCH_NEXT_PICK: 'dispatch-next-pick.json' };
  for (const [varName, filename] of Object.entries(files)) {
    const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
    console.log(varName + '=' + JSON.stringify(p));
  }
")"
node -e "
  const { readExclusions, groupIsExcluded } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const RANK = { high: 0, medium: 1, low: 2 };
  const bandOf = (r) => (r.facets.priority ? RANK[r.facets.priority] : 3);
  const groups = require(process.argv[2]);
  // Size guard (#1228) + this-firing exclusion guard: one derivation, no
  // separate key-set for each -- see queue-pull-script.md for how 'oversized'
  // entries are produced and firing-exclusion.md for how 'firing' entries
  // are appended between successive re-runs of this same firing. Absent or
  // unreadable dispatch-exclusions.json reads as [] (readExclusions' own
  // contract), never an error -- it may not exist yet on a firing's first
  // iteration, and 'next''s single-iteration alias never needs the firing
  // reason at all.
  const entries = readExclusions(process.argv[3]);
  const eligibleGroups = groups.filter((g) => !groupIsExcluded(g, entries, ['oversized', 'firing']));
  const representative = (g) => g.slice().sort((a, b) =>
    bandOf(a) - bandOf(b) || new Date(a.createdAt) - new Date(b.createdAt))[0];
  const priorityFilter = process.argv[1] || null; // '--priority' value, or unset
  let candidates = eligibleGroups.map((g) => ({ group: g, rep: representative(g) }));
  if (priorityFilter) candidates = candidates.filter((c) => c.rep.facets.priority === priorityFilter);
  const ranked = candidates
    .sort((x, y) => bandOf(x.rep) - bandOf(y.rep) || new Date(x.rep.createdAt) - new Date(y.rep.createdAt));
  console.log(JSON.stringify(ranked.length ? ranked[0].group : null));
" "$PRIORITY_FILTER" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" > "$DISPATCH_NEXT_PICK"
```

A `null` result (no eligible groups, none matching `--priority`, every remaining group was
oversized, or every remaining group was already attempted this firing) is the zero-eligible-groups
case documented at the top of Step 3 — report nothing eligible and stop, do not proceed to Step 4.
