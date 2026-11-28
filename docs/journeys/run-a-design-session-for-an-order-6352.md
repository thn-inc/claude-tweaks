---
files:
  - plugin/skills/design/SKILL.md
  - plugin/skills/design/step-1-evidence.md
  - plugin/skills/design/step-4-perspectives.md
  - plugin/skills/design/step-7-builder-check.md
  - plugin/skills/design/reader-briefs.md
  - plugin/bin/design-session.js
  - plugin/bin/lib/design-session/status.js
  - plugin/bin/lib/design-session/notes.js
  - plugin/bin/lib/design-session/brief.js
  - plugin/skills/design/step-8-parts.md
  - plugin/skills/design/step-9-approve.md
  - plugin/skills/design/step-10-file.md
  - plugin/bin/lib/design-session/parts.js
  - plugin/skills/specify/decomposition-mode.md
  - plugin/skills/specify/decomposition-mode-closeout.md
---

# Run a Design Session for an Order

**Persona:** A maintainer about to start work too big for one record (a parent with parts). Earlier builds of work this size kept stopping to ask what the design should have said, and they want the design settled before anything is shaped.
**Goal:** Leave one folder holding sourced evidence, a frame, a storyboard tested by five fresh readers, weighed alternatives, a pre-mortem, a builder check and an approved parts list. Then have that list filed as a parent issue with sub-issues and blockers exactly as approved, with no second conversation about what the parts are.
**Entry point:** `/claude-tweaks:design {topic}` or `/claude-tweaks:design #N`, typed in an interactive session inside a worktree of the repository that holds most of the order's work.
**Success state:** `docs/superpowers/specs/{date}-{slug}/` holds `evidence.md`, `design.md` (every section `Status: done`, `## Decisions` last), `storyboard.{ext}` and one `notes-round-{N}.md` per round, and every note in those files has an outcome. `design.md` carries an `Approved: … — digest sha256:…` line, every part's Issue cell holds `{owner/name}#{N}` or `left for {owner/name}`, and `## Filing` names the parent. One parent issue exists with one sub-issue per part for this repository, in table order, with the table's blockers and sizes. The parent carries the worth-it measure word for word. `/claude-tweaks:specify` committed the folder; it is kept, not deleted.

## Steps

### 1. Start the session — slash command
- **URL:** `/claude-tweaks:design {topic|#N}`
- **Action:** Type the command with a topic, or with the issue the order grew from.
- **Should feel:** Like opening a working folder, not filling in a form. The skill says up front that the folder stays uncommitted until step 10's `/claude-tweaks:specify` run commits it, and that until then a later session resumes it only from the same checkout.
- **Should understand:**
  - Under `worktree-always: true` in the main checkout, the skill stops before its first write and asks for the session to be started inside a worktree. It never creates a worktree or a branch itself.
  - `design-session.js folder` derives the slug deterministically (`#N` → `issue-N`). It matches an existing folder for the same slug instead of making a second one.
  - When the session runs below the top tier, one question offers `Switch to the top tier and resume (Recommended)` or `Continue on this model`. A choice to continue is recorded in `## Decisions`.
- **Red flags:** A second folder for the same topic. A write in the main checkout under `worktree-always`. A worktree or branch the skill made.

### 2. Read the evidence before any idea — evidence.md
- **URL:** `{folder}/evidence.md`
- **Action:** Read what already exists (issues, merges, runs, earlier designs, settings), shown before the skill proposes anything.
- **Should feel:** Grounding, like a briefing. Every line names where it came from.
- **Should understand:**
  - Each claim ends in `— source:` with an issue or PR ref, a commit sha, a `path:line` (a path containing spaces included), or a run folder. `check-evidence` refuses a line that has no source.
  - Search areas that found nothing are said when the evidence is shown, not written as unsourced lines. When nothing at all is found, one bullet says so, sourced to the HEAD sha that was searched.
- **Red flags:** A proposal before the evidence is shown. A claim with no source. A lone `—` line accepted.

### 3. Agree the frame and the storyboard — design.md
- **URL:** `{folder}/design.md` `## Frame` and `## Storyboard`, plus `{folder}/storyboard.{ext}`
- **Action:** Answer the open questions one at a time, then approve the cheapest picture of the result.
- **Should feel:** Like a conversation about what is wanted, not a menu of guessed options. Every recommendation comes with its reason.
- **Should understand:** Every decision is appended to `## Decisions` as `- YYYY-MM-DD — {decision} — by: maintainer|model`.
- **Red flags:** Guessed multiple-choice options in place of an open question. A decision made but not recorded.

### 4. Settle each round of reader notes — notes-round-N.md
- **URL:** `{folder}/notes-round-{N}.md`, one batch table per round
- **Action:** Give every note an outcome (`changed`, `declined`, `accepted-risk`), taking the recommendation or overriding rows.
- **Should feel:** Fresh eyes on the design. The five readers (user, smallest, ownership, token-cost, introduction) only saw the frame, the storyboard and the note template, so their notes do not just echo the session.
- **Should understand:**
  - Every reader resolves on the top tier through `resolve-profile.js frontier --exception design-reader`. On a step-down the skill stops before any reader of that round starts, and never lowers the tier. When the folder's 22 readers are used up, the recommended answer records the gap in `## Decisions` and ends at the handoff.
  - Rounds repeat until one has no serious note, at most four. After the fourth, the open serious notes are listed and the maintainer is asked. A fifth round is never started.
  - The skill refuses to start the next round or step while any note has no outcome.
