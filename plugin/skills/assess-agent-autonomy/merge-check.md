# Mode: merge-check

**Called from:** `/claude-tweaks:dispatch`'s Auto-merge gate, replacing layers 2-4 (scoring
eligibility, runtime cleanliness, blast radius) entirely. Layer 1 (authorization — `auto:merge`
present on every group member) stays a hard binary gate in `dispatch/SKILL.md` itself, unchanged.

## Step 1: Gather

The calling agent has just finished this run's build, test, and review — the diff and review
verdict are already in its own context. Confirm rather than re-derive where possible. The merge
base is the commit this run's worktree branched from — the same base the pipeline's own build
started from.

- **If the caller passed `--base <ref>`** (see Input — e.g. one of dispatch's per-group Task
  calls, which ran `/flow` inside its dispatching session's worktree, often already knows this
  value), pass it through to the CLI below as `--base <ref>` and skip integration-branch
  resolution entirely — it names a merge-base commit, not a branch.

- **Otherwise**, resolve `INTEGRATION_BRANCH` per `skills/_shared/integration-branch.md` and pass
  it as `--integration-branch`. If nothing resolves — no `origin` remote, no `gh` auth, an
  offline or detached runner — stop here. This is the `could-not-gather` case (see
  `_gather-resilience.md`'s Could-not-gather section — the same shape `grant-check`/
  `failure-check`'s Step 1 use, minus the MCP-fallback parameter this mode has no equivalent
  for), not a hard crash. Render Step 3 directly: `VERDICT: needs-human` / `RATIONALE: {name the
  specific resolution failure, e.g. "could not resolve this project's integration branch"}`, and
  skip the rest of this mode's procedure.

