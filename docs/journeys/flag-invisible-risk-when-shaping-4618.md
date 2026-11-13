---
files:
  - plugin/skills/specify/shaping-mode-stamping.md
  - plugin/bin/risk-flags.js
  - plugin/bin/lib/issues/record.js
  - plugin/bin/lib/issues/record-risk-flags.js
  - plugin/bin/plan-audit.js
  - plugin/bin/lib/plan-audit/checks.js
  - plugin/bin/lib/plan-audit/parser.js
  - plugin/bin/lib/issues/risk-flag-classify.js
  - plugin/skills/build/plan-audit.md
  - plugin/skills/build/micro-plan.md
  - plugin/bin/lib/express/eligibility.js
  - plugin/skills/wrap-up/verification-brief.md
  - plugin/skills/_shared/acceptance-packet.md
  - plugin/bin/lib/wrap-up/packet-render.js
---

# Flag Invisible Risk When Shaping

**Persona:** A maintainer shaping a backlog record whose deliverables add a database migration and change who may call an endpoint. Clicking around in a dev build will never show them that a rollback loses data or that an unauthenticated request now gets through, and they do not want to find out at merge time.
**Goal:** Have that risk named when the record is shaped, kept or removed by a human, and made to carry a specific proof that the plan, the build and the acceptance packet each check, so it cannot reach acceptance unproven.
**Entry point:** A Claude Code session in a project with `work-backend: github-issues` (or `local-files`); type `/claude-tweaks:specify #N` on a `captured` record whose Key Files include a `migrations/` path and whose Acceptance Criteria mention a permission check.
**Success state:**
- The record body carries `Risk-flags: migrations, auth` (and no `Risk-flags-unconfirmed:` line once a human answered).
- The build's plan has a `Proof(migrations):` and a `Proof(auth):` line, each of at least 20 characters, and `plan-audit` passed.
- The acceptance packet's Risk proofs section lists each proof as `planned, not verified`, so the human knows exactly what the plan promised and that nothing ran it.

## Steps

### 1. Shape the record and see the flags with their evidence
- **URL:** `/claude-tweaks:specify #N`
- **Action:** Run it on the record. After the body is composed, the Risk flags step classifies it and shows one table: a row per flag, its slug, and the evidence sentence that matched (`Key Files: db/migrations/0042_add_roles.sql`).
- **Should feel:** Like a second pair of eyes on exactly the things you would forget to mention. The evidence is quoted, so you can see why each flag fired rather than trusting a bare label.
- **Should understand:**
  - The four built-in categories are `migrations`, `auth`, `public-contract` and `irreversible-side-effect`. The deterministic floor (keywords and Key Files paths) fires first; the agent may add a flag it spotted but can never drop one the floor found.
  - A flag already on the record from an earlier shaping shows up in the same table marked `already on the record`.
  - The classifier reads only what the record declares. A record that omits the sensitive path gets no flag here, and the diff tripwire is the backstop for that.
  - `risk:*` (blast-radius score) is a different axis from risk flags. The flags are lines in the body, not labels.
  - An explicit single `/claude-tweaks:specify #N` runs this step even on an already-shaped record, so the flag lines alone can turn a no-op into a body write. A comma-list, a range element or a bare-drain shape never runs it on an already-shaped record.
- **Red flags:**
  - A record on which the migrations path is plainly listed but no flag was shown.
  - Evidence rendered as raw record text with no neutralizing wrapper.
  - A bulk `/claude-tweaks:specify` classifying records that were not named.
  - A hand-typed `Risk-flags:` line in the composed body instead of one written by `risk-flags.js`.

### 2. Keep or remove each flag in the batch question
- **URL:** *(AskUserQuestion rendered by `/claude-tweaks:specify`)*
- **Action:** Answer the question. One flag gets a single-select `Keep {slug} (Recommended)` / `Remove {slug}`. Two to four flags get one multiSelect where a selected option means remove. More than four are asked in sequential chunks of at most four.
- **Should feel:** Quick and low-stakes to keep, deliberate to remove. The safe default is the first option and there is no free-text answer to parse.
- **Should understand:**
  - Only a human removes a flag, and only through this answer. A removal is logged only after the record write lands (`KEPT-PROMPT` in `decisions.md` when a run dir resolves, otherwise a record comment `Risk flag {slug} removed by the maintainer during shaping`), so a failed write never leaves a phantom removal on the record.
  - Any answer clears `Risk-flags-unconfirmed`.
  - A removal does not persist. A flag the floor detects again on a later shaping is re-added, unconfirmed when headless, and asked about again at the next interactive touch.
  - If the existing `Risk-flags:` line is unreadable, nothing is asked: the human is told the line must be repaired first, every flag stays kept and unconfirmed, and no removal is logged.
- **Red flags:**
  - A removal logged to `decisions.md` or the record whose write then failed.
  - A removal logged as `AUTO`.
  - A removal accepted on a malformed or unknown-slug flag line.
  - More than four options in one question.
  - A free-text "Other" answer parsed as a removal.

