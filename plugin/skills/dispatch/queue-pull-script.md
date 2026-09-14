# Dispatch Step 2 — The Queue-Pull Script

Referenced by `skills/dispatch/SKILL.md` Step 2. Run this verbatim — it produces this run's session-scoped `dispatch-groups.json` (`_shared/session-tmp-root.md`), the file-overlap-grouped eligible queue every selection form (bare, `next`, `#N`, `#N,#M,...`) reads next. It also produces `dispatch-blocked-excluded.json` — every otherwise-`auto:build`-eligible candidate this run's own blocked-by checks (body-text and, under `work-links: native`, the native `blockedBy` connection) dropped from the pool, each entry naming the blocker id(s) that excluded it (`{number, blockedBy: [ids]}[]`) — via `record.js`'s `partitionByOpenBodyBlockers` for the body-text case, and via `bin/resolve-blockers.js`'s `openBlockerIds` field for the `work-links: native` case — SKILL.md Step 2's Blocked-exclusion report reads this file so a shrinking pool is never silent. It also produces `dispatch-oversized-excluded.json` (#1228) — every file-overlap group `grouping.js`'s `partitionGroupsBySizeGuard` found over the size guard, each entry naming the group's members and size (`{records: number[], size, threshold}[]`). These groups stay IN `dispatch-groups.json` (`#N`/`#N,#M,...` still resolve them normally — a human present, explicitly naming one, is itself the required surfacing); only bare drain's auto-selection (SKILL.md Step 3, reusing the `next`-alias ranking script) reads this file to exclude an oversized group from its own candidate pool, since nobody is present there to see a table row or answer a prompt. SKILL.md Step 3's Oversized-exclusion report also reads this file so every form's exclusion (or non-exclusion) is surfaced, never silent. Before the size guard runs, `grouping.js`'s `bundleFastLaneSingletons` (#1910) merges up to `dispatch-fastlane-bundle-cap` (default 3, `policy.yml`) non-overlapping `ceremony:fast-lane` singleton groups — same `auto:merge` state, same `priority:*` band, oldest-first — into one multi-spec group each, so the pool `dispatch-groups.json` carries already reflects any bundling; it also writes `dispatch-fastlane-bundles.json` (`{records: number[]}[]`), naming exactly the groups this pass created, so the Reporting section can call out a fast-lane bundle distinctly from an ordinary file-overlap group. It also produces `dispatch-open-pr-excluded.json` (#1224) — every candidate already covered by an open, unmerged PR that will close it (GitHub's own `closedByPullRequestsReferences` connection, a closing keyword in the PR body), each entry naming the linked PR (`{number, pr}[]`) — via `record.js`'s `partitionByOpenLinkedPR`. Unlike the blocked-by check above, this one runs unconditionally, independent of `work-links`, and unlike the cross-PR overlap report below it DOES remove excluded candidates from `dispatch-groups.json` before any selection form reads it — a record with an in-flight PR is not a warning, it is not re-dispatch-eligible at all. It also produces `dispatch-target-missing-excluded.json` (#1983) — every remaining candidate whose `namedTarget` (`bin/lib/issues/named-target.js` — today, `by:docs-health` records only) names a file no longer present at the integration tip, each entry naming the absent path (`{number, path}[]`) — a docs-health-filed ledger correction whose target a since-merged tidy sweep already deleted. This one DOES remove excluded candidates from `dispatch-groups.json` too, the same as the open-linked-PR exclusion: such a record's own Acceptance Criteria is unsatisfiable, so re-dispatching it only burns a build attempt against the retry ceiling for nothing. Each exclusion also stages one Close proposal in this firing's own run directory (`tidy`'s Close (GitHub) shape) so the next `tidy --approve` closes the record — nothing is written to GitHub by dispatch itself. SKILL.md Step 3's Blocked-exclusion report reads this file too, under the same non-silent convention.

