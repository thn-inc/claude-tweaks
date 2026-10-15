# Tidy — Step 6 Interactive Mode

Step 6's interactive branch; `step-6-auto.md` is its twin. `SKILL.md` resolves `--dry-run` before
reading either — under it, the "Approve ({N})" option logs would-be entries instead of executing Step 7.

Present all collected findings as a single report. Every item has a pre-filled recommendation from the scanning steps.

````markdown
## Tidy Report — {date}

**Applied automatically**
```text
{verb}       #{N}  {title ≤50, …-truncated}                        {commit abc1234 | reconcile-converged}
```

**Approve ({N})**
```text
1  [{tag}]  #{N}  {title ≤50}
   {recommended action, one line}
   {the exact command or mutation}
2  …
```

**Yours ({N})**
```text
{command} ({k})
   #{N}  {title ≤50}                                                {why it needs the human}
   {batch command, or a paste block with one line per row}
```

**Clean:**
```text
{scan}             {count} checked
```

Full decision log: {run-dir}/decisions.md
````

Section semantics follow `step-6-auto.md`'s Bucket mapping and are bound by its "Report rules" section (stated once there — not restated here): in interactive mode, **Applied automatically** carries only what already executed without a decision (reconcile-converged outcomes only); every active recommendation from the scans (delete, defer, absorb, promote, sync, fix, close, resolve, capture, open parent gate — every mutating entry in `SKILL.md`'s Action Vocabulary table) renders as a numbered row (1..N) in **Approve ({N})**, which is the set the "Approve ({N})" option executes; findings that only a human can act on (needs-scoring, re-triage, acceptance gaps, trigger-met parked records, unsettled runs, ungranted PRs, cross-spec patterns, design-record drift) render in **Yours ({N})** grouped per `step-6-auto.md`'s Yours grouping, each group closing with its batch line or paste block; Keep rows and clean scans are counted in **Clean:** — kept visible as counts, never itemized rows.

`[release-note]` rows are staged and rendered exactly as `release-note-repair.md` describes: its `## Compose the line` step's Composition timing note has this mode compose each line before this report renders, written to the per-record session-tmp line file, and the row's command renders exactly as that file's Stage tier `command` — never recomposed here, never restated.

Immediately after presenting the report above, call `AskUserQuestion`:

- `question`: `"How do you want to handle these tidy actions?"`, `header`: `"Tidy actions"`, `multiSelect`: `false`
- Option 1 — `label`: `"Approve ({N}) (Recommended)"`, `description`: `"Execute every item in the Approve ({N}) section above"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"Tell me which Approve #s to change"`

**Hard gate.** Check the response you are about to send: does it already contain the `## Tidy Report` block above — or, when the condense rule fired, the condensed report — as literal rendered markdown, with every non-empty section — **Applied automatically**, **Approve ({N})**, **Yours ({N})** — and the **Clean:** line? If not, this is not "the report was presented earlier" or "the user can infer the items from the summary" — render it now, in this response, before the tool call. `AskUserQuestion` cannot carry the report itself (`docs/skill-authoring.md`'s Multi-item decisions convention), so a response with the tool call but no report above it has shown the user "Approve ({N})" with nothing to approve.

If "Override specific items" is chosen, the follow-up (#s and target values) is ordinary free-text conversation in the next message, per docs/skill-authoring.md's Multi-item decisions convention — not the tool's built-in `Other` field.

Only items in **Approve ({N})** are executed — every mutating entry in `SKILL.md`'s Action Vocabulary table, not a fixed subset of it. **Yours ({N})** and **Clean:** items require no mutation and are never touched by the "Approve ({N})" option.

