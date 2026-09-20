# Record Graph — Live Work-Record Queue Diagram

Used by `/claude-tweaks:visualize record-graph` only. Read from `SKILL.md`'s Step 1
once `<type>` resolves to `record-graph` — this file replaces Step 4 (baseline
authoring) entirely for this type, and supplies the D2 source `d2-enhanced-path.md`'s
Step 1 hands to the `d2` binary for the enhanced path. It does **not** replace
`SKILL.md`'s Steps 2 (token extraction), 5 (wrapper outputs), or 6 (registry update)
— control returns there for each of those, unchanged. No topic is ever resolved for
this type; skip Input's "if `$ARGUMENTS` is empty, ask the user for both" entirely —
`record-graph` alone is a complete invocation.

**Execution order** (this is the one authoritative sequence — nothing else in this
file or `SKILL.md` overrides it): `SKILL.md` Step 1 resolves the type here → `SKILL.md`
Step 2 (theming) runs next, unmodified → this file's Step C runs in place of `SKILL.md`
Step 3 (placement) → this file's Step A (fetch) → this file's Step B (render). On the
enhanced path, Step B's `--out` file becomes `d2-enhanced-path.md`'s own Step 1 input,
so continue through that file's Steps 2-3 (`d2 --layout=elk`, then re-theme — re-theme
is what actually consumes Step 2's extracted tokens, which is why Step 2 has to run
before Step B, not after it) before returning here. Either path then finishes at
`SKILL.md` Step 5 (wrapper outputs) → Step 6 (registry update).

## What the diagram encodes

Every rule below is computed deterministically by `bin/record-graph.js render`
(Step B) from the fetched JSON — none of it is model-authored. It's restated here so
an agent running this type, or a human reading the output, knows what the diagram
means without opening the design doc.

**Stage columns (deterministic — Stage is the spatial axis, not a badge). One column
per row below, left to right, matching `palette.js`'s `COLUMN_ORDER`:**

| Column | Rule |
|---|---|
| Backlog | no `parked`, no `ready` label |
| Parked | has `parked` label |
| Ready | has `ready` label |

Closed records are already excluded by the fetch's `--state open`, so there is no
fourth column, and no filter is layered on top: the full open queue renders every
run. Stage is the seventh axis in `_shared/work-record.md`'s taxonomy — rendering it
as the column layout is why the remaining six are described as the *coloring* axes.

**Six-axis encoding** — the two low-cardinality axes get true color channels; the
four discrete/multi-valued ones get compact text badges, one badge per label line
under the title:

| Axis | Channel | Values |
|---|---|---|
| Origin | Node fill color | `by:code-health` / `by:harness-health` / `by:journey-health` / `by:docs-health` / `by:capture` / `by:dispatch` / none → `human` |
| Bot state | Node border style + color | `bot:in-progress` (solid accent), `bot:blocked` (dashed warning), `bot:parked` (solid amber — merge-verification gate parked it, grants intact), neither (default) |
| Type | Text badge | `[bug]` / `[feature]` / `[task]` — native Issue Type wins over a `type:*` label; an unrecognized type omits the badge rather than guessing |
| Scoring | Text badge | `R:{risk} S:{size}`, with `?` for whichever side is unset; omitted entirely when both are unset |
| Authorization | Text badge | `AUTO-BUILD`, `AUTO-MERGE` — both shown when both are granted, omitted when neither is |
| Acceptance | Text badge | `demo:pending` / `demo:approved` / `demo:changes-requested` — omitted when unset |

Each node's first label line is `#{number} {title, truncated to 40 chars}` — the
`#N` prefix is what makes the dependency edges below readable, so it is never
dropped. Both renderers also emit a **legend** for the two color channels (Origin
fills, Bot-state borders); the four badge axes are self-describing text and need no
legend entry. The literal palette lives in `bin/lib/record-graph/palette.js` — one
source of truth both renderers and the legend generate from, so none of the three can
drift from the others.

