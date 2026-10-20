# Review Fix-Wave Ephemeral Server Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review's fix waves stop the run's ephemeral server before re-verifying (which may rebuild the app it serves), restart it once afterwards only when a later review step still drives a browser, and tell fix agents not to build/test/serve.

**Architecture:** Prose-only change to three skill files plus one `node --test` conformance suite. A new `## Fix-wave server coordination (pipeline runs)` section in `review/step3-routing.md` owns the stop → re-verify → restart sequence, reusing `wrap-up/cleanup-procedures-execution.md` Section D (stop) and `_shared/dev-url-detection.md`'s Ephemeral server start (restart). Every fix path cites it.

**Tech Stack:** Markdown skill files; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T201758-record-3021/work/3021-spec.md` (record #3021)

Scope keywords: ephemeral-server.txt, Fix-wave server coordination

## Global Constraints

- Reuse the existing ephemeral start/stop procedures from `dev-url-detection.md` / wrap-up Section D; never hand-roll a kill.
- `ephemeral-server.txt`'s worktree field must match this checkout before stopping anything — a sibling run's server is never killed.
- Rewriting `ephemeral-server.txt` goes through a plain Bash redirect into the main checkout's run dir (`[IL-127]`), never a worktree-relative path.
- Restart once after the whole fix batch re-verifies, never per finding.
- The fix-agent line stays a separate rule from #3001's `READ-ONLY REVIEW:` line, worded consistently ("test suites, builds, dev servers, or e2e runners"); it must never forbid the dispatcher's own re-verify.
- A standalone review (no run dir → no `ephemeral-server.txt`) behaves exactly as today.

## Review Focus

1. A run dir whose `ephemeral-server.txt` names another worktree → must be left alone (pinned by the `git rev-parse --show-toplevel` / "leave it alone" assertions).
2. Recorded pid already dead → stop step must not fail (Section D step 3 "already stopped" — cited, pinned by the "steps 2-4" citation).
3. No later browser step → server stays stopped and the stale line is gone (Section D step 4 deletes the file; pinned by the "leave the server stopped" assertion).
4. Step 6.7's QA re-run (item 4) runs after the fix wave → restart must happen before it (pinned by the Step 6.7 assertion).
5. Parallel fix agents running their own suites → the verbatim FIX AGENT line (pinned, plus wording parity with #3001).

## Plan-authoring check results

- **Byte-pin:** `RAIL_BYTES` = 52,500. `step3-routing.md` 26,424 B (+~3.2 KB → ~29.6 KB, 44% headroom left); `code-mode-steps.md` 44,148 B (+~0.4 KB → ~44.6 KB, ~15% headroom); `dev-url-detection.md` 20,224 B (+~0.4 KB). None near the rail.
- **Prohibition-vs-existing-mandate:** `grep -rn -i "fix agent\|fix-agent" plugin/skills/` → only `review/step3-routing.md`. The parallel-dispatch bullet tells agents "specific file scope, finding details, constraint to not modify other files. Returns summary of changes" — no run/verify mandate. `_shared/subagent-dispatch-core.md`'s Read-only Reviewer Discipline says it "never applies to an implementer, test, or QA dispatch" — a scope statement, not a mandate; left untouched (Gotcha: do not merge the two rules).
- **Behavioral claims:** (a) "Section D steps 2-4 stop it, count an already-gone pid as stopped, confirm the port free, delete the file" — `wrap-up/cleanup-procedures-execution.md:313-317`. (b) "a later phase that needs a browser starts its own" — `_shared/dev-url-detection.md` Step 3 row "No usable server + dev command known — auto mode → Start an ephemeral dev server". (c) "Ephemeral server start item 4 rewrites `ephemeral-server.txt` by plain Bash redirect" — `dev-url-detection.md:138`.
- **Moved-prose pins:** edits are in-place insertions; tests reading `step3-routing.md` (`multi-agent-coordination`, `deferral-gate-conformance`, `subagent-status-line-prose-conformance`, `step3-routing-prose-exempt-conformance`, `review-dispatch-composition`, `staged-patch-contract`, `materiality-floor-conformance`, `manifesto-overrides-ceiling-conformance`, `review-vacuity-evidence-conformance`, `policy-schema`) assert on text this plan does not move or reword.
- **Reachability:** the stop is reached from every fix path because each path's own sentence (AUTO bullet, Fix-now paragraph, parallel dispatch, Step 4 reflect re-run, Step 6.7 item 2) names the section at the point it acts; the test pins those references and the stop < re-verify < restart order.
- **Out of scope (follow-up):** `/claude-tweaks:simplify`'s own post-change verification (review Step 5) also re-verifies under a live server; it runs inside another skill used outside review too — filed as a follow-up, not folded in.

---

### Task 1: Conformance suite + prose for fix-wave server coordination

**Files:**
- Create: `tests/review-fix-ephemeral-server-conformance.test.js`
- Modify: `plugin/skills/review/step3-routing.md` (AUTO bullet `:56`; Fix-now paragraph `:117`; new section between `:117` and `## Parallel fix dispatch`; Parallel fix dispatch `:123`)
- Modify: `plugin/skills/review/code-mode-steps.md` (Step 4 reflect line `:280`; Step 6.7 item 2 `:348`)
- Modify: `plugin/skills/_shared/dev-url-detection.md` (Cleanup "In a pipeline" bullet `:178`)

