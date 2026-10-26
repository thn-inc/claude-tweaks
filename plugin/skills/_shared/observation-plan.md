# Observation Plan — Schema and Authoring Rules

Canonical definition of the `### Observation plan` section of a Verification Brief. The
producer (`skills/wrap-up/verification-brief.md` Step 2) authors one per record at wrap-up
time; `/claude-tweaks:demo` Step 2 executes it show-first; demo's session-recall path
composes one directly from recall. Both cite this file — the schema and per-kind semantics
are stated once, here.

## Schema

```markdown
### Observation plan
- Surface: rendered-page | app-route | cli | flow | diff
- Entry point: {deep link URL/route, or the command to run, or the diff range for `diff`}
- Prepare: {one command per `-` sub-bullet, or `none`}
- Inspect: {one pointer per `-` sub-bullet — what to open/run and what to look for;
  a flow pointer may carry one indented `Regenerate: {command}` continuation line}
- Full verification: {present only on a parent-linked sub-issue}
  - Parent: #P {parent title}
  - Pending: #X {title} (open), #Y {title} (open)
  - Then: {one line — what a human triggers and observes once every sibling ships}
```

## Grammar rules

- One Prepare command per `-` sub-bullet; `Prepare: none` when nothing needs running first.
- One Inspect pointer per `-` sub-bullet.
- `Regenerate:` attaches to its Inspect pointer as an indented continuation line, at most
  one per pointer.
- `Full verification:` is optional. It is present only when the record has a resolvable
  parent, and never on a parentless record. A Parent-Gate parent brief omits the Observation
  plan section entirely, so it never carries this block either.
- `Parent:` names the record's immediate parent only (`#P {parent title}`) — never walks up to
  a grandparent, even when that parent is itself a sub-issue.
- `Pending:` lists every still-open sibling as `#N {title} (open)`, comma-separated, in
  ascending number order, excluding the record in hand. When no sibling is open, `Pending:`
  instead reads `none — every sibling closed; parent gate {incomplete|due|gated|resolved}`, using
  `parentGateState`'s vocabulary (`bin/lib/issues/acceptance.js`) — `incomplete` occurs when the
  record in hand is itself still open even though every other sibling has closed, since
  `parentGateState` is called with the record in hand included in its sub-issue list.
- `Then:` is exactly one line naming the trigger and the observable outcome of the whole
  feature — never a test command. When the parent body carries no design summary to draw a
  trigger from, `Then:` reads `verify "{parent title}" end-to-end once the parent gate opens —
  the parent record carries no design summary to draw a trigger from`.

## Per-kind semantics

- `rendered-page` — Entry point is the changed page's deep link, never the site root.
- `app-route` — Entry point is the affected route; state-seeding commands go in Prepare.
- `cli` — Entry point is the invocation; Prepare is usually `none`; the command's output is
  the outcome to observe.
- `flow` — Entry point is the flow's own invocation or first artifact; Prepare usually
  `none`; one Inspect pointer per verdict-relevant intermediate, ordered by stage.
- `diff` — the floor: Entry point is the diff range; Prepare `none`; Inspect optional.

## Choosing the kind (authoring rules + precedence)

The builder picks the kind by judgment from what the run actually did — not from a path
classifier. Precedence rule: when any changed path is UI, route, or rendered-content code,
`app-route`/`rendered-page` take precedence — choosing `cli`/`flow`/`diff` anyway requires
a one-line justification written into the plan's own text.

## Why not `Blocked-by:`

`Blocked by #N` is already parsed dependency-edge vocabulary (`record-dependencies.js`'s `DEP_RE`,
`_shared/work-record.md`'s Decomposition rules) — the same words inside an Observation plan
would read as a dependency edge rather than a verification pointer. The block is named
`Full verification` instead.

## Producer

Composed only by `/claude-tweaks:demo`'s `#N`-branch composers (`demo/entry-paths.md`'s Full
verification pointer sub-procedure), from live parent/sibling state at demo time — sibling
open/closed state is fresher there than anything wrap-up could have written at build time.
`wrap-up/verification-brief.md` Step 2 never composes this block: its Routing sends every
parent-linked sub-issue to the Parent-Gate Procedure in place of Steps 1-4, and that
procedure omits the Observation plan section entirely.