- **Red flags:** A reader prompt holding conversation, evidence or decisions. A round started with a note still undecided. A reader dispatched on a lower tier.

### 5. Weigh alternatives, the pre-mortem and the builder check — design.md
- **URL:** `## Approaches`, `## Pre-mortem`, `## Builder check`
- **Action:** Choose between the real alternatives. Then rule on the pre-mortem's failures and the builder's open guesses, both laid out in batch tables.
- **Should feel:** Like stress-testing a decision already made, not reopening it.
- **Should understand:** The pre-mortem reader gets `design.md` without its `## Decisions` plus the storyboard. The builder gets `design.md` alone and says what it would still have to guess.
- **Red flags:** The builder reader receiving the decisions list. A guess left open with no ruling.

### 6. Agree the parts and the estimate — design.md `## Parts`
- **URL:** `{folder}/design.md` `## Parts`
- **Action:** Work out the parts with the skill (name, size, repository, what each waits for), with the part that makes the order visible to a user last. Then confirm the table and the estimate line under it.
- **Should feel:** Like drawing the build's map once, in one table, rather than leaving it for decomposition to guess.
- **Should understand:**
  - `design-session.js parts` checks the table: sizes are `size:low`, `size:medium` or `size:high`, every `Waits for` names a part or an `owner/name#N` issue, and repositories are `owner/name`. Errors are fixed until it exits 0.
  - The estimate counts parts by size. It says it has no per-size token figures to go on, rather than inventing a number.
- **Red flags:** A size outside the three labels accepted. A token number with no basis. Parts written anywhere but the table.

### 7. Approve the design — design.md `## Approval`
- **URL:** `{folder}/design.md` `## Approval`
- **Action:** Pick `Approve the design, its parts and estimate (Recommended)`, or `Change something first`.
- **Should feel:** Like signing off on exactly what will be filed, and on nothing looser.
- **Should understand:**
  - The skill writes `Approved: {date} — digest sha256:{hex}` over the frame, the chosen approach and the first five columns of the parts table. Issue marks are outside the digest.
  - From then on, a change to the frame, the approach or the parts asks for a new approval first. A hand edit after approval makes `status` resume at step 9 with `reapprove`.
- **Red flags:** An edit to an approved part with no new approval. A digest that still matches after a cell changed.

### 8. File the parts through specify — step 10
- **URL:** `/claude-tweaks:specify {design.md path}`, invoked by the skill. This is the same input a maintainer can type.
- **Action:** Let step 10 check the approval and hand the folder to decomposition. Then read its summary.
- **Should feel:** Like the parts list simply became issues. Nothing was re-decided along the way.
- **Should understand:**
  - Decomposition files one parent and one sub-issue per part for this repository, in table order, with the table's names, sizes and blockers. Two or more parts always keep a parent.
  - Red-team may stage a finding on a part, but never changes a part's name, size or blockers. A gate that would change one stops and asks, and with no human reachable it still stops.
  - A design with no status line is refused as not approved. A design doc with no `## Parts` section runs decomposition as before.
  - Each Issue cell gets `{owner/name}#{N}`, and `## Filing` gets a repository-qualified `Parent:` line. `check-approval` then shows every part skipped.
- **Red flags:** A sub-issue whose name, size or blockers differ from the table. A part split or merged by decomposition's own heuristics. The folder deleted after filing.

### 9. Finish the parts left for another repository — status there
- **URL:** the committed folder copied into the other repository's checkout, then `/claude-tweaks:design {topic|#N}` there
- **Action:** Copy the folder as committed and rerun the command in that repository.
- **Should feel:** Like continuing the same session, not starting a new one.
- **Should understand:**
  - The first run's summary lists each part marked `left for {owner/name}`. Those sub-issues' blockers on another repository are written `Blocked by: {part} (left for {owner/name})`, and the issues stay out of `ready` until the later run rewrites that line to `owner/name#N`.
  - `status --repository {owner/name}` (or a parseable origin) reads a part `left for` this repository as unfiled, so the session resumes at step 10 and files only that repository's parts. When no repository resolves, a `complete` status lists `unresolvedLeftFor`, and the session reruns with `--repository` before calling itself finished.
- **Red flags:** The second repository's session reading `complete` while a part is still left for it. A `ready` sub-issue that is still blocked by a part with no issue number.

### 10. Resume a lost session, then hand off — status
- **URL:** `/claude-tweaks:design {topic|#N}` again, then Next Actions
- **Action:** Rerun the same command after a crash or a stop. When the session is finished, take Next Actions' recommendation.
- **Should feel:** Like nothing was lost. The session picks up at the first step whose file or section is missing or unfinished, and repeats nothing.
- **Should understand:**
  - `design-session.js status` prints `resumeAt`, `round` and `action`, and the skill follows it rather than choosing the next step by hand. A folder with `evidence.md` and a done frame resumes at step 3.
  - A resumed round dispatches only the perspectives still missing from it. A resumed filing skips every part already marked `owner/name#N`.
  - A session that stopped early renders only the resume line.
- **Red flags:** Evidence or the frame rewritten on resume. A reader re-run whose notes were already recorded. A part filed twice. The skill starting a build.

## Origin

Built for record #6352 (`/claude-tweaks:design`, factory v7 slice 1), on #6351's `frontier --exception design-reader` resolver. Steps 6-9 were added by record #6353 (parts and estimate, approval with a digest, and filing through decomposition as written).