**Interfaces:**
- Produces: the section heading literal `## Fix-wave server coordination (pipeline runs)` and the verbatim prompt line `` `FIX AGENT: do not run the project's builds, test suites, dev servers, or e2e runners — make the edits and report them; the dispatcher re-verifies.` ``

- [ ] **Step 1: Write the failing test** `tests/review-fix-ephemeral-server-conformance.test.js`

Read files with `fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', ...))`. Helper `section(text, heading)` slicing from `heading` to the next `\n## ` (assert the heading exists). Factor every step3-routing assertion into `assertRouting(text)` so the go-red controls run the identical code.

`assertRouting(text)`:
- `sec = section(text, '## Fix-wave server coordination (pipeline runs)')`
- `sec` includes each of: `ephemeral-server.txt`, `git rev-parse --show-toplevel`, `leave it alone`, `wrap-up/cleanup-procedures-execution.md`, `Section D's steps 2-4`, `Never hand-roll a kill`, `Ephemeral server start`, `plain Bash redirect`, `[IL-127]`, `once per wave`, `standalone review behaves exactly as before`, `leave the server stopped`, `Step 6.7 item 4`
- order inside `sec`: `indexOf('**Stop before the wave builds.**') < indexOf('**Re-verify.**') < indexOf('**Restart once, only if a browser step is still ahead.**')`, all `> -1`
- section sits before parallel dispatch: `text.indexOf('## Fix-wave server coordination') < text.indexOf('## Parallel fix dispatch')`
- the Fix-now paragraph (line starting `If any findings are "Fix now"`) contains `Fix-wave server coordination`
- the AUTO bullet (line starting `- **AUTO**`) contains `Fix-wave server coordination`
- `par = section(text, '## Parallel fix dispatch')` contains `Fix-wave server coordination` and a line matching `FIX_LINE = /FIX AGENT: do not run the project's builds, test suites, dev servers, or e2e runners — make the edits and report them; the dispatcher re-verifies\./`; that line is not inside the ```` ```markdown ```` Output-template fence (index of the FIX AGENT line < index of `**Output template`)

Tests (cite AC clause ids in names):
- `AC1.2, AC3.2: step3-routing.md carries the stop → re-verify → restart section, reached from every fix path` → `assertRouting(read('review','step3-routing.md'))`
- `AC3.1: the fix-agent prompt line is verbatim and worded like #3001's READ-ONLY REVIEW line` → FIX_LINE matches; `_shared/subagent-dispatch-core.md` still matches `/never run the project's test suites, builds, dev servers, or e2e runners/`; the FIX AGENT line does not contain `READ-ONLY REVIEW`; and `section(core,'## Read-only Reviewer Discipline')` does not contain `FIX AGENT` (rules stay separate).
- `AC1.1: code-mode-steps.md routes Step 4 and Step 6.7 fix waves through the coordination` → the line starting `If the reflect skill produces "Change now" fixes` contains `Fix-wave server coordination`; `section(cms, '## Step 6.7')` contains `Fix-wave server coordination` and `item 4`.
- `AC1.2: dev-url-detection.md Cleanup names the rebuild exception and points at the review step` → `section(dud, '### Cleanup')` (slice to next `\n### ` or `\n## `) contains `rebuilds the served app` and `review/step3-routing.md`.
- `AC2.1: Section D still stops whatever ephemeral-server.txt currently names` → `cleanup-procedures-execution.md` includes `read whatever it currently names` and `Confirm the port is free, then delete \`ephemeral-server.txt\``.
- `AC4.1: the coordination is a no-op without a run dir` → `section(...)` includes `no run directory or no such file`.
- Go-red controls (each `assert.throws(() => assertRouting(mutated))`):
  - section removed: `text` with the slice from `## Fix-wave server coordination` to `## Parallel fix dispatch` cut out
  - order swapped: `**Restart once, only if a browser step is still ahead.**` and `**Stop before the wave builds.**` labels exchanged via a placeholder swap
  - FIX AGENT line removed: every line containing `FIX AGENT:` filtered out