### 3. Shape headless and see every flag kept, marked unconfirmed
- **URL:** `/claude-tweaks:specify #N --chained`, a headless `/claude-tweaks:backlog refine`, a dispatch-bound or Routine run, or any `AskUserQuestion` that errors, times out or is auto-answered
- **Action:** Let the headless run shape the record. Later, run `/claude-tweaks:backlog refine` with a human present and answer its unconfirmed-flags question.
- **Should feel:** Cautious by default. A machine with nobody to ask picks the stricter reading and says so, instead of guessing that a flag was a false alarm.
- **Should understand:**
  - Headless means no human is reachable, not `auto` mode. The fail direction is always keep: every detected flag is written and the set is marked `Risk-flags-unconfirmed: true`. Nothing in the run stops to ask.
  - Records with no flag line (the existing backlog) are never reclassified in bulk. They are classified when next shaped.
  - A human-present refine confirms the unconfirmed set (Step 3.7), covered in `refine-the-backlog-through-decision-lanes.md`. Until a human answers, every downstream step still treats the flags as kept and labels them unconfirmed.
- **Red flags:**
  - A headless run that drops or narrows a flag.
  - A kept set written without the unconfirmed marker.
  - A headless run that opens an `AskUserQuestion`.
  - A `Risk-flags:` line in bold, a list or a quote read as "no flags" instead of as a flag line.
  - A malformed line or an unknown slug read as "no flags" instead of as all four built-in categories flagged.

### 4. Build refuses a plan with no proof for a kept flag
- **URL:** `/claude-tweaks:build #N`, at the plan-audit step (Common Step 1.5)
- **Action:** Let the build audit its plan. When it fails, add a line `Proof(<slug>): {text}` to one plan step per kept slug and let the audit re-run.
- **Should feel:** Firm but concrete. It names the exact slug that is missing a proof and what a proof line must look like, rather than a vague "add more tests".
- **Should understand:**
  - Check G is gating. `checkG.missing` names each slug and a reason: `no-proof-line`, `too-short` or `restates-category`. A proof is a line `Proof(migrations): rehearse the 0042 migration and its rollback against a copy of production data` of at least 20 characters that says more than the category name. A line inside a code fence does not count.
  - In auto mode the one amendment needs no prompt and is logged to `decisions.md`. If the re-run still fails, the build stops in every mode.
  - A line it cannot read (a malformed `Risk-flags:` line, a `Proof(...)` line with the wrong shape, a plan with no parseable task) reports `could-not-parse` and stops. It is never treated as "no flag" or "proof present".
  - The check also runs on the trivial-plan and fast-lane skip paths (`--risk-proofs`), because that is where a missing proof would pass silently.
  - A flagged record never takes the micro-plan path, and the express lane refuses it (`record carries a kept risk flag`), because neither composes a plan the audit could check. A record with no flags, or `Risk-flags: none`, builds exactly as before.
- **Red flags:**
  - A flagged record built on the micro-plan path or merged by the express lane.
  - A skip-path plan that passes with no proof.
  - A proof line satisfied by a restated category name or by a fenced example.
  - A `could-not-parse` result reported as a pass.
  - A new failure for a record with no flag line.

### 5. Read the Risk proofs section at acceptance
- **URL:** the acceptance packet posted by `/claude-tweaks:wrap-up`, as shown by `/claude-tweaks:demo #N`
- **Action:** Read the packet's Risk proofs section before giving a verdict.
- **Should feel:** Honest. You can see what the plan promised for each risk and that nothing has yet run it, so you know what to verify yourself.
- **Should understand:**
  - A proof comes from the plan's `Proof(<slug>)` line and is a `not-run` fact, so it renders as `planned, not verified: …`. Only a proof that a recorded check actually passed renders as verified.
  - A line that cites a flag no human confirmed ends in `(flag unconfirmed)`. The label comes from the flag fact, so no narrator can leave it out.
  - A kept flag with no proof behind it still shows, as `- {slug}: no proof shown`, never silently omitted.
  - With no kept flags the section says `not applicable: no kept risk flags`. If the flags input could not be read it says so, instead of claiming there are none.
  - When wrap-up has no plan copy or the plan could not be parsed, the summary says the risk proofs were not read, which is different from no proof written.
- **Red flags:**
  - A planned proof presented as verified.
  - An unconfirmed flag with no label.
  - A kept flag missing from the section.
  - A missing plan copy reported as "no proof written".
  - A kept flag reading `no proof shown` when wrap-up read no plan (absent or unparseable). It reads `proofs not read (the --proofs input did not read)` then.

## Origin
- Created during build of #4618: risk flags at intent time (classify and keep-or-remove during `/claude-tweaks:specify`, headless keep-and-mark, plan-audit Check G, micro-plan and express-lane exclusion, the packet's Risk proofs section).
- Related journeys: `refine-the-backlog-through-decision-lanes.md` (the human-present confirmation of unconfirmed flags), `ship-a-small-record-on-the-express-lane-4025.md` (a flagged record is ineligible), `accept-built-work-via-demo.md` (where the packet is read).
- Related specs: #4619 (diff tripwire, the backstop for an undeclared sensitive path), #4609 (control-mode policy keys; the `risk-categories` extension waits for `control-mode: on`).
