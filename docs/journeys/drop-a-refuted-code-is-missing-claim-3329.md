---
files:
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/step3-cross-lens-corroboration.md
  - plugin/skills/_shared/multi-agent-coordination.md
---

# Drop a Refuted "Code Is Missing" Claim

**Persona:** a developer who runs `/claude-tweaks:review`, usually inside `/claude-tweaks:flow`, at `medium` effort or above, and works through the Wrap-Up Review Console's Low-confidence section before merge.
**Goal:** when one agent of a reproduction pair claims a named function, export, parameter or file is missing, and the code actually has it, that claim never reaches the Console. It should not show up as a low-confidence item the developer has to chase down.
**Entry point:** `/claude-tweaks:review #{n}`, or the `review` phase of `/claude-tweaks:flow #{n}`, on a diff whose record carries a materialized plan that lists code to add.
**Success state:** the Console's Low-confidence section has no entry for the refuted claim. `decisions.md` carries one `AUTO … Reproduction: lens "{lens}" absence claim {path}:{symbol} refuted by ground-truth check ({command} found it at {path}:{line}). Not staged.` line naming where the construct was found.

## Steps

### 1. Run a review whose plan shows code to add — any session
- **URL:** `/claude-tweaks:review #{n}` with `review-effort` set to `medium` or above
- **Action:** let Step 3 dispatch each lens as a reproduction pair. One agent reads the plan's "add this code" listing and reports that code as missing. Its partner reports no such finding.
- **Should feel:** nothing different during the run. No new question, and no extra wait beyond one `grep -n`/`Read` per absence claim.
- **Should understand:**
  - Each lens agent's prompt tells it that a plan or spec's code blocks show code to add, not code that exists. It must `Read` or `grep -n` the live target file before reporting any claim about current code.
  - An absence claim can arrive as a findings row or as the stated reason of a `BLOCKED`/`NEEDS_CONTEXT` reply. Both are checked.
- **Red flags:**
  - The warning appears inside the byte-pinned Calibration/Output-template block.
  - A lens agent reports code missing with line numbers that match the plan file, not the source file.

### 2. Watch the unpaired absence claim get checked — the run's `decisions.md`
- **URL:** `.claude-tweaks/pipelines/{run-id}/decisions.md`, under the review section
- **Action:** find the line for the claim the partner agent did not reproduce.
- **Should feel:** settled. A one-command check answered the claim, so it never became a judgment call left for a human.
- **Should understand:**
  - The check passes only when the named construct appears in the claimed form: defined, exported, or taking that parameter. A bare token match elsewhere in the file does not count.
  - Found → the claim is refuted, logged `AUTO … Not staged.`, and dropped.
  - Not found, or an ambiguous hit → it stays `unconfirmed`, is staged as before, and goes on to Step 3.7's tiebreak.
  - At `medium`, the check runs before the cross-lens corroboration pass, so a refuted claim is never cross-lens input.
  - The check only refutes. Raising a finding to `confirmed` takes a `confirmed` Step 3.7 tiebreak verdict (`get-a-verdict-on-every-unverified-review-finding-3947.md`).
- **Red flags:**
  - A real defect ("`foo()` is missing parameter `timeout`") is logged as refuted because `timeout` appears in some other function.
  - The check reads the plan, spec or review bundle instead of the live file.

### 3. Work through the Low-confidence section — the Wrap-Up Review Console
- **URL:** the Review Console's Low-confidence subsection
- **Action:** scan the low-confidence items for the refuted claim.
- **Should feel:** the list holds only claims that still need a human. No item sends you to look for code that is already there.
- **Should understand:** every other kind of disagreement, such as a different defect, stays `unconfirmed` and goes to Step 3.7's tiebreak first. Only a finding the tiebreak could not settle, at `medium` severity or above, lands here. A confirmed one is routed, a refuted one is dropped, and a `low`/`info` can't-tell one goes to the digest. A pair that agrees on location and substance but splits across the severity buckets is not a disagreement: it is `confirmed` at the lower severity.
- **Red flags:**
  - The refuted absence claim still appears as a low-confidence item.
  - A genuinely missing construct (the grep found nothing) is absent from both the Console and `decisions.md`.

## Origin
- Created during the build of #3329. On #3249's review, one agent of lens 3a's reproduction pair returned `BLOCKED`, naming functions, exports and parameters as missing at line numbers drawn from the record's own materialized plan. Every one already existed in the live worktree. The pair mechanism flagged the disagreement but treated it as low-confidence, so it could have sent a human after a gap that did not exist.
- The fix added a dispatch-prompt warning against inferring code state from plan or spec listings. It also added a ground-truth check that refutes a contradicted absence claim before it is staged, recorded the refuted outcome in `_shared/multi-agent-coordination.md`'s Mode 1 table, and placed the check before the `medium`-tier cross-lens pass.
- Related journeys: `confirm-paraphrased-findings-across-reproduction-pairs-3418.md` (the anchor and substance matcher) and `trust-a-defect-several-review-lenses-flagged-3604.md` (cross-lens corroboration).