**Edges:** one `Blocked by #N` edge per parsed dependency, drawn from the blocked
record *to* the record it depends on, via the existing `parseDependencies`
(`bin/lib/issues/record.js`). Edges are populated only under `work-links: body-text`,
where the record body already rides along in the single fetch pull. Under
`work-links: native`, the diagram still renders fully (columns, colors, badges,
legend) but carries a visible on-diagram note that edges are unavailable — resolving
native sub-issue/blocked-by relations needs a second query, beyond this type's
one-`gh issue list`-pull scope. A dependency on a number outside the open record set
(an already-closed blocker) is dropped rather than drawn to a node that isn't on the
diagram. Parent/sub-issue decomposition hierarchy is a different relationship and is not
drawn at all.

## Step A: Fetch the open record queue

**Backend gate — resolve this before running anything else.** Resolve `work-backend`
per `_shared/record-queue-fetch.md`'s "`work-backend` resolution" section, remembering
that a **missing** flag resolves to `local-files`, not to `github-issues`. If it
resolves to anything other than `github-issues`, **stop this turn completely**: do not
run the fetch, do not run the render, do not write or overwrite any file (including
`docs/diagrams/record-graph.html` or its `.d2` source), do not update `REGISTRY.md`,
and do not substitute a different diagram type. Report to the user:

> `/claude-tweaks:visualize record-graph` currently requires
> `work-backend: github-issues`. This project resolves to `{resolved work-backend
> value}` instead (a missing `work-backend` flag defaults to `local-files`, whose
> records carry `id`/`slug`/`path` and no `.number` — the field every node and edge in
> this diagram is keyed on). Rendering anyway would collapse the whole queue onto one
> node rather than fail cleanly; see the Error handling section of
> `skills/visualize/record-graph.md` for the details.

Then end. This is an unsupported-backend stop, not a permission stop — it is
deliberately *not* an instance of `_shared/local-files-preflight-stop.md`'s six-element
pattern, which governs gates that would otherwise build, claim, or authorize
application work. Nothing here authorizes anything; the backend simply cannot produce
a correct diagram.

Once the gate passes, run `_shared/record-queue-fetch.md`'s existing `github-issues`
fetch procedure exactly as written — its session-scoped snapshot already carries `body`
on the union field set (needed for the `Blocked by #N` parsing above), no
`{EXTRA_FIELDS}` addition required anymore. This produces the same faceted-record JSON
`/help`, `/tidy`, and `/backlog` already consume, sharing the same session snapshot they
do — no new fetch logic, this type is one more consumer of that shared procedure.

Also resolve `work-links` via the canonical read path (`_shared/work-record.md`'s Config
keys table; `_shared/policy-schema.md`):

```bash
WORK_LINKS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links)
```

The resolver applies that table's default when the key is missing, so the captured value is
always concrete.

**Do not rely on a shell variable to carry this value into Step B.** If Step A and
Step B run as genuinely separate shell invocations, an `export` in one has nothing to
guarantee it survives into the other — the same latent property
`record-queue-fetch.md`'s `BACKLOG_FETCH_LIMIT` pattern has, just easier to trip over
here since a bad guess (an unset `native` project silently falling back to
`body-text`) changes what the diagram draws rather than merely capping a fetch. When
running Step B, **substitute the actual resolved value directly** — write the literal
`native` or `body-text` string in place of `--work-links "$WORK_LINKS"`, the way you
would resolve any other piece of already-known information into a command you're
about to run. Step B's snippet still keeps `${WORK_LINKS:-body-text}` as a shell
fallback for the case where a variable *does* happen to be in scope, but the literal
substitution is the reliable path, not the fallback.

## Step B: Render

Resolve `--format` from `SKILL.md` Step 1's already-computed enhanced/baseline
decision: `d2` when enhanced, `svg` when baseline. Then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/record-graph.js" render "{tmp-faceted-file}" \
  --format <d2|svg> \
  --work-links "${WORK_LINKS:-body-text}" \
  --fetch-limit "${BACKLOG_FETCH_LIMIT:-1000}" \
  --out "{destination-path}.{d2|html-fragment-scratch}"
