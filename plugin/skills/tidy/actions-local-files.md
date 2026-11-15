# Tidy — Action Execution (`work-backend: local-files`)

The four actions whose execution diverges by backend, for the `local-files` driver — `Delete`,
`Defer`, `Absorb`, and `Open parent gate`; `actions-github-issues.md` is their twin, and the last
of them additionally reaches this file from a different scan than it reaches that one from (see
its section below). `Sync to GitHub` is the one action with no counterpart here — a local record
carrying `unsynced: true` is a `work-backend: github-issues` artifact by construction.

Everything else stays inline in `SKILL.md`'s Action Vocabulary table. Each action is atomic —
complete all its steps or none.

## Delete

Remove the record file (`specs/{id}-{slug}.md`).

## Defer

`writeRecord` (`bin/lib/issues/local-store.js`) with `facets.stage: 'parked'` (supersedes any other stage value — the two are mutually exclusive) and the trigger appended to the body as a `**Trigger:** {condition}` line (plus `**Watched paths:** {paths}` when the trigger names files) — same file, updated in place, compose-then-write-once.

## Absorb

Continuing from the shared step (1) in `SKILL.md`'s table: (2) update the target record's file in place, (3) delete the absorbed record's file.

## Open parent gate

Resolves a `[parent-gate]` finding. Under this driver those come from Step 1's **Shape 7**
(`step-1-records.md`), not from `_shared/github-pr-scan-acceptance.md`'s `parent-gate` scope — that scope
queries the `parent-issue` label and so returns nothing here, and its file is skipped outright
whenever `gh` is absent, which is why the local sweep lives in the record scan instead. Same
finding prefix, same action; only the scan and the store differ.

Approving one runs `wrap-up/verification-brief-parent-gate.md` (`verification-brief.md`'s Parent-Gate
Procedure) from **Enumerate the parent's sub-issues** onward, using the **parent-side** entry shape
that section documents, on its
`work-backend: local-files` branches. `$PARENT_NUM` is the parent record's own id, already known
from the scan. Re-enumerate the sub-issues (the open+closed `queryRecords` merge) and re-read the
parent's `facets.acceptance` fresh, then re-run **Evaluate the gate** — never reuse the scan's
own snapshot, since `/tidy`'s Step 6 approval is never instantaneous with its Step 1 scan and a
concurrent `/claude-tweaks:wrap-up` may already have gated the same parent. If the re-verified
gate no longer reads `due` (already gated, or a sub-issue reopened), this is a silent no-op — skip it,
don't error, and don't recommend `/claude-tweaks:demo {id}` for it in the applied report either.

If it still reads `due` and **Evaluate the gate** reads `exceeds: false` (below the oversight
floor), run that procedure's **Close the parent below the floor** instead of composing a brief: it
appends the listing section and calls `closeRecord`, writes no `facets.acceptance`, and a parent
already closed is a no-op; it stays staged, per the paragraph below. Otherwise compose the parent brief and apply the gate exactly as that procedure's
**Compose the parent brief** and **Apply the gate** sections describe for this driver: append the
brief to the parent record's body and set `facets.acceptance = 'pending'`, written through a
single `writeRecord` call. That is one composed write, not two, so this action has no
partial-state recovery path to document — unlike its `github-issues` twin, whose
comment-then-label sequence is two independent API calls and does.

This action is **staged, never auto-applied, at every aggressiveness tier** in auto mode
(`step-6-auto.md`'s `Open parent gate` row covers both drivers). The `github-issues` twin's own
reason does not carry over — that one rests on the write being an outward-facing GitHub API call,
and this one is a file edit under git, which clears `_shared/auto-mode-contract.md`'s
reversibility floor outright. What fails here instead is that contract's **confidence** floor:
the write is not a mechanical flag flip but the composition of a Verification Brief, an authored
artifact a human then reads as the basis for a sign-off verdict, plus the assertion that every
sub-issue is complete.

**And the write latches.** `parentGateState` reads the parent's own disposition before it reads
any sub-issue, so the moment `acceptance: pending` is on the parent it returns `gated` on
every future evaluation — this action, `/claude-tweaks:wrap-up`'s eager path, and Shape 7's sweep
all stop looking at it. An auto-applied brief that got the decomposition wrong therefore becomes the
input a human signs off against, with nothing left in the data to show a machine chose it —
`[IL-96]`'s shape, a write that becomes one of its own path's future inputs. `git revert` undoes
the bytes; it does not undo a verdict already given against them, which is why clearing the
reversibility floor is not sufficient here.

The below-floor close composes no brief and writes no `acceptance` facet, so it has no latch; it
stays staged because it closes the parent and asserts every sub-issue is complete.

Keeping both drivers on the same tier is also what keeps `[parent-gate]` one finding with one
behavior rather than two that diverge by store.

This action never sets `acceptance: approved` or `acceptance: changes-requested` — those stay
exclusively `/claude-tweaks:demo`'s job, applied only after an explicit human verdict. Opening
the gate is the precondition for that verdict, not the verdict itself, which is why the
above-floor recommendation still ends with `/claude-tweaks:demo {id}` even once the gate is open.

**What this does not cover.** Only decomposition parents. The sibling backstop — `acceptance-gap`,
closed records with no disposition that are *not* decomposed sub-issues — is a scan, not an action: it has a
`local-files` twin (`step-1-records.md`'s **Shape 8**; Shape 7 prints the same row for a hand-closed parent), but that shape recommends
`/claude-tweaks:demo {id}` and mutates nothing, so no `## acceptance-gap` section belongs in this
file or in `actions-github-issues.md`. Approving one of its rows executes no procedure here;
the disposition itself is `/claude-tweaks:demo`'s, applied only after a human verdict.