The whole gather — merge-base resolution, the numstat diff, this project's
`merge-sensitive-paths`/`auto-merge-max-lines`/`auto-merge-max-files` config, and the
classification (`bin/lib/issues/blast-radius.js`) — is one CLI call, substituting the resolved
branch literally for `{integration-branch}` (or `--base <ref>` when the caller supplied one):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/blast-radius.js" --integration-branch {integration-branch}
```

It prints one JSON object: `mergeBase` (the resolved base commit), `config`
(`mergeSensitivePaths` list plus the two `autoMergeMax*` numbers, resolved from this project's
policy by the CLI itself), and `summary` (`implLines`/`implFiles`/`testLines`/`testFiles`/
`pipelineArtifactLines`/`pipelineArtifactFiles`/`sensitiveFilesTouched` — the last two excluding
a materialized spec or writing-plans doc from `implLines`/`implFiles`, #1906) — everything
Step 2 weighs.

**Pack-fed input (#1930).** When the caller's `Skill` args carry `--pack {run-dir}/wrap-up-pack.json` (or the pack's `blastRadius` object inlined as `--blast-radius '{…}'`), Step 1 takes `{mergeBase, config, summary}` from that value and does not run `blast-radius.js`. A field carrying `ok: false` (an unresolvable base) is this step's existing `could-not-gather` outcome → `needs-human`; it never triggers a fresh `blast-radius.js` call, because the pack's failure already represents the freshest attempt. With neither `--pack` nor an inlined object, the CLI call above runs exactly as before.

`{integration-branch}` above may be a bare name (e.g. `main`) even in a shared checkout whose
local ref has gone stale relative to `origin/{name}`: the CLI itself prefers the same-named
`origin/{name}` remote-tracking ref when one exists, falling back to the bare local ref only when
it doesn't (`bin/lib/blast-radius-cli.js`'s `preferOriginRef`, #1592) — this step does not need to
fetch-and-prefer-origin itself before calling it.

**A non-zero exit is a resolution failure, not a zero-radius diff.** The CLI hard-fails —
stderr, no JSON — when the merge base cannot be resolved, so a resolution failure can never be
read as a 0-file blast radius that clears every threshold (the silent-approval hazard the
previous multi-command shell choreography here guarded against with prose alone, #888). On a
non-zero exit, render Step 3 directly: `VERDICT: needs-human` / `RATIONALE: {the CLI's stderr
line}` — the same could-not-gather handling as the unresolvable integration branch case above.

Measuring from the integration branch rather than the GitHub default is what makes blast radius
mean the record's own change. Against a branch that diverged long ago, the merge base is ancient
and the diff spans every commit since the fork — which reads as an enormous change and returns
`needs-human` for a reason that looks legitimate and isn't (#132).

## Step 2: Judge

- **Sensitive-path hit is a hard floor.** If the CLI summary's `sensitiveFilesTouched` is non-empty, render
  `needs-human` immediately — do not weigh anything else. No content judgment overrides this.
- **An agent-instruction file is `needs-human` unless a refutation attempt clears it.** An
  agent-instruction file is any file this project's harness loads as *instruction* rather than as
  *subject matter*: `CLAUDE.md`/`AGENTS.md`, `.claude/rules/*`, `.claude/skills/**`,
  `.claude/agents/**`, and — in a repository that *is* a plugin, detected by the presence of
  `.claude-plugin/plugin.json` — its own `skills/**`/`agents/**` sources. Resolve the class by that
  role for the project at hand; do not match a fixed path list, which is wrong in every repository
  whose layout differs from the one it was written against.
  `_shared/harness-health-analysis.md` audits a related but narrower set for a different purpose
  (`.claude/skills/*.md`, `.claude/rules/*.md`, and `CLAUDE.md`, stated there as a fixed list) —
  read it as a floor for what counts, never as this class's definition. Instruction files encode
  instructions future agents follow, which is high-leverage independent of how small the diff looks.

  **The escape is a refutation, not a classification.** Do not ask "is this change mechanical?" —
  that phrasing invites agreement. Instead, try to name a concrete behavior an agent could take
  differently after the edit: an instruction it would now follow, skip, or apply at a different
  threshold; a claim it would now reason from. Render `auto-merge` only when a genuine attempt to
  name one comes up empty. If you can name any candidate — including one you are unsure about —
  render `needs-human`. A correction can be factually true and independently verifiable and still
  change what agents infer; truth is not the test, behavior delta is.
- **Weigh the summary's `implLines`/`implFiles` against the CLI-reported
  `auto-merge-max-lines`/`auto-merge-max-files` — but only once the diff is judged to carry behavior
  change at all.** The CLI's `summary` reports whole-diff totals; there is no per-hunk breakdown
  to weigh, which is why the judgment below is deliberately a binary on the whole diff rather than
  an attempt to size some behavior-carrying fraction of it. Size proxies review burden, not risk:
  a large diff in which every hunk is the same
  behavior-preserving transformation (a rename, a call site updated
  uniformly, dead code removed) is safer than a small one that changes a branch condition. So ask
  first whether the diff is behavior-preserving as a whole — a single hunk that is not an instance
  of the same transformation makes the whole diff behavior-carrying. When it is behavior-preserving
  and review is clean, exceeding the configured guideline is not by itself a reason to lean
  `needs-human`. When it carries behavior change, weigh the guideline as one input, not a cutoff —
  a diff comfortably under it (e.g. #18's 33 impl lines under a 40-line guideline) supports
  `auto-merge` when review is clean; well past it is a reason to lean `needs-human`, but not an
  automatic disqualifier the way the old mechanical gate was. `testLines`/`testFiles` are
  informational only — never weigh test-file bulk toward risk.
- **Weigh the diff's actual content**, not just its size or file list: does it touch concurrency,
  locking, auth, or external API calls in a way that looks structurally sensitive even outside the
  configured `merge-sensitive-paths` list? Treat that as elevated risk from content, the same way a
  human reviewer would flag it on sight.
- **Review's findings are a hard input, not advisory**: if this run's `/claude-tweaks:review` pass
  produced anything at Medium severity or above, render `needs-human` — this mode never overrides a
  real review finding.

### Calibration

Boundary cases are stated as shapes, not as issue references — an issue closes and its defect gets
fixed, and calibration anchored to one then describes a state that no longer exists.

| Change | Verdict | Why |
|--------|---------|-----|
| A skill's factual claim corrected — e.g. state described as independent, corrected to a shared singleton | `needs-human` | True, verifiable, and still changes how agents reason about concurrency. The case that kills "verifiable therefore safe". |
| A threshold, budget, or cap literal changed | `needs-human` | Reads as a number correction; directly changes what agents do at the limit. "Small and numeric" is not a safety signal. |
| A section reworded so an existing instruction reads more strongly or more weakly | `needs-human` | No instruction added or removed, yet the threshold for following it moved. |
| A stale cross-reference repaired after a file split — `above`/`below` pointers, a moved path, a renamed anchor | `auto-merge` eligible | Pointer repair. The refutation attempt comes up empty: no agent acts differently, it just finds the target. |
| A dead pointer deleted, nothing replacing it | `auto-merge` eligible | Removes an instruction that could not be followed. Confirm nothing else cited the removed target. |
| A behavior-preserving rename spanning many files, review clean | `auto-merge` eligible | Uniformly one transformation. Exceeding `auto-merge-max-lines` is review burden, not risk. |
| A rename spanning many files where one hunk also changes a default | `needs-human` | One non-conforming hunk makes the whole diff behavior-carrying — the guideline binds again. |

`auto-merge` eligible means the refutation attempt came up empty for the agent-instruction floor
alone — necessary, never sufficient. Both floors stated above still apply on their own terms: a
sensitive-path hit renders `needs-human` with nothing else weighed, and so does any review finding
at Medium or above. Match a row here and you have cleared one gate, not the step.

**Ruling on the reworded-instruction / cross-reference-repair overlap.** A diff that both
relocates a pointer and rewords surrounding prose is not a gap in these two rows — it fails the
refutation test above on its reworded half alone (name a behavior an agent could take
differently; a diff where any hunk fails that test is behavior-carrying as a whole, per the
one-non-conforming-hunk rule in the table above), independent of which Calibration row its pointer-repair
half would otherwise match. The two rows stay distinguished by their Why column because that is
sufficient: Step 2's refutation test and the one-non-conforming-hunk rule already resolve any
diff that would straddle both.

## Step 3: Render

```
VERDICT: auto-merge | needs-human
RATIONALE: {one paragraph, naming the specific factors weighed}
```

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Overriding a Medium+ review finding because the diff otherwise looks safe | `merge-check` never overrides a real review finding — they're a hard input, not advisory. |
| Weighing test-file line count toward risk in `merge-check` | Test-line bulk isn't implementation risk; `testLines`/`testFiles` are informational only. |
| Skipping the sensitive-path hard floor because the content judgment "looks fine" | A floor exactly because content judgment isn't sufficient signal there — never overridden. |
| Rendering `auto-merge` on an agent-instruction change without attempting to refute it | The escape is a refutation attempt, not a classification: name a behavior an agent could take differently; pass only if it comes up empty. "Looks small and tidy" isn't an attempt. |
| Treating a correction as safe because it is factually true and verifiable | Behavior delta is the test, not truth — a claim corrected wrong→right still changes what agents reason from. |
