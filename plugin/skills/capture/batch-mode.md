# Capture — Batch Mode (`--batch <path>`)

Loaded by `/claude-tweaks:capture` when `--batch <path>` is supplied — see `SKILL.md`'s Input table. Files multiple entries in one invocation, each through the same per-entry pipeline `SKILL.md`'s Workflow Step 1 already runs for a single idea, with one routing/confirmation pass and one summary table for the whole set rather than N separate invocations.

## The entry file

`<path>` is a JSON file containing an array of entry objects:

```json
[
  { "title": "...", "body": "...", "type": "bug" },
  { "title": "...", "body": "..." }
]
```

`body` follows the same shape as any other invocation's body — either Entry Format's `**Related:**`/`Context:`/`Scope:` stub prose, or a spec-shaped body (`## Current State`/`## Deliverables`/`## Acceptance Criteria`), per entry. `type` is optional per entry — an entry that omits it falls through to Guessing the Type exactly as a single invocation would. Every other per-invocation flag (`--route=`, `--needs-definition`, `--risk=`/`--size=`, `--origin=`, `--defer-reason=`) applies uniformly across the batch unless an individual entry object supplies its own same-named field, which wins for that entry only.

Read the file once and validate it parses as a JSON array of objects each carrying at least `title` and `body`. A parse failure or a malformed entry stops the whole batch before filing anything — fail before the first side effect, not partway through.

## Per-entry loop

For each entry, in file order, run exactly the same per-item pipeline `SKILL.md`'s Workflow Step 1 already runs for a single invocation: Guessing the Type (or the entry's own `type`), Judging Definition, the Hard cap / Shaped-body branch split (including its character-budget check and the dense-capture exception), the trust-based born-ready chain when its own conditions hold, then Backend Selection's filing step — one call per entry, on whichever driver the project configures. Nothing about the per-entry mechanics changes from a single invocation; batch mode only changes how many times Step 1 runs and how the results are reported.

**Per-call fail-safe batching.** A single entry's filing failure (a `gh issue create` transient error, a malformed individual body) does not abort the batch — catch it, record the failure against that entry, and continue to the next. Report every entry's outcome at the end (Batch Summary below), not just the first failure. The open-PR overlap screen (`SKILL.md`'s filing step, #3191) rides the same per-entry pipeline, so it runs `gh pr list` once per entry; a rate-limited call fails open — the screen is skipped for that entry, never a filing failure.

**Over-cap entries.** An entry whose stub content exceeds the Hard cap's character budget (`SKILL.md`'s Hard cap section) cannot be interactively redirected to `/superpowers:brainstorming` mid-batch — there is no per-entry pause here. Skip filing that entry, record it in the summary as `over-cap — run /superpowers:brainstorming on: "{title}"`, and continue with the rest of the batch. This is batch mode's own sanctioned handling of the cap: an over-cap entry is reported, never silently dropped, and never filed past the cap unstubbed.

## Routing (once per batch, not per entry)

Unlike a single invocation's per-record Immediate Routing, batch mode routes the whole successfully-filed set in one pass: apply the invocation's `--route=` arg (when supplied) to every filed entry, or — with no `--route=` — ask once via `AskUserQuestion` whether to route the batch as a set (`brainstorm` / `keep`) rather than asking per entry. `absorb:N` is not offered at the batch level (each entry would need its own target record) — an entry needing `absorb:N` should be filed singly instead.

**Precedence with the headless absorb bar (#1296).** This batch-level restriction is about the *batch-wide* `--route=` arg only — it does not exempt batch filings from `routing.md`'s per-entry headless bar. The Per-entry loop above runs Backend Selection's filing step once per entry, and the headless bar pre-empts that same filing step per `routing.md`'s own trigger (`$PIPELINE_RUN_DIR` set, `--source`, or `--defer-reason=`, all of which batch mode carries uniformly across entries per the entry-file section above); an entry that qualifies absorbs into its own matched candidate and is reported in the Batch Summary as absorbed rather than filed, exactly like a single invocation's own headless absorb. The two rules are independent: one entry absorbing headlessly does not license `--route=absorb:N` at the batch level for the others.

## Batch Summary

Render one table after the loop completes:

| Entry | Title | Outcome |
|---|---|---|
| 1 | {title} | Filed as #{n} (Type: {t}, Definition: {clear\|needed}) |
| 2 | {title} | Over cap — run `/superpowers:brainstorming` |
| 3 | {title} | Failed — {error} |

Then apply the single routing decision above to every `Filed` row. Commit (`SKILL.md`'s Workflow Step 3) runs once for the whole batch, exactly as a single invocation's Step 3 does.