`Waived AC5.1: npm test passing is verified by Common Step 5's full run, not a unit test.`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-fix-ephemeral-server-conformance.test.js`
Expected: FAIL (`missing heading: ## Fix-wave server coordination (pipeline runs)`)

- [ ] **Step 3: Edit `plugin/skills/review/step3-routing.md`**

3a. AUTO bullet (`:56`) — after `Auto-apply the fix. Commit.` insert ` The wave's re-verify runs under Fix-wave server coordination below.` (rest of the bullet unchanged).

3b. Fix-now paragraph (`:117`) becomes:

`If any findings are "Fix now", make the changes, re-verify per \`_shared/deferral-gate.md\`'s Re-verification rule (\`/claude-tweaks:test\`), and verify fixes didn't introduce new findings. In a pipeline run, wrap the wave in Fix-wave server coordination below — stop the run's ephemeral server before the re-verify, restart it once afterwards when a browser step is still ahead.`

(Keep the existing first sentence byte-identical; only append the second sentence.)

3c. Insert this section after that paragraph, before `## Parallel fix dispatch (3+ independent fixes)`:

```markdown
## Fix-wave server coordination (pipeline runs)

Every fix wave in this review — AUTO-applied fixes, interactive "Fix now", the parallel fix dispatch below, Step 4's reflect "Change now" re-run, and Step 6.7's late-findings routing (both in `code-mode-steps.md`) — re-verifies with `/claude-tweaks:test`, and a suite that builds the app (`next build` rewriting `.next`, say) swaps the build out from under the run's ephemeral server (`_shared/dev-url-detection.md`'s Ephemeral server start). Every later browser step is then served a replaced build, and nothing fails loudly (#3021). So, once per wave, never per finding:

1. **Stop before the wave builds.** Before the wave's first fix-agent dispatch, or before its re-verify when the main thread applies the fixes itself, read `{run-dir}/ephemeral-server.txt`. With no run directory or no such file, skip this whole section — a standalone review behaves exactly as before. When the file's third field (worktree root) is not this checkout's `git rev-parse --show-toplevel`, leave it alone: that server belongs to another worktree. Otherwise stop it with `wrap-up/cleanup-procedures-execution.md` Section D's steps 2-4 — the platform-aware kill wrap-up already uses, an already-gone pid counted as stopped, the port confirmed free, the file deleted. Never hand-roll a kill.
2. **Re-verify.** Run the wave's re-verify as usual.
3. **Restart once, only if a browser step is still ahead.** When step 1 stopped a server and a later step of this review still drives a browser — Step 6's visual review not yet run in full mode, or Step 6.7 item 4's QA re-run — start a fresh one through `dev-url-detection.md`'s Ephemeral server start, detached per its Ownership rule. Its item 4 writes the new pid to `ephemeral-server.txt` with a plain Bash redirect into the main checkout's run dir — never a worktree-relative path, which would shadow it and leave Section D killing the old pid (`[IL-127]`) — so wrap-up's Section D stops the server current at end of run. When no later review step needs a browser, leave the server stopped: step 1 already deleted the stale line, so Section D has no dead pid to kill, and a later phase that needs a browser starts its own through `dev-url-detection.md`'s Step 3 (no usable server, dev command known), the path any first use takes.
```

