# Build dispatch cost shape — design

**Origin:** #3229 (feedback from a measured 10-task SDD build). **Related:** #3123 (fast-lane transcription batching, `ready`), #1926 (single-task fast-lane whole-branch review skip).

## Intent

A multi-task build spends most of its agent time late and on expensive tiers: a full-code plan, per-task reviews that come back clean, a top-tier final review that finds spec-level gaps no code review should be the first to see, and mid/top-tier agents doing mechanical work. The goal is to move judgment earlier (before Task 1), match each dispatch's tier to its actual role, and make the cost measurable — **without** losing the top-tier reviews that caught real defects (a JSON-column crash, a lost undo control, an unguarded race).

Steering principle (decided with Thomas, 2026-10-17): claude-tweaks never files upstream with superpowers for this, and never contradicts SDD's text. It may (a) shape the plan at authoring time — #3123's precedent — and (b) forward instructions to SDD that choose *within* SDD's own rules, the way `build/dispatch.md` already forwards the AC excerpt, foreground rule, status token, tree-immutability rule and final-review model.

## What recon established (2026-10-17, origin/main b203a6b2f)

- **The measured run invoked SDD directly**, not through `/build`, most likely in a project pinned to superpowers 6.3.0 at project scope (`~/.claude/plugins/installed_plugins.json`: memenu-app and jarvis — and several of their worktrees — are on 6.3.0; user scope and this repo are on 7.0.0).
- **SDD's `## Model Selection` is byte-identical in 6.3.0 and 7.0.0**: transcription implementers and single-file mechanical fixes take the cheapest tier; reviewer tier scales with the diff's size, complexity and risk; "Scoped re-reviews of small fix diffs take a cheap-to-mid tier"; mid-tier is the floor for reviewers and prose-brief implementers. The measured run had these rules and still ran mid/top-tier on mechanical work — SDD leaves the call to the controller each dispatch. Component B makes that call deterministic for `/build` runs; it would not have changed a direct-SDD run like the measured one.
- **Item 2 of #3229 (signatures and tests, not full code) is upstream in writing-plans 7.0.0** ("What a Step Contains": "The implementer writes the body. A body appears only for an algorithm the signature and tests do not determine", plus a Proportion self-review). It is absent from 6.2.0 and 6.3.0. Nothing in claude-tweaks pushes plans back toward full code.
- **SDD has a controller-run pre-flight scan** ("Before dispatching Task 1, scan the plan once for conflicts …") — cross-task and within-task contradictions, written to the SDD ledger. It does **not** hunt spec gaps or behaviour the spec leaves undecided — the class behind 3 of the 5 late findings — and it runs on the controller, not a dispatched top-tier reviewer.
- **Our own `dispatch.md` overrides SDD's per-task heuristic**: the spec header's `size:` maps every implementer in the spec to one profile (low → Fast, medium → Standard, high → Capable). A transcription task in a `size: medium` spec never reaches Fast. This is ours to fix. `dispatch.md` pins no tier for task reviews or re-reviews — only the final whole-branch review.
- **Item 4c (controller verifies a no-code fix round with no re-review) and item 5 (overlap task N's review with task N+1's implementation) contradict SDD's text** ("The fix was small, skip the re-review" is in its rationalization table; the loop is sequential). Neither is done here.
- **`/flow` reviews the same branch twice**: SDD's Capable whole-branch review + fix wave + re-review inside `/build`, then `/claude-tweaks:review`'s lens fan-out on the same diff. `/review` reads nothing from SDD's final review. Its lenses run on Fast (3a, 3f), Standard (3b-3e, 3g) and Capable only for 3h UX (`review/step3-lens-dispatch.md`), with reproduction pairs.
- **Cost data today is per phase, not per dispatch.** `plugin/bin/phase-timing.js` (+ `bin/lib/timing/transcript.js`) derives per-phase minutes and transcript token counts, rendered by `/wrap-up` (`wrap-up/summary-template.md`). Nothing attributes cost to individual subagent dispatches or tiers. `SubagentStop` (`bin/lib/hooks/subagent-stop.js`) fires unreliably for Task dispatches (claude-code#27755) and logs contract violations only.
- **The drift manifest pins superpowers at 6.2.0** (`tools/upstream-drift/manifest.yml`), and its checks read only that cached version. It pins `## Model Selection` and `## Final Review` headings, not the lines this design leans on — two of which ("Batch small same-shape work", writing-plans' "writes the body") don't exist in 6.2.0.
- **The auto-mode contract's HARD-GATE list** (`_shared/auto-mode-contract.md`) names `/build` Design Step 3 plan validation and Common Step 1.5 plan-audit hard-fails — not a new step between 1.5 and 2.
- **The materialized spec** (`work/{n}-spec.md`) lives in the worktree's copy in worktree mode, not under `$PIPELINE_RUN_DIR`, and reaches the main checkout only on merge (`flow/materialize.md`).
- Byte headroom: `build/SKILL.md` 45,995 against the 51,200 shared ceiling; `build/dispatch.md` 15,224; `build/plan-authoring-checks.md` 33,050.

## Goals

1. Catch spec gaps and undecided behaviour before Task 1, on a top-tier model, and fix them in the spec — not in a fix wave after the whole branch is written.
2. Give each implementer, task review and re-review a tier that matches its role and risk, within SDD's Model Selection rules.
3. Cut implement-and-review cycles for small adjacent tasks.
4. Make a build's agent cost measurable per dispatch and per tier, so this design's savings are verified rather than estimated.
5. Notice when superpowers drops or changes the upstream text these changes lean on, and when a project runs a superpowers older than the one claude-tweaks is verified against.

## Non-goals

- Filing anything upstream with superpowers.
- Changing SDD's per-task loop: no skipped per-task reviews, no skipped re-reviews (item 4c), no review/implementation overlap (item 5). Item 5's saving is pursued only indirectly, through fewer cycles (Component C).
- Rewriting writing-plans' code-density rules — upstream 7.0.0 already has them (item 2). Projects on older superpowers get them by updating (Component F tells them).

## Anti-goals (failure even if it technically works)

- A concurrency, decision-logic or rendering-heavy task's review drops below Capable. Those reviews paid for themselves.
- A plan review that rules on spec gaps in the SDD ledger only, leaving the spec that `/test`, `/review` and `/wrap-up` judge against unchanged.
- Any new mid-flow stop in `auto` mode that isn't added to the auto-mode contract's HARD-GATE list deliberately.
- A plan without the new per-task markers behaving differently from today (expand-contract: absent markers = today's behaviour, byte-for-byte in what `dispatch.md` forwards).

## Order of work

D (telemetry) → E (re-pin + drift pins) → A, B, C (C after #3123 lands) → F. G after D and its baseline runs. D ships first so a pre-change baseline exists before A-C change the cost shape.

## Components (each a candidate work record)

### D. Per-dispatch cost telemetry

Extend the existing transcript-based timing (`phase-timing.js`, `bin/lib/timing/transcript.js`) to attribute usage to individual subagent dispatches: per dispatch, the model, wall-clock span and token usage, read after the fact from the session and subagent transcripts — not from the `SubagentStop` hook (unreliable for Task dispatches, owning-session-only). `/wrap-up`'s run summary renders a breakdown by model tier, and by role where the dispatch description identifies it. A missing transcript degrades to an explicit "not found" line, never a guessed value. Before A-C ship, record a baseline from at least one representative multi-task `/flow` run.

### E. Re-pin superpowers and add drift pins

Re-pin `tools/upstream-drift/manifest.yml`'s superpowers entry from 6.2.0 to 7.0.0 via the `upstream-repin` project skill — re-verifying every existing superpowers assertion against 7.0.0 — then add assertions for the upstream text Components A-C lean on, each tied to the claude-tweaks file that relies on it: SDD's pre-flight scan sentence, Model Selection's cheapest-tier transcription line and "cheap-to-mid tier" re-review line, SDD's "Batch small same-shape work", and writing-plans' "The implementer writes the body."

### A. Plan review before Task 1 (#3229 item 1)

A new `/build` Common Step between plan audit (1.5) and execution dispatch (2), Spec Mode only (design mode has no materialized spec or record — same skip as architecture alignment). One dispatched reviewer on Capable reads the materialized spec and the plan and returns findings in three classes:

- **Spec gap** — the spec does not decide something the plan must decide.
- **Undecided behaviour** — an input class, failure mode or UI state no task covers.
- **Cross-task contract** — one task produces what another consumes, and they disagree.

It explicitly does not redo SDD's pre-flight conflict table.

- A dispatch site under the Subagent Contract (`_shared/subagent-output-contract.md`): minimal input, status line, inlined output template, explicit Capable profile via `resolve-profile.js`.
- **Spec gap the reviewer can resolve from the spec's own intent:** amend the worktree's materialized spec (`work/{n}-spec.md`) before Task 1, log per `_shared/auto-decision-log.md`, and stage the matching record-body amendment for the Review Console — `/build` does not edit the live issue mid-run.
- **Spec gap that needs a human:** a new HARD-GATE stop (see "Spec gap that needs a human (decided)" below).
- **Undecided behaviour / cross-task contract** findings amend the plan, not the spec.
- Skipped under `ceremony-profile: fast-lane` (new roster tag in `_shared/ceremony-profile.md`) and for trivial plans (builder's call on the threshold).
- Lives in a new `build/` sub-file with a short pointer in `SKILL.md` (byte headroom).

### B. Per-task implementer and review tiers (#3229 items 6, 4a, 4b, and 4c's intent)

The plan author tags each task at authoring time (new `plan-authoring-checks.md` guidance) with two optional markers:

- **Implementer role** — `transcription` (the task's plan text contains the complete code, or it is a single-file mechanical change) / `integration` (multi-file coordination) / `judgment` (design judgment or broad codebase understanding). These are SDD's own Model Selection signals, decided once at plan time.
- **Review risk** — `high` when the task touches concurrency, decision logic, or rendering-heavy UI; otherwise absent.

`dispatch.md`'s SDD invocation forwards tiers **only for tasks that carry a marker**; a plan with no markers gets exactly today's forwarded text.

- Implementer: `transcription` → Fast, `integration` → Standard, `judgment` → Capable. An untagged task keeps today's `size:` mapping.
- Task review: `high` → Capable; a task with a role marker but no `high` → Standard (SDD's reviewer floor). A task with no markers at all gets no forwarded review tier (SDD's own judgment, as today).
- Scoped re-review, for tasks with any marker: Fast when the fix diff touches only comments or test files; Standard otherwise. The re-review still runs — SDD's "cheap-to-mid tier" rule made explicit, not item 4c's skip.
- `profile=…` overrides implementer tiers only, as today. It never lowers a `high` review below Capable.
- Component A's plan reviewer also flags a task that touches concurrency, decision logic or rendering-heavy UI without `high` — the guard against a forgotten marker.
- `plan-audit.js` validates the markers (unknown value → audit finding). Profiles resolve through `bin/resolve-profile.js`, never hardcoded model names.

### C. Merge small adjacent tasks at authoring time (#3229 item 3)

New `plan-authoring-checks.md` guidance: when two adjacent tasks touch the same files and the second only consumes the first's output (e.g. "add column" + "pure function over it", "add job" + "remove what it replaces"), and neither needs its own review surface, write them as **one task**. This is plan granularity, not SDD's batch rule, so it needs no marker and does not interact with `--count-tasks`' `batched` flag. Lands after #3123 (same file, adjacent guidance) and cross-references it.

### F. Effective superpowers version notice

When the project's effective superpowers (a project-scope install overriding user scope) is older than the version the drift manifest pins (7.0.0 after Component E), surface a one-line notice naming both versions and the update command. Placement (SessionStart notice vs `/claude-tweaks:help` status) is the builder's call; it must not add a stop.

### G. `/flow`'s double whole-branch review — measure, then decide

`/review` does not run on SDD's tier, so making it the only whole-branch review is not safe as-is. Decided (Thomas, 2026-10-17): measure first. G is a record that depends on D and its baseline. Across at least 3 multi-task `/flow` runs with D in place, compare SDD's final review (plus fix wave and re-review) against `/review` on the same branches — cost per D, and which Important/Critical findings each produced. Then choose, against this threshold (my call — adjust when shaping G):

- **Skip SDD's final review under `/flow` and add one Capable whole-branch lens to `/review`** when SDD's final stage exceeds 15% of the build's agent time and at least half of its Important/Critical findings were also found by `/review`.
- **Keep SDD's final review and have `/review` consume its findings as prior coverage** when the overlap is at least half but the cost share is under 15%.
- **Keep both unchanged** when the overlap is under half — the two reviews are catching different things.

### Spec gap that needs a human (decided)

Decided (Thomas, 2026-10-17): Component A adds its human-needed spec gap to `_shared/auto-mode-contract.md`'s HARD-GATE list as a deliberate contract change. When someone is present, the gate is a real stop before Task 1, in every mode. Under unattended `/dispatch` or a Routine, the record goes `bot:blocked` with the question posted on it, through the transport `/dispatch` already uses for blocked records.

## Calls I made (check these while reading)

- D reads transcripts after the fact (extending `phase-timing.js`), not the `SubagentStop` hook, and ships first with a recorded baseline.
- E re-pins superpowers to 7.0.0 — without it, two new pins fail and F would never warn a 6.3.0 project.
- A runs in Spec Mode only, amends the in-run materialized spec, and stages (never live-writes) the record-body amendment.
- B forwards tiers only for marked tasks; `profile=` stays implementer-only; A's reviewer catches a missing `high` marker.
- F is new scope I added; strike it if unwanted.
- G's decision thresholds (15% cost share, half of Important/Critical findings overlapping, at least 3 runs).

## Constraints

- Expand-contract: every new plan marker is optional; absence reproduces today's behaviour exactly. Plans written before this ships are not re-steered.
- `dispatch.md`'s `size:` mapping and `profile=` semantics stay as documented for untagged tasks; the `profile=frontier` guard is untouched.
- Do not touch `dispatch.md`'s single-task fast-lane skip condition or the drift pin on SDD's `## Final Review` (G option 2 aside).
- Byte ceilings: measure every grown `plugin/skills/**/*.md` against its binding ceilings (`plan-authoring-checks.md`'s Byte-pin check).
- `docs/skill-graph.md` gains any new edge; no edge restated inside a `SKILL.md`.

## Success criteria

- On a comparable multi-task `/flow` build after A-C ship, D's telemetry shows lower total agent time and a lower Capable-tier share than the recorded baseline, with every `high` review-risk task still reviewed on Capable.
- Final-review findings classed as spec/plan-level drop, because A caught them first.

## Left to the builder

- The plan-review sub-file's name, the trivial-plan threshold, and the output template shape.
- The exact marker syntax for implementer role and review risk (must survive `plan-audit`'s parser and not collide with `**Execution:** batched`).
- Where in `/wrap-up` the per-dispatch breakdown renders, and how role is inferred from a dispatch description.
- Component F's placement.
