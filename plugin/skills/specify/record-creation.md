# Specify — Record Creation and Linking (Steps 3-4)

Loaded by `/claude-tweaks:specify` Step 3 onward, decomposition mode only — shaping mode never reaches this step (it runs `shaping-mode.md` instead). Covers creating this run's records — every sub-issue, plus the parent issue when Step 2.6 kept one (Step 3) — and wiring their relationships plus absorbing the last of the design doc's context (Step 4), before Step 7 deletes the design doc.

**Split across three files (#1346).** This file holds Step 3's Idempotency (resume path) map and
Parent record creation. Step 3's Sub-issue creation and Rules continue in
`record-creation-subissues.md`; Step 4 (Linking, Decision Rationale and Assumptions) lives in
`record-creation-linking.md` — both in this same directory. Step numbering is unchanged across
the split, so a cross-reference naming a step by number still resolves regardless of which file
it lands in.

## Step 3: Create the records

When `decomposition-mode.md`'s Step 2.6 kept the parent, records are created **parent-first**: the parent's number has to exist before any sub-issue can link to it. Under collapse, there is no parent — every produced record is created independently, in any order. Every body is composed fully in memory before any write call — compose-then-write-once, the same discipline Shaping mode uses.

### Idempotency (resume path)

Every record this step creates carries a deterministic fingerprint: `{design-doc-slug}:parent` for the parent, `{design-doc-slug}:{unit-slug}` for each sub-issue. The same design doc always produces the same fingerprint for the same record — that determinism is what makes the check below a real resume path instead of a one-shot guard. **A unit slug must never be the literal string `parent`** — that value is reserved for the parent record's own fingerprint; a sub-issue slugified to `parent` would collide with it in the map below. Under collapse (`decomposition-mode.md` Step 2.6), no `{design-doc-slug}:parent` fingerprint is ever minted — a resumed collapsed run's fingerprint→number map has only unit fingerprints to match against, and finds every already-created record that way; it never checks for a parent checkpoint.

Before creating anything, build a fingerprint→number map of every existing marker, once. Resolve this run's session-scoped temp paths inside whichever driver branch below actually runs (`_shared/session-tmp-root.md`) — a fresh bash invocation does not inherit shell variables from a separate fence, so each branch resolves its own paths rather than relying on a shared preamble fence:

`work-backend: github-issues` — reuse Step 1's session-scoped `specify-all-issues.json` (already fetched `--state all --json number,title,labels,body,state`, the REST list, NOT the search index — the search index lags behind fresh writes, including this same run's own); no second `gh issue list` round-trip:

```bash
SPECIFY_ALL_ISSUES=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-all-issues.json') || require('path').join(require('os').tmpdir(), 'specify-all-issues.json'))
")
SPECIFY_EXISTING_FINGERPRINTS=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-existing-fingerprints.json') || require('path').join(require('os').tmpdir(), 'specify-existing-fingerprints.json'))
")
node -e "
  const { extractFingerprint } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const issues = require('$SPECIFY_ALL_ISSUES');
  const map = {};
  for (const i of issues) { const fp = extractFingerprint(i.body); if (fp && !(fp in map)) map[fp] = i.number; }
  require('fs').writeFileSync('$SPECIFY_EXISTING_FINGERPRINTS', JSON.stringify(map));
"
```

If `"$SPECIFY_ALL_ISSUES"` is unavailable (a resumed decomposition run in a fresh session with no Step 1 state from this session), fall back to reading through the session-scoped record snapshot the same way Step 1 does — `{Session-scoped record snapshot's read-fresh-or-fetch block (_shared/record-queue-fetch.md), with {tmp-records-file} = "$SPECIFY_ALL_ISSUES"}` — within the same `$CLAUDE_CODE_SESSION_ID` this resolves to the identical path and is typically a cache hit, not a fresh `gh` round-trip.

