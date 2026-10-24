# Open Items — #4006 Chunked per-suite stamps and the generated-path exemption are never read by the gates that should skip re-verification

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 5 commits ahead of local main at Step 2.5 | observation | Post-creation catch-up fast-forwarded the worktree branch to origin/main (18a9fa1c8) before any commit |
| 2 | build | SDD ruling — AC5.1 fixture runs one unscoped full pass after committing the unparseable declaration, so the bare verdict is shown to come from the single stamp: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 3 may trim redundant words in verification.md's consumer paragraph to fit the suiteComposed mention under the Read rail: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 2's incomplete-composition fixture changed to verifiedHead:true + complete:false so it discriminates the complete===true clause: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | verify.js stampStatus — the `!discovered` guard on the scopeRead.missing branch is reached only by a dangling-symlink default declaration (lstatType passes it, readDeclaration reads ENOENT); no test exercises that path | fixed | Review fix fb7614a32: discovery now requires the leaf to resolve inside the checkout, so a dangling symlink reports scopeError before readDeclaration and is tested |
| 6 | build | AC4.1 asserts the 16-key order + null fields rather than byte-identity against a pre-change capture | deferred | — |
| 7 | build | A dangling symlink at the default declaration path reads as absent (silent, via the row-5 guard) rather than as a scopeError — consistent with missing-is-silent; an unreadable leaf now reports (discovery gates on path-guard lstatType since Common Step 5's fix) | fixed | Review fix fb7614a32: a dangling or out-of-tree symlinked declaration now reports scopeError ("does not resolve to a path inside this checkout"), with discriminating tests |
| 8 | build | Two of Task 2's four new checkFirstCallStamp tests (stamp-absent, report-missing) are regression pins that pass pre-change, not red-first proofs | deferred | — |
| 9 | build | first-call-artifact-check test title 'does not bypass the single-stamp checks' now mostly exercises the complete===true clause | deferred | — |
| 10 | build | Prose conformance test checks the Step 1.5 slice as a whole — deleting only one of the two suiteComposed additions (flow vs standalone branch) still passes | deferred | — |
| 11 | build | Prose conformance go-red control does not exercise the two-call-gate fragment assertion | deferred | — |
| 12 | build | code-mode-steps.md Step 1.5 printed-envelope list omits suiteComposed/scopeError/liveGeneratedExempt/preExistingAdjudicated (pre-existing, pinned verbatim by review-step1-5-verifiedhead-gate) | deferred | — |
| 13 | build | Journey Step 17 calls flow preflight's stamp probe and dispatch's note-only check 're-verify gates [that] skip a re-run' — imprecise | deferred | — |
| 14 | build | Journey change-log line for #4006 leaves identifiers unbackticked (plan-mandated wording) | deferred | — |
| 15 | build | task-prompt.md's added composed-verdict clause is one ~190-char line amid ~100-col prose; the following 'the stamp is absent' sentences are ambiguous about composed verdicts | deferred | — |
| 16 | build | verification.md:32 Skip-if-recent note template renders 'runner stamp null (null) … report: null' on a composed-only verdict and its parenthetical omits suiteComposed — needs the bytes #4059's split frees | deferred | — |
| 17 | build | code-mode-steps.md Step 1.5 flow-branch verifiedHead:true parenthetical opens 'a clean HEAD covered by…' without naming the generated-only (liveGeneratedExempt) case — cancels nothing, literal-reader ambiguity only | deferred | — |
| 18 | build/skill | Plan Task 3 mandated a literal skill-size cap (`<= 52497`) in a new conformance test, contradicting `.claude/skills/single-source-constant-guard` (decision 0024: only budgets.js holds a skill-size number) — caught by the whole-branch review, fixed in e01ba22d1; plan-authoring-checks' Byte-pin check names the rail but not the single-source test | observation | — |
| 19 | review | [medium, Security] verify.js stampStatus discovery trusted any non-missing default declaration, so a committed symlink to an out-of-tree file could widen `generated` or shrink suites without dirtying the tree under a verified verdict | fixed | fb7614a32 — resolveWithin the checkout root required; outside/dangling symlink reports scopeError |
| 20 | review | [low, Convention] verify.js re-typed the default declaration path instead of declaration.js's DECLARATION_PATH | fixed | fb7614a32 — DECLARATION_PATH exported and reused |
| 21 | review | [low, Test] AC5.1's self-cover case asserted only a non-null scopeError | fixed | fb7614a32 — matches the refusal message |
| 22 | review | [low, Test] prose-conformance go-red controls used bare assert.throws | fixed | 58e3fe4a3 — each control matches its assertion message |
| 23 | review | [info, Docs] verify.js per-suite record comment named only `--stamp-status --scope` as the composition path | fixed | 22a755926 |