3d. Parallel fix dispatch (`:123`): change `Each agent gets: specific file scope, finding details, constraint to not modify other files.` → `Each agent gets: specific file scope, finding details, constraint to not modify other files, and the FIX AGENT line below.`; change `After all agents complete, check for conflicts between agent changes, then re-run \`/claude-tweaks:test\`.` → `After all agents complete, check for conflicts between agent changes, then re-run \`/claude-tweaks:test\` — the run's ephemeral server already stopped before the dispatch, per Fix-wave server coordination above.` Then insert, after the Model profile blockquote paragraph and before `> **Output template`:

```markdown
> **No-build line (required):** Inline this line verbatim into every fix-agent prompt, outside the Output template block:
>
> `FIX AGENT: do not run the project's builds, test suites, dev servers, or e2e runners — make the edits and report them; the dispatcher re-verifies.`
>
> It is the fix-path counterpart of `_shared/subagent-dispatch-core.md`'s Read-only Reviewer Discipline (#3001), kept a separate rule: it binds the dispatched fix agents, never the dispatcher's own re-verify, which is what Fix-wave server coordination wraps.
>
```

- [ ] **Step 4: Edit `plugin/skills/review/code-mode-steps.md`**

- `:280` → `If the reflect skill produces "Change now" fixes, re-run \`/claude-tweaks:test\` before proceeding — under \`step3-routing.md\`'s Fix-wave server coordination, the same as a Step 3 fix wave.`
- Step 6.7 item 2 (`:348`): append ` The fix wave runs under that file's Fix-wave server coordination, which restarts the run's ephemeral server before item 4's QA re-run when it stopped one.`

- [ ] **Step 5: Edit `plugin/skills/_shared/dev-url-detection.md`** — in Cleanup's "In a pipeline" bullet, after `The calling skill does not stop it mid-pipeline — later steps may also need it.` append ` The one exception is an in-pipeline step that rebuilds the served app: it must stop the server before the rebuild and restart it afterwards when a browser step is still ahead — \`review/step3-routing.md\`'s Fix-wave server coordination does this for review's fix waves.`

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/review-fix-ephemeral-server-conformance.test.js`
Expected: PASS (all tests, including the three go-red controls)

Also run the suites that read the edited files: `node --test tests/multi-agent-coordination.test.js tests/deferral-gate-conformance.test.js tests/subagent-status-line-prose-conformance.test.js tests/step3-routing-prose-exempt-conformance.test.js tests/review-dispatch-composition.test.js tests/review-lens-no-suites-conformance.test.js tests/staged-patch-contract.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/review-fix-ephemeral-server-conformance.test.js plugin/skills/review/step3-routing.md plugin/skills/review/code-mode-steps.md plugin/skills/_shared/dev-url-detection.md
git commit -m "Coordinate review fix waves with the run's ephemeral server — stop before re-verify, restart once when a browser step remains (refs #3021)"
```

## Revisions during execution

- Fix round 1: after the wave's re-verify, step 3 re-reads `ephemeral-server.txt` and reuses a live server for this checkout (the re-verify's own QA started it) instead of starting a duplicate. (Superseded by the lazy-restart wave below; the reuse idea now lives in `dev-url-detection.md`'s detection.)
- Fix round 1: the FIX AGENT line's list order is aligned with #3001's READ-ONLY REVIEW line (`test suites, builds, dev servers, or e2e runners`); the parallel-dispatch sentence about the stopped server is conditional on one having been running for this checkout.
- Final whole-branch fix wave:
  - Spaced paths: the worktree root is everything between the port (second field) and the trailing `detached:` token, not the third field.
  - Lazy restart: the coordination no longer starts a server; the next browser step (Step 6 full mode, Step 6.7 item 4, or a later phase) restarts it through `dev-url-detection.md`'s Ephemeral server start.
  - Steps 4 and 5: the stop (coordination step 1) applies before invoking `/reflect` and `/simplify`, which re-verify internally, as well as before Step 3's and Step 6.7's waves.
  - Stop failure: a real Section D stop failure logs `SKIP` via `log-decision.js` (degrade-trace rule) and the wave proceeds.
  - `dev-url-detection.md` header and "When This Runs" no longer claim `/review` never touches the procedure.
  - `docs/skill-graph.md` `## review`: the `/wrap-up` row names the Section D steps 2-4 reuse; a `_shared/dev-url-detection.md` row is added.