`work-backend: local-files` (the local marker search — same idea, read every record body and extract its marker). `queryRecords('specs', {})` alone excludes closed records by default (its `filtersOnClosed` check treats an empty filter object as "open, as today," per `local-store.js`'s own header comment on the function) — this map needs both open and closed, mirroring the github driver's `--state all` fetch above: a fingerprint match against an already-closed local record still means "already exists" and must not be recreated on a resumed decomposition. Merge a default (open) query with an explicit `{ closed: true }` query — the same two-call idiom `tests/bin-lib/issues/local-store.test.js` demonstrates:

```bash
SPECIFY_EXISTING_FINGERPRINTS=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-existing-fingerprints.json') || require('path').join(require('os').tmpdir(), 'specify-existing-fingerprints.json'))
")
node -e "
  const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const { extractFingerprint } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const records = [...queryRecords('specs', {}), ...queryRecords('specs', { closed: true })];
  const map = {};
  for (const r of records) { const fp = extractFingerprint(r.body); if (fp && !(fp in map)) map[fp] = r.id; }
  require('fs').writeFileSync('$SPECIFY_EXISTING_FINGERPRINTS', JSON.stringify(map));
"
```

Then, immediately before **each individual create** — a kept parent included, and not just once against the batch list above — re-check that record's fingerprint against the map. A match means the record already exists (a prior partial run, or a concurrent one): skip the create and use the mapped number instead — the parent's number for the sub-issues to link to, a sub-issue's number for Step 4's linking pass. On every successful create, add the new record's fingerprint and number to the in-memory map before moving on — this catches a same-run collision (two units that happen to slugify to the same name) exactly the way it catches a prior-run resume, since the map stays live for the whole loop rather than being a snapshot trusted for its duration.

**Hardened to a mechanical check (#2658).** This paragraph used to be the entire enforcement mechanism — no literal conditional at either create call site actually implemented it, so an agent under time pressure or distracted mid-loop (e.g. by a red-team pass between two creates) could skip the re-check without violating any coded rule. `#2626`/`#2627` (created 9 seconds apart from the same decomposition run) confirmed this as one live mechanism for a duplicate, alongside the still-open possibility of a genuinely concurrent sibling session — this hardening closes the first, not the second. Every create call site below (this file's Parent record section, and each sub-issue's in `record-creation-subissues.md`) now calls `bin/lib/issues/record.js`'s `checkFingerprint(map, fingerprint)` before create and `recordFingerprint(map, fingerprint, number)` immediately after a successful one, rather than relying on this paragraph alone.

### Parent record

Skip this whole section entirely when Step 2.6 (`decomposition-mode.md`) decided to collapse — no parent record, no `{design-doc-slug}:parent` fingerprint is ever minted, and Step 3 proceeds straight to Sub-issues below with no `$PARENT_NUM`/`$PARENT_ID` for them to link to. Otherwise, unchanged from before collapse existed: a parent record is minted once per decomposition run (or per `phase-N`, when scoped — see Step 7's phase table). Type is always `feature` — the parent is a summary record, not agent-sized work: **parents never get `ready`**, and they carry no `risk:*`/`size:*` scoring at all.

Parent body = design summary: the problem, the chosen approach, the key decisions, and why the alternatives lost. This is deliberately not the design doc pasted verbatim — it's the durable digest that has to survive Step 7 deleting the design doc. Prefix it with a one-line metadata block, `Surface: {value}` — reuse whatever Step 2.5a's whole-design-doc detection already produced (the canonical value list lives in `spec-template.md`). The parent never carries `Design-intent:` — parents are never built or polished directly, so creative intent has nothing to attach to.

```bash
SPECIFY_PARENT_PAYLOAD=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-parent-payload.json') || require('path').join(require('os').tmpdir(), 'specify-parent-payload.json'))
")
SPECIFY_PARENT_BODY=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-parent-body.md') || require('path').join(require('os').tmpdir(), 'specify-parent-body.md'))
")

node -e "require('fs').writeFileSync('$SPECIFY_PARENT_PAYLOAD', JSON.stringify({title:process.argv[1], body:process.argv[2], type:'feature', fingerprint:process.argv[3]}))" \
  "$PARENT_TITLE" "$PARENT_BODY" "${DESIGN_DOC_SLUG}:parent"

# Parent bodies are a design summary, not spec-shaped — no --require-shaped (bin/compose-record.js's Global Constraints).
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" "$SPECIFY_PARENT_PAYLOAD" --out "$SPECIFY_PARENT_BODY"
```

(`_shared/session-tmp-root.md` — cited, not restated. `$SPECIFY_PARENT_PAYLOAD`/`$SPECIFY_PARENT_BODY` stay in scope for the rest of this section below.)

`recordPayload` returns zero labels for the parent — no origin, no scoring, no `ready`. Two
labels can still land on it, both applied directly via `gh issue create --label` rather than
through the payload: `type:feature` — only under `work-types: labels` — and `parent-issue`,
unconditionally. `parent-issue` is what makes a parent enumerable at all: its
`{design-doc-slug}:parent` fingerprint is a body marker reachable only through `gh issue list
--search`, which "Resuming after a partial run" (below) forbids falling back to — so without the
label a `/claude-tweaks:tidy` sweep cannot find a parent whose gate was never applied
(`_shared/github-pr-scan-acceptance.md`'s `parent-gate` scope). Bootstrap both before the create
(per `_shared/label-bootstrap.md`); the `parent-issue` row below is copied verbatim from that
file's canonical `LABELS_JSON` and must stay byte-identical to it, and the `type:feature` row
comes from `record.js`'s `TYPE_LABELS`:

```js
[
  ["parent-issue",      "Structure: parent issue — carries the acceptance gate for its sub-issues"],
  ["type:feature",      "Type: new capability or enhancement"]
]
```

**Idempotency check-before-create (#2658).** Every create call site below — this one and each sub-issue's in `record-creation-subissues.md` — runs this exact conditional first, never skipping straight to `gh issue create`/`gh issue edit`. This is the mechanical form of the prose the Idempotency section above already specifies; there is no separate opt-out:

```bash
SPECIFY_PARENT_EXISTING=$(node -e "
  const { checkFingerprint } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const map = require('$SPECIFY_EXISTING_FINGERPRINTS');
  const n = checkFingerprint(map, process.argv[1]);
  console.log(n === null ? '' : n);
" "${DESIGN_DOC_SLUG}:parent")
```

`work-backend: github-issues` — the Type expression branch (`_shared/work-record-config.md`, the config-key table's canonical home; read `work-types` once, never re-probe mid-flow):

```bash
if [ -n "$SPECIFY_PARENT_EXISTING" ]; then
  PARENT_NUM="$SPECIFY_PARENT_EXISTING"
  echo "Idempotency: #${PARENT_NUM} already carries fingerprint ${DESIGN_DOC_SLUG}:parent — skipping create." >&2
else
  SPECIFY_PARENT_BODY=$(node -e "
    const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
    console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-parent-body.md') || require('path').join(require('os').tmpdir(), 'specify-parent-body.md'))
  ")
  # work-types: native
  PARENT_URL=$(gh issue create --title "$PARENT_TITLE" --body-file "$SPECIFY_PARENT_BODY" --type feature --label parent-issue)
  # work-types: labels
  PARENT_URL=$(gh issue create --title "$PARENT_TITLE" --body-file "$SPECIFY_PARENT_BODY" --label type:feature --label parent-issue)

  PARENT_NUM=$(basename "$PARENT_URL")

  # Update the map immediately (#2658) — catches a same-run collision the
  # same way it catches a prior-run resume, per the Idempotency section above.
  node -e "
    const fs = require('fs');
    const { recordFingerprint } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
    const map = require('$SPECIFY_EXISTING_FINGERPRINTS');
    recordFingerprint(map, process.argv[1], Number(process.argv[2]));
    fs.writeFileSync('$SPECIFY_EXISTING_FINGERPRINTS', JSON.stringify(map));
  " "${DESIGN_DOC_SLUG}:parent" "$PARENT_NUM"
fi
```

**`work-backend: local-files`:** use `createRecord`, not `allocateId`+`writeRecord` separately — two near-simultaneous runs calling those two separately can both compute the same next id and both succeed under different slugs, silently sharing one numeric id and corrupting any later `facets.parent`/`facets.blockedBy` reference that assumes id uniqueness. `createRecord` closes that race by allocating the id and writing the file as one atomic step (`bin/lib/issues/local-store.js`'s header comments; the same fix `capture/SKILL.md`'s local-files branch already applies). The slug is `deriveSlug(title, existingSlugs)` from that same module — not a hand-derived slugification:

```bash
if [ -n "$SPECIFY_PARENT_EXISTING" ]; then
  PARENT_ID="$SPECIFY_PARENT_EXISTING"
  echo "Idempotency: record #${PARENT_ID} already carries fingerprint ${DESIGN_DOC_SLUG}:parent — skipping create." >&2
else
  SPECIFY_PARENT_BODY=$(node -e "
    const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
    console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-parent-body.md') || require('path').join(require('os').tmpdir(), 'specify-parent-body.md'))
  ")
  PARENT_ID=$(node -e "const fs=require('fs');
    const {createRecord, deriveSlug}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
    const dir='specs';
    const existingSlugs=fs.existsSync(dir)
      ? fs.readdirSync(dir).map((n)=>/^\d+-(.+)\.md$/.exec(n)).filter(Boolean).map((m)=>m[1])
      : [];
    const slug=deriveSlug(process.argv[1], existingSlugs);
    const body=fs.readFileSync(process.argv[2], 'utf8');
    const record=createRecord(dir, { slug, title: process.argv[1], body, facets: { type: 'feature', isParentIssue: true } });
    console.log(record.id)" "$PARENT_TITLE" "$SPECIFY_PARENT_BODY")

  node -e "
    const fs = require('fs');
    const { recordFingerprint } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
    const map = require('$SPECIFY_EXISTING_FINGERPRINTS');
    recordFingerprint(map, process.argv[1], Number(process.argv[2]));
    fs.writeFileSync('$SPECIFY_EXISTING_FINGERPRINTS', JSON.stringify(map));
  " "${DESIGN_DOC_SLUG}:parent" "$PARENT_ID"
fi
```

`isParentIssue: true` is the local-files parity for the `parent-issue` label above — the same
queryable-parent problem, on the backend with no labels at all. `local-store.js` serializes it as
an `is-parent-issue: true` frontmatter line and parses it back into `facets.isParentIssue`; no
sub-issue ever sets it, so it stays `false` there. `/claude-tweaks:demo`'s Approve step reads it
to decide whether to close the parent once its sub-issues are accepted.

`$PARENT_NUM` / `$PARENT_ID` is now captured — every sub-issue below links back to it.

**If parent creation fails** (`gh` unreachable, transient API error): fall back to `local-store.js` for the parent — the same `unsynced: true` fallback as below — and run the rest of this decomposition on the local driver too, so sub-issues have a real parent to link to instead of a GitHub record that doesn't exist. `/tidy`'s Sync finding reconciles them later.

**Resuming after a partial run:** nothing parent-specific — the Idempotency map above already covers it. A `{design-doc-slug}:parent` marker match means a prior run created this parent; reuse the mapped number and skip the create, exactly as with any sub-issue. Never fall back to a title search — `gh issue list --search` rides the search index this step deliberately avoids.

Continue at Step 3's Sub-issue creation in `record-creation-subissues.md` (this skill's
directory).
