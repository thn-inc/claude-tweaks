# Specify — Record Creation: Sub-issues (Step 3, continued)

Continues Step 3 from `record-creation.md` (this skill's directory) — Idempotency and Parent
record creation there, Sub-issue creation and Rules here. Loaded by `/claude-tweaks:specify` Step
3 onward, decomposition mode only. Step numbering is unchanged across the split (#1346), so a
cross-reference naming Step 3 by number still resolves regardless of which file it lands in. Every
session-scoped temp path below resolves per `_shared/session-tmp-root.md` — cited, not restated.

---

### Sub-issues

**Only sub-issues get `ready`** — and only sub-issues carry `risk:*`/`size:*` scoring; a kept parent gets neither. One per work unit from Step 2, in any order — Step 4 does the linking once every number exists, so creation order doesn't matter.

**Origin-set carve-out (1-unit collapse).** When Step 2.6 returned a 1-unit collapse *and* `$ORIGIN_RECORD_NUM` is set (`SKILL.md`'s `needs:definition` redirect, Resolve-the-input case 1), that unit gets **no fresh create**: compose its body exactly as below, then write it onto the origin record in place — `gh issue edit "$ORIGIN_RECORD_NUM" --body-file` plus the labels the create call would have applied and `--remove-label "needs:definition"` in the same edit; under `local-files`, `writeRecord` with those same facets and `facets.needsDefinition` cleared (the record is now defined — the redirect that routed here must not re-fire) — carrying the `{design-doc-slug}:{unit-slug}` fingerprint into that body so the Idempotency map above resolves it on any resumed run. **This write replaces the origin's own body, so preserve that body as a `## Original request` block in the composed one** — shaping mode's ground-truth rule (`shaping-mode.md`), and the last record of what was originally asked once Step 7 deletes the design doc. Treat `$ORIGIN_RECORD_NUM` as this unit's `$SUB_ISSUE_NUM`/`$SUB_ISSUE_ID` from here on: Step 4's linking, Step 5's red-team and Step 6's self-review all run against it as an ordinary produced record, and Step 9 then only skips its closure. With `$ORIGIN_RECORD_NUM` unset (every other entry path), a 1-unit collapse creates one fresh standalone ready record, exactly as below.

When a sub-issue proposes building a new `bin/` CLI, check for a same-named deliverable already
shipped or already proposed elsewhere before creating it — `_shared/issue-claims.md`'s
Deliverable-name-collisions section owns the check and the grep.

**Tasks never become records.** A sub-issue's internal breakdown — its Deliverables and Acceptance Criteria checklists — stays a checklist inside its own body; `/superpowers:writing-plans` turns it into an execution plan at build time, and nothing at this granularity spawns a further issue per task.

**Body** — spec-shaped per `spec-template.md`'s record body template, prefixed with the metadata block (`Surface: {value}` and, when the unit is frontend-flavored, `Design-intent: {value}` and `Ui-stack: {value}`) — the identical per-record procedure Shaping mode's Metadata block subsection already documents (`shaping-mode.md` in this skill's directory), just run once per sub-issue instead of once per shaped record. When Step 2.5b-ii's variant exploration ran and the user accepted a scaffold direction for this sub-issue's surface, also prefix `Visual-reference: {scaffold path}` (`design-pre-steps.md` Step 2.5b-ii item 5) — omit the line entirely when Step 2.5b-ii was skipped, declined, or not offered (the canonical field reference lives in `spec-template.md`). Under `work-backend: github-issues` + `work-links: body-text`, and only when Step 2.6 kept the parent, also prefix `Parent: #$PARENT_NUM` — already known at this point (Parent record, above, runs first) and the only combination where nothing else records a sub-issue's own parent (`spec-template.md`). Under collapse, omit this line entirely — there is no `$PARENT_NUM` to reference.

**Type** — when Step 2.6 kept a parent, matches it (`feature`). Under collapse there is no parent to match: derive the type from the unit itself (`feature` for a new capability or enhancement), and when shaping the origin in place (carve-out above), keep the origin record's existing type unless the unit's own content contradicts it. Either way, a unit that is clearly a defect fix (a bug report, a regression, broken behavior) overrides to `bug`.

**Scoring** — judge each sub-issue's `risk` and `size` (low/medium/high each) from its own Deliverables and Acceptance Criteria — blast radius and reversibility for `risk`, estimated size and file spread for `size` — per `_shared/work-record.md`'s Scoring axis, run once per sub-issue. The tiers become `$SUB_ISSUE_RISK`/`$SUB_ISSUE_SIZE` below.

**Ceremony** — invoke the canonical ceremony-check pattern (`_shared/ceremony-check-invocation.md`) against this sub-issue's own composed body — never a kept parent, which carries no `ceremony:*` label either. **This call site's delta:** per-leaf (once per sub-issue in the decomposition loop), without `#{n}` (no sub-issue number exists yet). The verdict becomes `$SUB_ISSUE_CEREMONY` below, written into the sub-issue's own create call — writeback happens via record creation itself, not a separate stamp.

**Framing** — invoke `/claude-tweaks:challenge` in `framing-check` mode (`Skill(skill: "claude-tweaks:challenge", args: "framing-check")`) against this sub-issue's own composed body — never the parent, which carries no scoring labels either. On `FRAMING: solution-baked`, stamp `solution:unjustified` on the sub-issue and fold the RATIONALE's named assumptions into that sub-issue's `## Gotchas` bullets. On `FRAMING: open`, stamp nothing. The composed body — plus, under the origin-set carve-out above, the preserved `## Original request` block — is passed wrapped per `_shared/untrusted-record-content.md`.

**Per-sub-issue invocation.** Both the Ceremony and Framing calls above run once per sub-issue, inside this per-sub-issue loop — `#{n}` is omitted from both (`ceremony-check`'s own documented pre-numbering exception, `assess-agent-autonomy/SKILL.md`'s Input section; `framing-check` mirrors it here for the identical reason — no sub-issue number exists until the create call further below) — never reused or rendered from memory for a later sub-issue in the same decomposition. **Self-check before creating:** count the bare `ceremony-check`/`framing-check` invocations made since the previous sub-issue's create call (or since the start of this loop, for the first sub-issue) and confirm it is exactly one of each before this create call runs — a divergent verdict across sub-issues in the same decomposition is only valid when each sub-issue had its own invocation, made inside its own since-the-last-create window.

**Slug derivation** — `$UNIT_SLUG` is `deriveSlug(title, existingSlugs)` (`bin/lib/issues/local-store.js`) — the same deterministic algorithm `/claude-tweaks:capture` and `/claude-tweaks:demo` use for their own record creation, not a hand-derived slugification. Seed `existingSlugs` with the literal string `'parent'` (a sub-issue slug must never collide with the parent's reserved fingerprint suffix — see above) plus, under `work-backend: local-files`, the current `specs/` directory listing (same scan `/claude-tweaks:capture`'s local-files branch uses; since each `createRecord` below writes its file before the next runs, the rescan also dedupes against slugs already assigned earlier in this loop):

```bash
UNIT_SLUG=$(node -e "const fs=require('fs');
  const {deriveSlug}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const dir='specs';
  const onDisk=fs.existsSync(dir)
    ? fs.readdirSync(dir).map((n)=>/^\d+-(.+)\.md$/.exec(n)).filter(Boolean).map((m)=>m[1])
    : [];
  console.log(deriveSlug(process.argv[1], ['parent', ...onDisk]))" "$SUB_ISSUE_TITLE")
```

Reuse this same `$UNIT_SLUG` value below for both the fingerprint and, under `work-backend: local-files`, the record's own slug — do not re-derive it separately at write time.

**Fingerprint** — `{design-doc-slug}:{unit-slug}` (`$UNIT_SLUG` from Slug derivation, above), the sub-issue half of the deterministic scheme the Idempotency section above defines.

```bash
SPECIFY_SUB_ISSUE_PAYLOAD=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-sub-issue-payload.json') || require('path').join(require('os').tmpdir(), 'specify-sub-issue-payload.json'))
")
SPECIFY_SUB_ISSUE_BODY=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-sub-issue-body.md') || require('path').join(require('os').tmpdir(), 'specify-sub-issue-body.md'))
")

node -e "require('fs').writeFileSync('$SPECIFY_SUB_ISSUE_PAYLOAD', JSON.stringify({
    title: process.argv[1], body: process.argv[2], type: process.argv[3],
    risk: process.argv[4], size: process.argv[5], ceremony: process.argv[6], ready: true,
    fingerprint: process.argv[7]
  }))" \
  "$SUB_ISSUE_TITLE" "$SUB_ISSUE_BODY" "$SUB_ISSUE_TYPE" "$SUB_ISSUE_RISK" "$SUB_ISSUE_SIZE" "$SUB_ISSUE_CEREMONY" "${DESIGN_DOC_SLUG}:${UNIT_SLUG}"

# Sub-issue bodies are spec-shaped by construction (spec-template.md) — validate before writing.
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" "$SPECIFY_SUB_ISSUE_PAYLOAD" --out "$SPECIFY_SUB_ISSUE_BODY" --require-shaped
```

(This bash fence runs once per work unit, in a loop — `sessionTmpPath` is idempotent per session+filename, so both paths resolve identically on every iteration and each iteration's compose-then-write-once overwrites cleanly before the next.)

`recordPayload` embeds the fingerprint as `<!-- work-fingerprint: {design-doc-slug}:{unit-slug} -->` in the returned body — `"$SPECIFY_SUB_ISSUE_BODY"` above already carries it, so both drivers below write the same fingerprinted text.

Bootstrap the labels this run is about to apply before the first create (per `_shared/label-bootstrap.md`): `ready` plus every `risk:{tier}`/`size:{tier}`/`ceremony:{tier}` pair in use, plus `solution:unjustified` — and, under `work-types: labels`, the `type:{t}` pairs from `record.js`'s `TYPE_LABELS`, as with the parent.

**`work-backend: github-issues`** — same Type expression branch as the parent. The `recordPayload` call above never passes `solutionUnjustified`, so its `.labels` cover only `risk:{tier}`, `size:{tier}`, `ceremony:{tier}`, `ready`, and no `by:*` label — a decomposition is human-shaped work, not a health-skill filing. The `--label` flags below are exactly that set; `solution:unjustified` is added separately, below the create blocks, once the Framing verdict is known:

```bash
SPECIFY_SUB_ISSUE_BODY=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-sub-issue-body.md') || require('path').join(require('os').tmpdir(), 'specify-sub-issue-body.md'))
")
# work-types: native
SUB_ISSUE_URL=$(gh issue create --title "$SUB_ISSUE_TITLE" --body-file "$SPECIFY_SUB_ISSUE_BODY" \
  --type "$SUB_ISSUE_TYPE" \
  --label "risk:$SUB_ISSUE_RISK" --label "size:$SUB_ISSUE_SIZE" --label "ceremony:$SUB_ISSUE_CEREMONY" --label ready)

# work-types: labels
SUB_ISSUE_URL=$(gh issue create --title "$SUB_ISSUE_TITLE" --body-file "$SPECIFY_SUB_ISSUE_BODY" \
  --label "risk:$SUB_ISSUE_RISK" --label "size:$SUB_ISSUE_SIZE" --label "ceremony:$SUB_ISSUE_CEREMONY" --label ready \
  --label "type:$SUB_ISSUE_TYPE")

SUB_ISSUE_NUM=$(basename "$SUB_ISSUE_URL")
```

When this sub-issue's Framing verdict (above) was `solution-baked`, add `--label "solution:unjustified"` to the create call; on `open` add nothing — the label is presence-only, and absence is the common case.

**`work-backend: local-files`** — use `createRecord`, not `allocateId`+`writeRecord` separately, for the same concurrent-creation-race reason as the parent above. One call carries the same state as facets: `stage: 'ready'` instead of the `ready` label, `origin` omitted for the same no-`by:*` reason. `"$SPECIFY_SUB_ISSUE_BODY"` already carries the fingerprint marker, so the local write preserves it:

```bash
SPECIFY_SUB_ISSUE_BODY=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-sub-issue-body.md') || require('path').join(require('os').tmpdir(), 'specify-sub-issue-body.md'))
")
SUB_ISSUE_ID=$(node -e "const {createRecord}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const body = require('fs').readFileSync(process.argv[7], 'utf8');
  const record = createRecord('specs', {
    slug: process.argv[1],
    title: process.argv[2],
    body,
    facets: { type: process.argv[3], risk: process.argv[4], size: process.argv[5], ceremony: process.argv[6], stage: 'ready' }
  });
  console.log(record.id)" "$UNIT_SLUG" "$SUB_ISSUE_TITLE" "$SUB_ISSUE_TYPE" "$SUB_ISSUE_RISK" "$SUB_ISSUE_SIZE" "$SUB_ISSUE_CEREMONY" "$SPECIFY_SUB_ISSUE_BODY")
```

Add a `facets.solutionUnjustified: true` key to the object above only when this sub-issue's Framing verdict (above) was `solution-baked`; omit the key entirely on `open` (absent, not null) — unlike `facets.ceremony`, which always gets a value the first time a record is shaped, `facets.solutionUnjustified` is genuinely absent on the common `open` case.

Capture `$SUB_ISSUE_NUM` / `$SUB_ISSUE_ID` for every sub-issue (created or resumed via the Idempotency map) — Step 4's linking pass consumes them.

**Accumulate this unit for the cross-reference pass below.** Append `{title, num_or_id, body}` (`$SUB_ISSUE_TITLE`, `$SUB_ISSUE_NUM`/`$SUB_ISSUE_ID`, `"$SPECIFY_SUB_ISSUE_BODY"`'s contents) to a session-scoped JSON array file, read-existing-then-append (this loop's compose-then-write-once temp files are overwritten each iteration, so this is the only place the whole batch's bodies survive past their own iteration):

```bash
SPECIFY_DECOMP_MANIFEST=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-decomp-manifest.json') || require('path').join(require('os').tmpdir(), 'specify-decomp-manifest.json'))
")
node -e "const fs=require('fs');
  const path=process.argv[1];
  const entry={title:process.argv[2], num:process.argv[3], body:fs.readFileSync(process.argv[4],'utf8')};
  const list=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):[];
  list.push(entry);
  fs.writeFileSync(path, JSON.stringify(list))" "$SPECIFY_DECOMP_MANIFEST" "$SUB_ISSUE_TITLE" "${SUB_ISSUE_NUM:-$SUB_ISSUE_ID}" "$SPECIFY_SUB_ISSUE_BODY"
```

**Write-path resilience.** A `gh` create failure for one sub-issue (any kept parent already exists on GitHub by this point) falls back to `local-store.js` for that sub-issue only — write it locally with `unsynced: true` (fingerprint preserved, so a later sync still dedups correctly) and continue with the rest of the batch rather than aborting the whole decomposition over one failure. `/tidy`'s Sync finding reconciles it onto GitHub on a later pass. The same rule applies to Step 4's linking edits below — a failed link is noted and the pass continues; nothing already created rolls back.

**Body size ceiling.** A sub-issue body past roughly 50KB (GitHub's hard cap is 65,536 characters) is a decomposition smell, not a formatting problem — split the unit further.

**Cross-reference forward/backward Key Files (record #490).** Once every sub-issue in the batch has been accumulated above, scan for a genuine cross-sub-issue forward/backward reference — a Gotchas or Prerequisites sentence naming a sibling sub-issue *and* a specific facet/property/function that sibling must touch (the #473/#475 pattern: "soon `facets.solutionUnjustified`, per the companion rename sub-issue") — and resolve the named identifier into the file(s) it actually lives in via a repo-wide grep, adding them to that sibling's own Key Files list. `bin/lib/issues/decomposition-crossref.js`'s `crossReferenceKeyFiles(units, grep)` is the mechanical half of this (identifier → file resolution via grep, dedup against the sibling's existing Key Files, test-file exclusion) — deciding *which* sentences are genuine forward-references, versus a casual mention, is judgment this step still applies itself before calling it, exactly as it already judges Ceremony/Framing verdicts per sub-issue:

```bash
node -e "const {crossReferenceKeyFiles}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/decomposition-crossref.js');
  const { execFileSync } = require('child_process');
  const units = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  const grep = (ident) => {
    try { return execFileSync('git', ['grep', '-l', '-F', ident], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); }
    catch { return []; }
  };
  console.log(JSON.stringify(crossReferenceKeyFiles(units, grep)))" "$SPECIFY_DECOMP_MANIFEST"
```

For each returned `{title, addedFiles}` entry, append `addedFiles` (`- \`{path}\` — {note}`, `spec-template.md`'s Key Files item format) to that sub-issue's own `### Key Files` list and write the updated body back — `gh issue edit {num} --body-file` (`work-backend: github-issues`) or `local-store.js`'s `updateRecord` (`work-backend: local-files`) — per **Write-path resilience** above: a failed edit is noted and the pass continues, nothing already created rolls back. No returned entries (the common case — no genuine cross-reference in this batch) is a silent no-op, not an error.

**Snapshot invalidation.** Once every `gh issue create` call in this step's batch (every
sub-issue, plus a kept parent) has run, invalidate the session-scoped record snapshot once — the
Idempotency map above stays correct in-memory for the rest of the batch, so invalidation is needed
only after the whole batch, before Step 4 or any later consumer reads the queue again:

```bash
node -e "require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').invalidateSnapshot(process.env.CLAUDE_CODE_SESSION_ID)"
```

### Rules

- **Absorb decisions from the design doc** — each sub-issue must be self-contained. The design doc will be deleted (Step 7), so all rationale, decisions, and technical context relevant to that sub-issue lives in its own body.
- **Be specific about files** — "update the API" is too vague. Name the exact file and what to add.
- **Include testable acceptance criteria** — not "works correctly" but specific assertions an agent can verify.
- **Include gotchas from project memory** — search CLAUDE.md and memory files for relevant patterns, common mistakes, and lessons learned.
- **Include known manual steps — but only ones that survive the triage.** The Manual Steps section is reserved for items that have no CLI, require human judgment, or require out-of-band signoff. Infrastructure setup, env var provisioning, and API key creation with CLIs (`terraform`, `gh secret set`, `vercel env add`, `stripe`, `ldcli`, etc.) do NOT belong here — `/build` Step 2.5 auto-classifies and executes them. See `spec-template.md` Manual Steps section for the triage criteria and the `reason-not-auto` qualifier.


Continue at Step 4 in `record-creation-linking.md` (this skill's directory).