```bash
eval "$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  const os = require('os'); const path = require('path');
  const files = {
    DISPATCH_QUEUE_RAW: 'dispatch-queue-raw.json',
    DISPATCH_OPEN_NUMBERS: 'dispatch-open-numbers.json',
    DISPATCH_ELIGIBLE_PRE_DEP: 'dispatch-eligible-pre-dep.json',
    DISPATCH_UNRESOLVED_DEPS: 'dispatch-unresolved-deps.json',
    DISPATCH_VERIFIED_OPEN_DEPS: 'dispatch-verified-open-deps.txt',
    DISPATCH_ELIGIBLE: 'dispatch-eligible.json',
    DISPATCH_BLOCKED_EXCLUDED_BODY: 'dispatch-blocked-excluded-body.json',
    DISPATCH_NATIVE_DEPS: 'dispatch-native-deps.json',
    DISPATCH_NATIVE_DEPS_TMP: 'dispatch-native-deps.tmp.json',
    DISPATCH_NATIVE_DEPS_ERR: 'dispatch-native-deps.err',
    DISPATCH_GROUPS: 'dispatch-groups.json',
    DISPATCH_BLOCKED_EXCLUDED: 'dispatch-blocked-excluded.json',
    DISPATCH_OVERSIZED_EXCLUDED: 'dispatch-oversized-excluded.json',
    DISPATCH_FASTLANE_BUNDLES: 'dispatch-fastlane-bundles.json',
    DISPATCH_DEP_FRESHNESS: 'dispatch-dep-freshness.json',
    DISPATCH_OPEN_PRS: 'dispatch-open-prs.json',
    DISPATCH_CROSSPR_OVERLAP: 'dispatch-crosspr-overlap.json',
    DISPATCH_LINKED_PRS: 'dispatch-linked-prs.json',
    DISPATCH_LINKED_PRS_ERR: 'dispatch-linked-prs.err',
    DISPATCH_OPEN_PR_EXCLUDED: 'dispatch-open-pr-excluded.json',
    DISPATCH_NAMED_TARGETS: 'dispatch-named-targets.json',
    DISPATCH_TARGET_MISSING_EXCLUDED: 'dispatch-target-missing-excluded.json',
    DISPATCH_SHIPPED_EXCLUDED: 'dispatch-shipped-excluded.json',
    DISPATCH_SHIPPED_PROBE_PRS: 'dispatch-shipped-probe-prs.json',
    DISPATCH_SHIPPED_PR_FILES: 'dispatch-shipped-pr-files.jsonl',
  };
  for (const [varName, filename] of Object.entries(files)) {
    const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
    console.log(varName + '=' + JSON.stringify(p));
  }
")"

gh issue list --label auto:build --state open --json number,title,body,labels,createdAt,updatedAt,state --limit 500 > "$DISPATCH_QUEUE_RAW"
QUEUE_RAW_COUNT=$(node -e "console.log(require(process.argv[1]).length)" "$DISPATCH_QUEUE_RAW")
if [ "$QUEUE_RAW_COUNT" -ge 500 ]; then
  echo "Warning: the auto:build queue pull returned exactly the --limit cap (500) — this repo may have more open auto:build records than fetched. gh issue list returns newest-first, so any records beyond the cap are the OLDEST same-priority ones, exactly what next's own oldest-first tie-break (Step 3) exists to surface first. Consider raising the cap, or filing this as a signal to re-triage the queue down." >&2
fi

# #1571: cache-check prefix. `updatedAt,state` above (added to DISPATCH_QUEUE_RAW's
# existing --json field list — no extra bulk call, per AC1's merged-call allowance)
# plus this one targeted dependency-freshness call are the "at most two bulk calls"
# AC1 requires. Comparison logic (buildFreshnessSignal/signalsMatch) and the
# persisted-blob read/write live in bin/lib/dispatch/queue-order.js — a cache,
# not a lock: two racing firings both attempt the write-back below; the CAS
# loser's own in-memory groups/excluded (computed by its own full pull) stay
# valid for its own firing regardless of whether its write landed.
DISPATCH_DEP_NUMBERS=$(node -e "
  const { mainCheckoutRoot } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js');
  const { readOrder, buildFreshnessSignal } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/queue-order.js');
  const root = mainCheckoutRoot(process.cwd()) || process.cwd();
  const persisted = readOrder(root);
  if (!persisted) { console.log(''); process.exit(0); }
  const autoBuildNumbers = new Set(require(process.argv[1]).map((i) => i.number));
  const depOnly = (persisted.freshnessSignal.issues || []).filter((i) => !autoBuildNumbers.has(i.number));
  console.log(depOnly.map((i) => i.number).join(','));
" "$DISPATCH_QUEUE_RAW")
echo '[]' > "$DISPATCH_DEP_FRESHNESS"
# Cache-hit default: computed before cache-hit/miss is known, so this is
# only the pre-computation placeholder -- the CACHE_HIT node -e block below
# overwrites it with persisted.bundles (#2066) once it confirms a hit; a
# cache miss re-derives it from scratch further down instead.
echo '[]' > "$DISPATCH_FASTLANE_BUNDLES"
if [ -n "$DISPATCH_DEP_NUMBERS" ]; then
  gh issue list --search "$(echo "$DISPATCH_DEP_NUMBERS" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || echo '[]' > "$DISPATCH_DEP_FRESHNESS"
fi
CACHE_HIT=$(node -e "
  const { mainCheckoutRoot } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js');
  const { readOrder, buildFreshnessSignal, signalsMatch } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/queue-order.js');
  const fs = require('fs');
  const root = mainCheckoutRoot(process.cwd()) || process.cwd();
  const persisted = readOrder(root);
  if (!persisted) { console.log('0'); process.exit(0); }
  const autoBuild = require(process.argv[1]);
  const depFreshness = require(process.argv[2]);
  const current = buildFreshnessSignal([...autoBuild, ...depFreshness]);
  if (!signalsMatch(persisted.freshnessSignal, current)) { console.log('0'); process.exit(0); }
  fs.writeFileSync(process.argv[3], JSON.stringify(persisted.groups));
  fs.writeFileSync(process.argv[4], JSON.stringify(persisted.excluded));
  const groupSizeGuard = parseInt(process.argv[5], 10);
  const { partitionGroupsBySizeGuard } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grouping.js');
  const { oversized, threshold } = partitionGroupsBySizeGuard(persisted.groups, { groupSizeGuard });
  fs.writeFileSync(process.argv[6], JSON.stringify(oversized.map((g) => ({ records: g.map((i) => i.number), size: g.length, threshold }))));
  // #2066: a cache hit's persisted bundle membership replaces the
  // pre-computation '[]' default above -- a persisted record from before
  // this field existed has no 'bundles' key, so this falls back to [].
  fs.writeFileSync(process.argv[7], JSON.stringify(persisted.bundles || []));
  console.log('1');
" "$DISPATCH_QUEUE_RAW" "$DISPATCH_DEP_FRESHNESS" "$DISPATCH_GROUPS" "$DISPATCH_BLOCKED_EXCLUDED" "$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values dispatch-group-size-guard)" "$DISPATCH_OVERSIZED_EXCLUDED" "$DISPATCH_FASTLANE_BUNDLES")

if [ "$CACHE_HIT" = "1" ]; then
  echo "Queue-order cache hit — using persisted groups/excluded, skipping dependency verification and native blocker query (#1571)." >&2
fi

if [ "$CACHE_HIT" != "1" ]; then

gh issue list --state open --json number --limit 200 > "$DISPATCH_OPEN_NUMBERS"
WORK_LINKS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links)
DISPATCH_GROUP_SIZE_GUARD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values dispatch-group-size-guard)
DISPATCH_FASTLANE_BUNDLE_CAP=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values dispatch-fastlane-bundle-cap)
node -e "
  const { parseRecordFacets, parseDependencies } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const issues = require(process.argv[1]);
  const openNumbers = new Set(require(process.argv[2]).map((i) => i.number));
  const eligiblePreDep = issues
    .map((i) => ({ ...i, facets: parseRecordFacets(i.labels) }))
    .filter((i) => i.facets.grants.build && !i.facets.bot.inProgress && !i.facets.bot.blocked && !i.facets.bot.parked);
  // '--limit 200' can silently truncate the open-issues pull on a repo with more open
  // issues than that — a dependency number absent from openNumbers means 'not in the
  // fetched 200', not 'closed'. Collect those as unresolved for a targeted live check below
  // rather than treating the absence as proof the blocker is closed.
  const unresolved = [...new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)).filter((dep) => !openNumbers.has(dep)))];
  require('fs').writeFileSync(process.argv[3], JSON.stringify(eligiblePreDep));
  require('fs').writeFileSync(process.argv[4], JSON.stringify(unresolved));
" "$DISPATCH_QUEUE_RAW" "$DISPATCH_OPEN_NUMBERS" "$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_UNRESOLVED_DEPS"
: > "$DISPATCH_VERIFIED_OPEN_DEPS"
for DEP in $(node -e "console.log(require(process.argv[1]).join(' '))" "$DISPATCH_UNRESOLVED_DEPS"); do
  STATE=$(gh issue view "$DEP" --json state -q .state 2>/dev/null)
  if [ "$STATE" = "OPEN" ]; then echo "$DEP" >> "$DISPATCH_VERIFIED_OPEN_DEPS"; fi
done
node -e "
  const fs = require('fs');
  const { partitionByOpenBodyBlockers } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const eligiblePreDep = require(process.argv[1]);
  const openNumbers = new Set(require(process.argv[2]).map((i) => i.number));
  const verifiedOpen = fs.existsSync(process.argv[3])
    ? fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').filter(Boolean).map(Number)
    : [];
  for (const dep of verifiedOpen) openNumbers.add(dep);
  const { eligible, excluded } = partitionByOpenBodyBlockers(eligiblePreDep, openNumbers);
  fs.writeFileSync(process.argv[4], JSON.stringify(eligible));
  fs.writeFileSync(process.argv[5], JSON.stringify(excluded));
" "$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_OPEN_NUMBERS" "$DISPATCH_VERIFIED_OPEN_DEPS" "$DISPATCH_ELIGIBLE" "$DISPATCH_BLOCKED_EXCLUDED_BODY"
echo '{}' > "$DISPATCH_NATIVE_DEPS"
if [ "$WORK_LINKS" = "native" ]; then
  NATIVE_NUMS=$(node -e "console.log(require(process.argv[1]).map((i) => i.number).join(','))" "$DISPATCH_ELIGIBLE")
  if [ -n "$NATIVE_NUMS" ]; then
    if node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-blockers.js" "$NATIVE_NUMS" \
      > "$DISPATCH_NATIVE_DEPS_TMP" 2>"$DISPATCH_NATIVE_DEPS_ERR"; then
      mv "$DISPATCH_NATIVE_DEPS_TMP" "$DISPATCH_NATIVE_DEPS"
    else
      echo "Warning: native dependency query failed — falling back to no native filtering this run: $(cat "$DISPATCH_NATIVE_DEPS_ERR")" >&2
    fi
  fi
fi
node -e "
  const fs = require('fs');
  const { extractKeyFiles, expectsKeyFilesSection, groupByFileOverlap, partitionGroupsBySizeGuard, bundleFastLaneSingletons } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grouping.js');
  const eligible = require(process.argv[1]);
  const nativeDeps = require(process.argv[2]);
  const finalEligible = [];
  const excludedNative = [];
  for (const c of eligible) {
    const dep = nativeDeps[c.number];
    const openIds = (dep && Array.isArray(dep.openBlockerIds)) ? dep.openBlockerIds : [];
    if (openIds.length > 0) excludedNative.push({ number: c.number, blockedBy: openIds });
    else finalEligible.push(c);
  }
  const items = finalEligible.map((i) => ({ id: i.number, keyFiles: extractKeyFiles(i) }));
  const byId = new Map(finalEligible.map((i) => [i.number, i]));
  for (const item of items) {
    if (item.keyFiles.length === 0 && expectsKeyFilesSection(byId.get(item.id))) {
      console.error('Warning: eligible record #' + item.id + ' has no ### Key Files subsection — overlap detection disabled for it.');
    }
  }
  const rawGroups = groupByFileOverlap(items).map((ids) => ids.map((id) => byId.get(id)));
  // Fast-lane bundling (#1910): runs after file-overlap grouping, before the
  // size guard -- a bundle tops out at bundleCap (default 3), always well
  // under the size guard's own default of 10, so ordering here never
  // interacts with that gate.
  const bundleCap = parseInt(process.argv[7], 10);
  const { groups, bundles } = bundleFastLaneSingletons(rawGroups, { bundleCap });
  console.log(JSON.stringify(groups));
  fs.writeFileSync(process.argv[8], JSON.stringify(bundles));
  const excludedBody = require(process.argv[3]);
  fs.writeFileSync(process.argv[4], JSON.stringify([...excludedBody, ...excludedNative]));
  // Size guard (#1228): flagged, never removed from DISPATCH_GROUPS -- bare
  // and #N/#N,#M still resolve an oversized group normally (a human present,
  // explicitly naming/picking it, is itself the required surfacing). Only
  // the drain's ranking script (Step 3 — bare, or its deprecated next
  // alias) reads this file to exclude an oversized group from its own
  // candidate pool, since nobody is present there to see a table row or
  // answer a prompt.
  const groupSizeGuard = parseInt(process.argv[6], 10);
  const { oversized, threshold } = partitionGroupsBySizeGuard(groups, { groupSizeGuard });
  fs.writeFileSync(process.argv[5], JSON.stringify(oversized.map((g) => ({ records: g.map((i) => i.number), size: g.length, threshold }))));
" "$DISPATCH_ELIGIBLE" "$DISPATCH_NATIVE_DEPS" "$DISPATCH_BLOCKED_EXCLUDED_BODY" "$DISPATCH_BLOCKED_EXCLUDED" "$DISPATCH_OVERSIZED_EXCLUDED" "$DISPATCH_GROUP_SIZE_GUARD" "$DISPATCH_FASTLANE_BUNDLE_CAP" "$DISPATCH_FASTLANE_BUNDLES" > "$DISPATCH_GROUPS"

# #1571: write-back (cache-miss path only — a hit's persisted blob already
# reflects current state, so re-persisting it would be a wasted, byte-
# identical write). Best-effort: a failed write here never blocks or fails
# this firing (this design's own Gotchas) — only the persisted cache misses
# the update, exactly like a losing CAS writer's own in-memory groups/
# excluded staying valid for its own firing (AC5).
DISPATCH_ALL_DEP_NUMBERS=$(node -e "
  const { parseDependencies } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const eligiblePreDep = require(process.argv[1]);
  const deps = new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)));
  console.log([...deps].join(','));
" "$DISPATCH_ELIGIBLE_PRE_DEP")
echo '[]' > "$DISPATCH_DEP_FRESHNESS"
if [ -n "$DISPATCH_ALL_DEP_NUMBERS" ]; then
  gh issue list --search "$(echo "$DISPATCH_ALL_DEP_NUMBERS" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || echo '[]' > "$DISPATCH_DEP_FRESHNESS"
fi
node -e "
  const { mainCheckoutRoot } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js');
  const path = require('path');
  const { writeOrder, buildFreshnessSignal, composeOrderBlob } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/queue-order.js');
  const root = mainCheckoutRoot(process.cwd()) || process.cwd();
  const autoBuild = require(process.argv[1]);
  const depFreshness = require(process.argv[2]);
  const groups = require(process.argv[3]);
  const excluded = require(process.argv[4]);
  const bundles = require(process.argv[5]);
  const freshnessSignal = buildFreshnessSignal([...autoBuild, ...depFreshness]);
  const blob = composeOrderBlob({
    computedAt: new Date().toISOString(),
    runId: process.env.PIPELINE_RUN_DIR ? path.basename(process.env.PIPELINE_RUN_DIR) : null,
    freshnessSignal, groups, excluded, bundles,
  });
  const result = writeOrder(root, blob);
  if (!result.ok) console.error('Queue-order cache write-back failed (non-blocking): ' + result.error);
" "$DISPATCH_QUEUE_RAW" "$DISPATCH_DEP_FRESHNESS" "$DISPATCH_GROUPS" "$DISPATCH_BLOCKED_EXCLUDED" "$DISPATCH_FASTLANE_BUNDLES"

fi

# #1224: open-linked-PR exclusion. Runs unconditionally (both the cache-hit
# and cache-miss branches above leave $DISPATCH_GROUPS populated) and
# independent of $WORK_LINKS -- unlike the native blocked-by check gated
# above, PR linkage isn't a dependency-tracking policy choice, and unlike
# the queue-order cache (#1571) a PR opening/closing after the cache was
# written is exactly the kind of transient state the freshness signal
# (built from auto:build issues' own updatedAt/state) never observes, so
# skipping this on a cache hit would silently reintroduce the bug this
# record exists to fix. One batched aliased GraphQL call across every
# candidate still in $DISPATCH_GROUPS (post blocked-by/native/oversized
# filtering -- there is no point checking a candidate already excluded for
# another reason), via bin/resolve-linked-prs.js (record.js's
# buildLinkedPRQuery + bin/lib/issues/linked-prs.js's fetchLinkedPRs).
DISPATCH_GROUP_NUMS=$(node -e "
  const groups = require(process.argv[1]);
  console.log(groups.flat().map((i) => i.number).join(','))
" "$DISPATCH_GROUPS")
echo '{}' > "$DISPATCH_LINKED_PRS"
if [ -n "$DISPATCH_GROUP_NUMS" ]; then
  if node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-linked-prs.js" "$DISPATCH_GROUP_NUMS" \
    > "$DISPATCH_LINKED_PRS" 2>"$DISPATCH_LINKED_PRS_ERR"; then
    :
  else
    echo "Warning: linked-PR query failed — falling back to no open-PR exclusion this run: $(cat "$DISPATCH_LINKED_PRS_ERR")" >&2
    echo '{}' > "$DISPATCH_LINKED_PRS"
  fi
fi
node -e "
  const fs = require('fs');
  const groups = require(process.argv[1]);
  const linkedPRs = require(process.argv[2]);
  const excluded = [];
  const finalGroups = groups
    .map((g) => g.filter((c) => {
      const entry = linkedPRs[c.number];
      if (entry && entry.openPR) { excluded.push({ number: c.number, pr: entry.openPR }); return false; }
      return true;
    }))
    .filter((g) => g.length > 0);
  fs.writeFileSync(process.argv[3], JSON.stringify(excluded));
  console.log(JSON.stringify(finalGroups));
" "$DISPATCH_GROUPS" "$DISPATCH_LINKED_PRS" "$DISPATCH_OPEN_PR_EXCLUDED" > "${DISPATCH_GROUPS}.tmp" && mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"

# #1983: named-target existence exclusion. Runs unconditionally, right after
# the open-linked-PR exclusion above and before the (read-only) cross-PR
# overlap report below -- a record whose named target no longer exists at
# the integration tip is not merely unlikely to build, its Acceptance
# Criteria is unsatisfiable by construction (the observed shape: a
# by:docs-health ledger correction whose flagged doc a since-merged tidy
# sweep already deleted). Checked at the integration tip, not the working
# tree (materialize.md's Named-location drift note) -- a worktree session's
# tree may lag, and a dirty tree must not hide a deletion.
DISPATCH_STANDALONE_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "dispatch-standalone")
# {integration-branch} resolution follows _shared/integration-branch.md's ladder
# rank 3 (policy.yml) with a rank-6 git-remote fallback (this call site has no
# use for ranks 4-5's CLAUDE.md-prose/current-branch checks — a queue-pull
# script has no human present to disambiguate a current-vs-default mismatch,
# the same reasoning settle-and-merge.md's own citation of this file states).
INTEGRATION_BRANCH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch)
if [ -z "$INTEGRATION_BRANCH" ]; then
  INTEGRATION_BRANCH=$(git remote show origin | sed -n '/HEAD branch/s/.*: //p')
fi
INTEGRATION_REF="origin/$INTEGRATION_BRANCH"
node -e "
  const fs = require('fs');
  const { namedTarget } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/named-target.js');
  const groups = require(process.argv[1]);
  const named = groups.flat()
    .map((c) => ({ number: c.number, target: namedTarget(c) }))
    .filter((c) => c.target);
  fs.writeFileSync(process.argv[2], JSON.stringify(named));
" "$DISPATCH_GROUPS" "$DISPATCH_NAMED_TARGETS"
node -e "
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const named = require(process.argv[1]);
  const ref = process.argv[2];
  const missing = named.filter(({ target }) => {
    try {
      execFileSync('git', ['cat-file', '-e', ref + ':' + target.path], { stdio: 'pipe' });
      return false;
    } catch {
      return true;
    }
  }).map(({ number, target }) => ({ number, path: target.path }));
  fs.writeFileSync(process.argv[3], JSON.stringify(missing));
" "$DISPATCH_NAMED_TARGETS" "$INTEGRATION_REF" "$DISPATCH_TARGET_MISSING_EXCLUDED"
node -e "
  const fs = require('fs');
  const groups = require(process.argv[1]);
  const missing = require(process.argv[2]);
  const missingNums = new Set(missing.map((m) => m.number));
  const finalGroups = groups
    .map((g) => g.filter((c) => !missingNums.has(c.number)))
    .filter((g) => g.length > 0);
  console.log(JSON.stringify(finalGroups));
" "$DISPATCH_GROUPS" "$DISPATCH_TARGET_MISSING_EXCLUDED" > "${DISPATCH_GROUPS}.tmp" && mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"
for ROW in $(node -e "
  const missing = require(process.argv[1]);
  for (const m of missing) console.log(Buffer.from(JSON.stringify(m)).toString('base64'));
" "$DISPATCH_TARGET_MISSING_EXCLUDED"); do
  NUM=$(node -e "console.log(JSON.parse(Buffer.from(process.argv[1], 'base64').toString()).number)" "$ROW")
  TPATH=$(node -e "console.log(JSON.parse(Buffer.from(process.argv[1], 'base64').toString()).path)" "$ROW")
  node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$DISPATCH_STANDALONE_DIR" --status AUTO \
    --text "dispatch: #${NUM} excluded, named target ${TPATH} absent at ${INTEGRATION_REF}" --reversibility n/a
  TMP_PROPOSAL=$(mktemp)
  {
    echo "# Staged: Close (GitHub) — #${NUM} (named target absent at ${INTEGRATION_REF})"
    echo ""
    echo "**Finding:** \`[gh-issue] #${NUM}\` names target \`${TPATH}\`, which is absent at \`${INTEGRATION_REF}\` — deleted by a later commit after this record was filed."
    echo ""
    echo "**Proposed:** Close #${NUM} as not planned — named target deleted, nothing left to fix."
    echo ""
    echo "**Commands:**"
    echo "gh issue comment ${NUM} --body \"Closing: the named target ${TPATH} no longer exists at ${INTEGRATION_REF} — this record's Acceptance Criteria has no remaining target. Filed by /claude-tweaks:dispatch (queue pull).\""
    echo "gh issue close ${NUM} --reason \"not planned\""
  } > "$TMP_PROPOSAL"
  # stage-item.js is the sanctioned writer for a run dir's staged/ (CLAUDE.md's
  # pipeline-run-dir.md citation) -- never a direct Write/heredoc into it.
  node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$DISPATCH_STANDALONE_DIR" --id "dispatch-target-missing-${NUM}" --file "$TMP_PROPOSAL"
done

# #1984: shipped-candidate classification. Runs unconditionally, right after
# the #1224 open-PR exclusion above (a candidate excluded there is never
# re-classified here — order matters, see this record's own Gotchas) and
# before the #1579 cross-PR overlap report below. When #1983's own "named
# target no longer exists" step lands, it inserts between the two, per that
# record's own ordering rule; this record does not implement #1983. Reuses
# $DISPATCH_LINKED_PRS's `mentions` field — #1984 extended record.js's
# batched query and linked-prs.js's fetchLinkedPRs to carry every same-repo
# PR that has ever cross-referenced the candidate, closing keyword or not —
# so no second network round trip is added for the base signal.
#
# First pass: classify every remaining candidate with title-only evidence
# (no changed-files fetch yet) via bin/lib/issues/shipped-candidate.js's
# classifyShipped. Only a `weak`-tier result (a merged mention whose title
# didn't already clear `strong`) is a candidate for the files-based upgrade
# below — a `strong`/`none` result from title evidence alone is final.
# Capped at 5 live `gh pr view` calls per pull (#1984's own cap).
node -e "
  const { classifyShipped } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/shipped-candidate.js');
  const groups = require(process.argv[1]);
  const linkedPRs = require(process.argv[2]);
  const toProbe = [];
  for (const c of groups.flat()) {
    const entry = linkedPRs[c.number];
    const mentions = (entry && entry.mentions) || [];
    if (mentions.length === 0) continue;
    const result = classifyShipped(c, mentions);
    if (result.tier === 'weak') toProbe.push(result.pr);
  }
  require('fs').writeFileSync(process.argv[3], JSON.stringify([...new Set(toProbe)].slice(0, 5)));
" "$DISPATCH_GROUPS" "$DISPATCH_LINKED_PRS" "$DISPATCH_SHIPPED_PROBE_PRS"

: > "$DISPATCH_SHIPPED_PR_FILES"
for PR in $(node -e "console.log(require(process.argv[1]).join(' '))" "$DISPATCH_SHIPPED_PROBE_PRS"); do
  FILES_JSON=$(gh pr view "$PR" --json files -q '[.files[].path]' 2>/dev/null || echo '[]')
  node -e "console.log(JSON.stringify({pr: Number(process.argv[1]), files: JSON.parse(process.argv[2])}))" "$PR" "$FILES_JSON" >> "$DISPATCH_SHIPPED_PR_FILES"
done

# Second pass: final tier, now with the probed files available for the
# key-files-covered upgrade. `strong` is excluded from $DISPATCH_GROUPS for
# this pull and logged for a staged Close proposal (dispatch never closes on
# GitHub itself — the proposal is the only write path, fingerprint-
# deduplicated the same way tidy's own Close (GitHub) shape is). `weak`
# stays eligible, logged for build-time context. `none` is silent.
node -e "
  const fs = require('fs');
  const { classifyShipped } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/shipped-candidate.js');
  const groups = require(process.argv[1]);
  const linkedPRs = require(process.argv[2]);
  const prFilesLines = fs.existsSync(process.argv[4])
    ? fs.readFileSync(process.argv[4], 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const prFiles = new Map(prFilesLines.map((e) => [e.pr, e.files]));
  const shippedExcluded = [];
  const finalGroups = groups
    .map((g) => g.filter((c) => {
      const entry = linkedPRs[c.number];
      const mentions = (entry && entry.mentions) || [];
      if (mentions.length === 0) return true;
      const result = classifyShipped(c, mentions, { prFiles });
      if (result.tier === 'strong') {
        shippedExcluded.push({ number: c.number, pr: result.pr, signals: result.signals });
        console.error('AUTO — dispatch: #' + c.number + ' excluded, shipped by merged PR #' + result.pr + ' (' + result.signals.join(', ') + ')');
        return false;
      }
      if (result.tier === 'weak') {
        console.error('AUTO — dispatch: #' + c.number + ' mentioned by merged PR #' + result.pr + ' without a closing keyword; dispatching anyway');
      }
      return true;
    }))
    .filter((g) => g.length > 0);
  fs.writeFileSync(process.argv[3], JSON.stringify(shippedExcluded));
  console.log(JSON.stringify(finalGroups));
" "$DISPATCH_GROUPS" "$DISPATCH_LINKED_PRS" "$DISPATCH_SHIPPED_EXCLUDED" "$DISPATCH_SHIPPED_PR_FILES" > "${DISPATCH_GROUPS}.tmp" && mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"

# Stage one Close proposal per strong-tier exclusion, into this firing's own
# standalone run dir (Step 1's $RUN_ID — resolved again here since this
# script has no other reason to carry that path) — never onto GitHub
# directly, the same non-autonomous posture tidy's own Close (GitHub) shape
# uses for every outward-facing mutation.
DISPATCH_FIRING_RUN_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug dispatch-standalone 2>/dev/null || true)
if [ -n "$DISPATCH_FIRING_RUN_DIR" ]; then
  node -e "
    const fs = require('fs');
    const path = require('path');
    const shippedExcluded = require(process.argv[1]);
    const tmpDir = process.argv[2];
    for (const entry of shippedExcluded) {
      const file = path.join(tmpDir, 'shipped-close-proposal-' + entry.number + '.md');
      fs.writeFileSync(file, [
        '## Close (GitHub)',
        '',
        '#' + entry.number + ' — deliverables already shipped by merged PR #' + entry.pr,
        '',
        'Signals: ' + entry.signals.join(', '),
        '',
        'Comment then close: \`gh issue close ' + entry.number + ' --comment \"Deliverables already shipped by #' + entry.pr + '\"\`',
      ].join('\n'));
      console.log(entry.number + '=' + file);
    }
  " "$DISPATCH_SHIPPED_EXCLUDED" "$(dirname "$DISPATCH_SHIPPED_EXCLUDED")" | while IFS='=' read -r NUM FILE; do
    node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$DISPATCH_FIRING_RUN_DIR" --id "shipped-close-$NUM" --file "$FILE" >/dev/null 2>&1 || true
  done
fi

# #1579: cross-PR root-cause overlap report. Runs unconditionally (both the
# cache-hit and cache-miss branches above leave $DISPATCH_GROUPS populated),
# read-only, and never removes anything from $DISPATCH_GROUPS or gates
# eligibility (AC2) -- SKILL.md Step 3's Cross-PR overlap report is what
# surfaces this file's contents, the same non-gating convention the
# Blocked-exclusion/Oversized-group reports already use. Fetches every open
# PR's changed files and the issue(s) it already closes/links -- a candidate
# whose key files overlap an UNRELATED open PR (one that does not already
# close/link that same candidate -- that pair is a re-dispatch guard, not
# this signal's job, see grouping.js's detectCrossPRFileOverlap doc comment)
# is a possible duplicate root-cause fix. `--limit 100` caps this to the 100
# most-recently-updated open PRs, same truncation posture as the queue pulls
# above (queue-pull-notes.md) -- a real risk on a repo with a large open-PR
# backlog, accepted for the same reason: this is one informational signal
# among several, not a correctness-critical filter.
gh pr list --state open --json number,files,closingIssuesReferences --limit 100 > "$DISPATCH_OPEN_PRS" 2>/dev/null || echo '[]' > "$DISPATCH_OPEN_PRS"
OPEN_PR_COUNT=$(node -e "console.log(require(process.argv[1]).length)" "$DISPATCH_OPEN_PRS")
if [ "$OPEN_PR_COUNT" -ge 100 ]; then
  echo "Warning: the open-PR pull for the cross-PR overlap report (#1579) returned exactly the --limit cap (100) — overlap detection may be missing older open PRs. Informational only; never blocks dispatch." >&2
fi
node -e "
  const { extractKeyFiles, detectCrossPRFileOverlap } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grouping.js');
  const groups = require(process.argv[1]);
  const openPrsRaw = require(process.argv[2]);
  const candidates = groups.flat().map((c) => ({ number: c.number, keyFiles: extractKeyFiles(c) }));
  const openPRs = openPrsRaw.map((pr) => ({
    number: pr.number,
    files: (pr.files || []).map((f) => f.path),
    closingIssueNumbers: (pr.closingIssuesReferences || []).map((i) => i.number),
  }));
  const overlaps = detectCrossPRFileOverlap(candidates, openPRs);
  require('fs').writeFileSync(process.argv[3], JSON.stringify(overlaps));
" "$DISPATCH_GROUPS" "$DISPATCH_OPEN_PRS" "$DISPATCH_CROSSPR_OVERLAP"

# #1944: cross-group near-duplicate candidate warning. Read-only and never a
# selection change (AC4) -- run findNearDuplicates pairwise across every pair
# of records that landed in DIFFERENT groups (a same-group pair is already
# co-built together by groupByFileOverlap, and has nothing new to warn about
# here). Each candidate that fires is logged once to this firing's own
# decisions.md as an AUTO line naming both records and the signals that fired
# -- the dispatcher's cue to look before dispatching both in the same firing,
# never a gate.
node -e "
  const { findNearDuplicates } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/near-duplicate.js');
  const groups = require(process.argv[1]);
  const seen = new Set();
  for (let i = 0; i < groups.length; i += 1) {
    for (const subject of groups[i]) {
      const others = groups.filter((_, j) => j !== i).flat();
      for (const hit of findNearDuplicates(subject, others)) {
        const key = [subject.number, hit.number].sort((a, b) => a - b).join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        console.error('AUTO — dispatch: near-duplicate candidates across groups: #' + subject.number + ' / #' + hit.number + ' (' + hit.signals.join(', ') + ')');
      }
    }
  }
" "$DISPATCH_GROUPS"
```

**MCP path** (`gh` unavailable): see `mcp-transport.md` in this skill's directory for the queue pull and the per-dependency open-state check. Both replace their `gh`-CLI equivalent one-for-one — no change to the surrounding `node -e` eligibility/dependency logic, which only consumes the fetched JSON shape, not how it was fetched.

**Queue-pull notes.** Read `queue-pull-notes.md` in this skill's directory when this repo sets `work-links: native` (the `bin/resolve-blockers.js` branch above), or when either pull returns exactly its `--limit` cap — it covers why the two bulk calls plus the bounded per-dependency fallback are shaped this way, what a truncated pull silently drops on each and which one has no per-record recovery, and the native query's fail-safe posture (including the `gh`-absent case). It changes nothing in the script above; skip it otherwise.
