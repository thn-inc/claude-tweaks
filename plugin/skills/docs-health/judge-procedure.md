# Docs Health — JUDGE Procedure

The single canonical judging procedure for `/claude-tweaks:docs-health`, used by two callers:

- **Step 3 (JUDGE)** of `SKILL.md`, on the sequential `--budget 1` path — read this file and apply it in the main thread.
- **The parallel dispatch prompt** in `SKILL.md` Step 1, on the `--budget > 1` path — inline the body below **verbatim** into each Task agent's prompt. Agents only see what's in their own prompt; a pointer to this file does not reach them.

Both callers substitute the same four placeholders before use: `{target.path}` and `{target.id}` (from Step 1's selection), `{plugin-root}` (the resolved `$CLAUDE_PLUGIN_ROOT`), and `{root}` (the resolved `${ROOT:-$PWD}`).

Keeping this in one file is deliberate: it previously lived twice — once in Step 3 and once inlined in the dispatch prompt — which is exactly the "a contract restated twice, only one copy updated" failure mode CLAUDE.md's 40 KB SKILL.md ceiling exists to prevent. Edit here, never in a caller.

Everything below the horizontal rule is the inlinable body.

---

Apply the numbered procedure in this prompt to the content of `{target.path}`.

Reference — the four Diátaxis types and what each actually does:

| Diátaxis type | What it actually does |
|---|---|
| Tutorial | Walks a beginner through a concrete learning exercise, start to finish |
| How-to guide | Gives goal-directed steps to accomplish a specific task, assumes some competence |
| Reference | States facts — API shapes, config keys, field tables — with no narrative or step sequence |
| Explanation | Discusses why, context, background, tradeoffs — no steps, no fact tables |

Throughout, the bar for flagging anything is "would this actually mislead a reader or leave the doc's purpose unserved" — never an abstract mismatch, and never prose quality.

1. First, determine whether the doc has a self-evident non-Diátaxis-native genre — an ADR/decision-record (Status/Context/Decision/Consequences shaped), a structured spec or journey (Persona/Goal/Steps/Acceptance-Criteria shaped), or a dated retrospective/log. A directory name (`decisions/`, `adr/`, `journeys/`, `retrospectives/`) is a hint that raises attention, never a verdict on its own. If so, skip type classification: spot-check it still reads as its own native genre, and flag only if it has drifted out of that genre into something else.
2. Otherwise, determine the doc's **implied type** from its location/heading language ("Reference:", "How to...", "Getting Started", "Understanding..."), and its **found type** from what the content actually does (see the Diátaxis type table in this prompt). Flag a mismatch only when it would actually mislead a reader or leave the doc's purpose unserved — a `category: "genre-drift"` finding. Also flag unmarked forward-looking/roadmap content in a doc that reads as describing shipped, current functionality.
3. Separately, determine an implied type from the doc's **directory alone** (ignoring heading language entirely) and compare it against found type independently of point 2 — a correctly-titled doc can still sit in the wrong directory. A divergence here is also `category: "genre-drift"` (placement-fit), typically `classification: "restructural"`, since the fix is moving the file rather than editing a sentence.
4. Compute the doc's word count:

   ```bash
   node "{plugin-root}/bin/docs-health.js" word-count "{target.path}"
   ```

   The result is either an integer word count, or (if the doc's frontmatter declares `depth-hint:`) that value's literal string, returned as-is — ground truth, skip the word-count judgment entirely in that case. Otherwise, judge whether the computed word count is surprising given what the doc's location, heading, and native genre (from point 1) lead a reader to expect walking in — same "would this actually mislead" bar as point 2, never length by itself. A doc that is long or short but correctly signals its depth is never a finding. A surprising mismatch is a `category: "depth-mismatch"` finding.
5. Compute the doc's inbound-reference count:

   ```bash
   node "{plugin-root}/bin/docs-health.js" find-refs "{target.path}" --root "{root}"
   ```

   This counts references from `docs/**`, `README.md`, and `CLAUDE.md` only — it cannot see external links. Judge whether a near-zero count means a genuine orphan (a doc clearly written to be read, but with no path leading to it from anywhere in the project's own docs — blocks discovery) or an intentionally standalone doc (an explicit draft/archived/template marker, or one meant to be reached only by direct link from outside this scope). A genuine orphan is a `category: "findability"` finding.
6. Check every stated fact (counts, dates, paths, versions, availability claims) against live repository state (grep, `find`, `git log`). **Mandatory, not opportunistic:** for every literal shell command block the doc instructs the reader to run (a fenced example command, an install/setup snippet, a CLI invocation shown as copy-pasteable), actually execute it verbatim — do this for every such block regardless of whether the surrounding text already looks correct. **Bound the output:** redirect each command to a temp file (`cmd > /tmp/dh-$$.out 2>&1; echo "exit=$?"`) and inspect only the exit status plus `tail -20` of that file. The check is whether the command still works, not what it prints — an unbounded capture of something like `npm test` or `npm audit --json` can run to hundreds of KB, and none of it changes the verdict. Widen to the full temp file only when a command fails, or when its tail contradicts what the doc claims and the detail is needed to describe the contradiction. Grep/find/git-log cross-referencing alone cannot catch a command that now errors or produces output contradicting what the doc claims; a failing or contradicting command is a `category: "staleness"` finding on its own. Additionally, check any declared freshness-dependencies:

   ```bash
   node "{plugin-root}/bin/docs-health.js" check-freshness "{target.path}" --root "{root}"
   ```

   For each path in the result's `missing` array, that's a broken dependency — a staleness finding on its own. For each entry in `stale`, judge whether the tracked file's change is substantive enough to actually invalidate what the doc claims (a trivial reformat doesn't; a rewritten function signature does). A mismatch (stated fact, broken dependency, substantive tracked-file drift, or a failing/contradicting executed command) is a `category: "staleness"` finding.

   Before emitting any finding whose `newString` cites a commit hash — including the replacement for a commit-hash citation that no longer resolves — verify every commit hash in that `newString` against complete repository history:

   ```bash
   node "{plugin-root}/bin/docs-health.js" verify-commit <hash> [<hash> ...] --root "{root}"
   ```

   Each entry in the result's `commits` array carries an `outcome`: `reachable` (on the integration branch — safe to cite), `exists-unreachable` (a real commit that is not on the integration branch), `not-found`, `ambiguous` (an abbreviated hash matching several commits — re-run with the full hash), `invalid`, or `unverifiable` (history could not be completed, eg a shallow clone that could not be deepened — no verdict, and never read it as `not-found`). Cite a hash as fact only when its outcome is `reachable`; for any other outcome, either drop the hash from `newString` or state explicitly in `newString` that the commit is unreachable from the integration branch or could not be verified, and name the outcome in `reason`.

7. For every finding, judge `misleads`: `"human"` (a skim-and-notice-caveat reader partially self-corrects), `"agent"` (retrieval-style consumption — a chunked search hit, not a full read-through — has no such safety net; weight this higher), or `"both"`.
8. Judge `classification`: `"additive"` (a one-line fact correction, an added disclaimer) or `"restructural"` (reorganizing a doc that mixes genres, splitting a doc, moving a file).
9. Judge `confidence`: `"high"` when the evidence is mechanical and directly checkable — a stated count/date/path/version contradicted by live `grep`/`find`/`git log` output, a `check-freshness` `missing` entry, or a genre that is self-evidently native (point 1); `"med"` when it rests on a judgment call a reasonable second reviewer could see differently — a depth-mismatch or genre-drift call resting on heading language, or an inbound-reference count judged as a genuine orphan vs. intentionally standalone; `"low"` when the evidence is circumstantial or the doc's own intent is ambiguous — a `check-freshness` `stale` entry whose substantiveness is itself a judgment call, or a placement-fit divergence in a doc that could plausibly belong to either genre. This value drives whether the finding is filed or merely captured, so calibrate honestly, not optimistically.
10. Judge `reversibility`: `"high"` for a pure addition or a swap of one stated fact for another (`oldString` empty, or a narrow factual substitution); `"med"` for a multi-sentence rewrite that changes structure within one section; `"low"` for a `restructural` classification that reorganizes or splits the doc — the harder a finding's fix would be to cleanly undo, the lower this value.

Do NOT flag: prose quality, clarity, or pacing (content quality is out of scope); length by itself, absent a mismatched expectation; broken links, malformed frontmatter, or missing structural metadata (those belong in the project's own CI).

Bundling rule: when two or more findings in this doc share both the same `category` and the same root-cause explanation, emit one finding, not one per section. Pick the clearest occurrence as the primary `section`, list every other occurrence in `relatedSections`, make `reason` state the shared root cause explaining all of them, and make `description` require every listed section fixed. Only bundle occurrences sharing both `category` AND the root cause.

Emit each finding in this shape:

```json
{
  "target": "{target.id}",
  "assetType": "doc",
  "section": "<heading within the doc, or 'Freshness' for a whole-doc staleness finding>",
  "relatedSections": "<optional array of sibling section names sharing this finding's root cause; omit if there's only one occurrence>",
  "category": "genre-drift | depth-mismatch | findability | staleness",
  "misleads": "human | agent | both",
  "classification": "additive | restructural",
  "confidence": "high | med | low",
  "reversibility": "high | med | low",
  "description": "<acceptance criteria text>",
  "reason": "<evidence — why this was flagged>",
  "oldString": "<current text, or empty string for a pure addition>",
  "newString": "<proposed text>"
}
```
