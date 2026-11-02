# Tiebreak resolver: skill-relative Locations (#4164) Implementation Plan

**Goal:** A correct tiebreak verdict citing `plugin/skills/{path}` for a finding whose Location is the skill-relative `{path}` resolves to the judge's verdict instead of `evidence-path-mismatch`.

**Architecture:** One normalization at the top of `evidenceProblem`, used by its path equality check and its `readFile` call. The finding object is never mutated, so `findingId`, the logged `where` string and the drop line keep the finding's own Location.

**Tech Stack:** Node, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T132642-record-3982/spec-4164/work/4164-spec.md`

## Global Constraints

- Canonical path: the path as given when it starts with `plugin/`, else `plugin/skills/{path}` only when `evidence.path` equals that. Do not widen to other prefixes (`plugin/bin/`, `tests/`).
- Do not canonicalise the finding object itself: `findingId` hashes `finding.path`, and tiebreak ids and `checkRunTiebreakCoverage` matching would shift for existing runs.
- The logged `where` string and the refuted drop line keep using `finding.path`.
- `--root` confinement in `plugin/bin/review-coordination.js` stays unchanged. The canonical path is still repo-relative, and its `resolveWithin` reader takes it as is.
- `plugin/skills/review/step3-tiebreak.md`'s "cite the Location path exactly as given" stays unchanged (spec Gotchas; pinned by `tests/review-tiebreak-step-conformance.test.js`): the resolver absorbs the difference, not the template.
- Governing project skill `fact-validated-narration`, quoted: "Every other case — a `could-not-parse` reply, a non-`DONE` status, missing evidence, a path mismatch, a quote the window does not contain — resolves to can't-tell, never to confirmed or dropped." and "Pin both directions in `tests/bin-lib/tiebreak.test.js`." Task 1's mismatch tests are the second direction.
- Governing project skill `parse-signal-discipline` (`fix-shape-late-items.md`) concerns `parseEvidence`'s literal-prefix match on the finding's own path. No parser change here: a skill-relative Location holding a space, cited by its full path, still fails `EVIDENCE_RE` and resolves can't-tell. That fails toward scrutiny, and no skill directory holds a space.

## Review Focus

- A finding already under `plugin/` whose Evidence prefixes `plugin/skills/` onto it must stay a mismatch, even when the reader would serve that path. Pinned in Task 1.
- A skill-relative finding whose Evidence repeats the path exactly as given must keep verifying against that path. Pinned in Task 1.
- A refuted verdict takes the same path check as a confirmed one. Pinned in Task 1.
- The tiebreak id and the logged Location must not move to the canonical path. Pinned in Task 1.
- A skill-relative finding whose canonical file is missing must read as `evidence-unverified`, never confirmed. Pinned in Task 1.

---

### Task 1: Canonicalise a skill-relative finding path inside `evidenceProblem`

**Files:**
- Modify: `plugin/bin/lib/tiebreak.js`
- Test: `tests/bin-lib/tiebreak.test.js`
- Waived `plugin/bin/review-coordination.js`: reference only; Global Constraints state why its reader needs no change.
- Waived `plugin/skills/review/step3-tiebreak.md`: spec Gotchas keep its template wording unchanged.

**Interfaces:** none across tasks.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/tiebreak.test.js`, beside the existing evidence-verification tests, using its `resolveTiebreak`, `findingId`, `reply` and `NOW`. Let `F = { lens: '3a', path: 'wrap-up/x.md', line: 10, claim: 'c', reporterSeverity: 'high', kind: 'unconfirmed' }`, and let `only(p)` be a reader that returns a 20-line file whose line 10 is `const answer = compute(input);` for path `p` and throws for every other path.

  - `AC1.1 AC1.2 skill-relative Location with full-path Evidence resolves confirmed`: `resolveTiebreak(F, reply({ evidence: 'plugin/skills/wrap-up/x.md:10 \`const answer = compute(input);\`' }), { readFile: only('plugin/skills/wrap-up/x.md'), now: NOW }).outcome === 'confirmed'`. This is the test that reads `evidence-path-mismatch` with the change reverted.
  - `same reply with verdict refuted resolves drop`: outcome `'drop'`.
  - `AC2.1 AC2.2 another file is still a mismatch`: Evidence `plugin/skills/review/x.md:10 ...` and Evidence `plugin/bin/x.md:10 ...` each give reason `'evidence-path-mismatch'`, with a reader that serves every path, so only the path check can decide.
  - `AC3.1 a plugin/ finding never gains the skills prefix`: finding path `plugin/bin/x.md` with Evidence `plugin/skills/plugin/bin/x.md:10 ...` gives `'evidence-path-mismatch'`, with a reader that serves every path. Deleting the `plugin/` guard turns this red, and no other test decides it.
  - `a skill-relative finding citing the path as given still verifies`: Evidence `wrap-up/x.md:10 ...` with `only('wrap-up/x.md')` gives `'confirmed'`.
  - `the canonical file missing is unverified`: Evidence `plugin/skills/wrap-up/x.md:10 ...` with `only('wrap-up/x.md')` gives `'evidence-unverified'`. This goes red if the read uses `finding.path`.
  - `the id and logged Location stay the finding's own`: on the confirmed result, `r.id === findingId(F)`, `r.logLine` contains `wrap-up/x.md:10`, and `r.logLine` does not contain `plugin/skills/`.
  - `AC4.1 a single-backtick wrap of a backtick-bearing line resolves confirmed`: finding `{ ...F, path: 'plugin/bin/foo.js' }`, source line 10 ``Run `foo` then `bar` now``, Evidence ``plugin/bin/foo.js:10 `Run `foo` then `bar` now` `` gives `'confirmed'`. This one is green at base by design (spec Deliverable 3 pins today's behavior).

  AC3.2 is covered by the existing cases in `tests/bin-lib/tiebreak.test.js` passing unchanged; AC5.1 by Common Step 5's suite run.

- [ ] **Step 2: Run to verify the new path tests fail**

  Run: `node --test tests/bin-lib/tiebreak.test.js`
  Expected: FAIL on the `AC1.1` and refuted tests with reason `evidence-path-mismatch`, and on the missing-file test. The `AC4.1` test passes.

- [ ] **Step 3: Implement** `canonicalFindingPath(findingPath, evidencePath) -> string` in `plugin/bin/lib/tiebreak.js`, not exported, directly above `evidenceProblem`, per Global Constraints' canonical-path rule. In `evidenceProblem`, compute it once at the top, then compare `evidence.path` against it and pass it to `readFile`. Extend the comment above `evidenceProblem` with one sentence stating that a legacy skill-relative Location matches its `plugin/skills/` Evidence path and is read through that path.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test tests/bin-lib/tiebreak.test.js tests/review-tiebreak-step-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
  Expected: PASS, 0 fail.

- [ ] **Step 5: Commit** both files by explicit path, subject `Accept skill-relative Locations in the tiebreak evidence check — refs #4164`.

---

## Self-review

- **Spec coverage:** Deliverable 1 is Step 3. Deliverable 2 and AC1 are the `AC1.1 AC1.2` test. Deliverable 3 and AC4 are the `AC4.1` test. AC2 and AC3 are their named tests. AC5 is Common Step 5.
- **Gotchas:** the id and logged Location test pins the `where` and `findingId` gotchas; Global Constraints carry the template gotcha.
- **Inline self-consistency:** not applicable; the plan inlines assertions and a signature, not a complete implementation.
- **Placeholders:** none.