```

Every argument is validated: an unrecognized `--format`/`--work-links`, a
non-numeric `--fetch-limit`, and an unreadable or non-array input file each exit `2`
with a one-line message on stderr rather than a stack trace. Treat a nonzero exit as a
hard stop — do not hand-author a substitute diagram (see this skill's Anti-Patterns).

For the **enhanced** path, `--out` targets the `.d2` source file at the same base
path as the eventual HTML output (matching `d2-enhanced-path.md` Step 1's existing
convention) — then continue at `d2-enhanced-path.md` Step 2 (`d2 --layout=elk`) and
Step 3 (re-theme) exactly as written for every other enhanced type. Step 3 consumes
`SKILL.md` Step 2's extracted tokens, which is why Step 2 still runs for this type.
That step's "map each distinct hex to the nearest project token, by role — use
judgment, there's no universal 1:1 mapping" guidance applies here too: this type's
six-value Origin fill palette will commonly map several origins onto the same nearest
token on a project with fewer than six accent-ish colors in `DESIGN.md` — an accepted,
inherited limitation of the existing generic mechanism, not something this type
works around.

For the **baseline** path, the render call's `svg` output IS the core fragment
`SKILL.md` Step 4 would otherwise author by hand — skip Step 4's own instructions
entirely for this type and pass this output straight to `SKILL.md` Step 5, which
applies `visual-html-output.md` Step 4's wrapper adapters as usual. Note that this
baseline fragment is the one `/visualize` output that is **not** themed from the
project's own `DESIGN.md` tokens: it carries `palette.js`'s small fixed categorical
palette (in its own scoped `<style>` block, following `visual-html-output.md` Step 3's
shape) because the Origin axis needs six-plus mutually distinguishable hues, which a
typical `DESIGN.md` token set doesn't supply. That's a known, accepted tradeoff for
this type given its categorical palette, not an oversight.

## Step C: Placement (overrides SKILL.md Step 3's table for this type only)

`record-graph` always resolves to `docs/diagrams/record-graph.html` (+ `.d2` source
alongside it on the enhanced path) — regardless of whether this was a direct
invocation, `--source`, or `--ephemeral` was passed. Skip Step 3's persist-vs-
ephemeral `AskUserQuestion` entirely for this type: always persisted, always
overwritten and committed on every run. This is a deliberate override of the
general persist-vs-ephemeral rule — a live-state snapshot that isn't saved defeats
the point of a "living dashboard" file you regenerate on demand.

`SKILL.md` Step 5 (wrapper outputs) and Step 6 (registry update) then both run
unchanged — Step 5 is what actually writes the standalone HTML file at the path
above, and this path matches the existing `docs/diagrams/{slug}.html` fallback
convention exactly, so Step 6 needs no new registry logic here either.

## Error handling

- **Zero open records** — `bin/record-graph.js` still renders a valid 3-column
  empty diagram (no special-casing needed; `buildGraph([], ...)` returns empty
  column arrays and `renderD2`/`renderSvg` handle empty containers/groups
  correctly). The legend and the "Generated {timestamp}" line still render; the
  empty columns communicate "no open work records" on their own.
- **Truncated fetch** — `--fetch-limit` is always passed from
  `backlog-fetch-limit` (resolver-applied default when unset); when the fetched count equals it,
  `bin/record-graph.js` renders the on-diagram truncation note itself — no separate
  handling needed here beyond passing the flag through.
- **`work-backend: local-files`** — NOT currently supported; Step A's backend gate
  stops before the fetch. `bin/lib/record-graph/`'s modules (`layout.js`, `encode.js`,
  `edges.js`, `render-d2.js`, `render-svg.js`) key exclusively on a GitHub issue's
  `.number` field; `bin/lib/issues/local-store.js`'s records carry `id`/`slug`/`path`
  instead, never `number`. Under `local-files`, every record would collapse onto a
  single node — a real defect, not a hedge. This repo's own config is
  `work-backend: github-issues`, and issue #28 never asked for `local-files` support,
  so this is an accepted, explicit scope boundary rather than an oversight to fix
  here. Proper `local-files` support (a driver-agnostic node identifier) is out of
  scope for this plan and would need its own follow-up.
