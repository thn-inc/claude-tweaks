# Dispatch Step 2 — The Queue-Pull Script

Referenced by `skills/dispatch/SKILL.md` Step 2. Run this verbatim — it produces this run's session-scoped `dispatch-groups.json` (`_shared/session-tmp-root.md`), the per-record eligible queue (fast-lane bundles excepted) every selection form (bare, `next`, `#N`, `#N,#M,...`) reads next. It also produces this run's session-scoped `dispatch-exclusions.json` (#1752) — one array of `{reason, records: number[], detail}` entries, written and read through `bin/lib/dispatch/exclusions.js` (`readExclusions`/`appendExclusion`). The file is truncated (preserving only `firing`-reason entries — see `firing-exclusion.md`) at the start of this script's run, then the passes below append to it:

- `reason: 'blocked'` (`detail: {blockedBy: [ids]}`) — every otherwise-`auto:build`-eligible candidate this run's own blocked-by checks (body-text and, under `work-links: native`, the native `blockedBy` connection) dropped from the pool, via `record.js`'s `partitionByOpenBodyBlockers` for the body-text case and `record.js`'s `openBlockerRefs` over `bin/resolve-blockers.js`'s output (#4793) for the `work-links: native` case, or `native blockers (state unreadable)` when that query failed closed (#5309) — SKILL.md Step 2's Blocked-exclusion report reads these entries so a shrinking pool is never silent.
- `reason: 'oversized'` (`detail: {size, threshold}`, #1228) — every dispatch group `grouping.js`'s `partitionGroupsBySizeGuard` found over the size guard. These groups stay IN `dispatch-groups.json` (`#N`/`#N,#M,...` still resolve them normally); only bare drain's auto-selection (SKILL.md Step 3, reusing the `next`-alias ranking script) excludes an oversized group from its own candidate pool. SKILL.md Step 3's Oversized-exclusion report surfaces these entries too, so every form's exclusion (or non-exclusion) is never silent. Before the size guard runs, `grouping.js`'s `bundleFastLaneSingletons` (#1910) merges up to `dispatch-fastlane-bundle-cap` (default 3, `policy.yml`) non-overlapping `ceremony:fast-lane` singleton groups — same merge-grant state (`auto:merge` together with `auto:build`), same `priority:*` band, oldest-first — into one multi-spec group each, so the pool `dispatch-groups.json` carries already reflects any bundling; it also writes `dispatch-fastlane-bundles.json` (`{records: number[]}[]`), naming exactly the groups this pass created, so the Reporting section can call out a fast-lane bundle distinctly from an ordinary single-record group.
- `reason: 'neighbour-in-flight'` (`detail: {neighbours: [{number, files, signals?, sharedAnchors?}]}`, #3278, #3520) — every remaining candidate sharing a linking Key File, or a strong near-duplicate (`isStrongNearDuplicate`), with an open `bot:in-progress` record whose claim blob reads `live`. These records stay IN `dispatch-groups.json` (`#N`/`#N,#M,...` still report and dispatch them normally); only bare drain's ranking skips them. Fail open: an unreadable claim or a failed fetch means no exclusion.
- `reason: 'not-spec-shaped'` (`detail: {missing: [...]}`, #2829) — every candidate, right after grouping/bundling completes, whose cached body fails `/flow`'s Materialization hard gate (`shapeGate`, `bin/lib/issues/materialize-format.js`). This one DOES remove excluded candidates from `dispatch-groups.json`, running ahead of the `open-pr`/`target-missing`/`shipped` passes below, with no bypass (`not-spec-shaped-exclusion-report.md` says why).
- `reason: 'open-pr'` (`detail: {pr}`, #1224) — every remaining candidate already covered by an open, unmerged PR that will close it (GitHub's own `closedByPullRequestsReferences` connection, a closing keyword in the PR body), via `record.js`'s `partitionByOpenLinkedPR`. Unlike the blocked-by pass above, this one runs unconditionally, independent of `work-links`, and unlike the cross-PR overlap report below it DOES remove excluded candidates from `dispatch-groups.json` before any selection form reads it.
- `reason: 'target-missing'` (`detail: {path}`, #1983) — every remaining candidate whose `namedTarget` (`bin/lib/issues/named-target.js` — today, `by:docs-health` records only) names a file no longer present at the integration tip — a docs-health-filed ledger correction whose target a since-merged tidy sweep already deleted. This one DOES remove excluded candidates too, like the open-PR pass: such a record's own Acceptance Criteria is unsatisfiable, so re-dispatching it only burns a build attempt against the retry ceiling for nothing. Also stages one Close proposal in this firing's own run directory (`tidy`'s Close (GitHub) shape) so the next `tidy --approve` closes the record — nothing is written to GitHub by dispatch itself. SKILL.md Step 3's Blocked-exclusion report reads this reason too, under the same non-silent convention.
- `reason: 'shipped'` (`detail: {pr, signals}`, #1984) — every remaining candidate a merged PR's `strong`-tier mention already ships (see the False-positive posture note in `SKILL.md`). Also stages one Close proposal, exactly like the `target-missing` pass above. A mention from a PR opened before the record was created never counts (#4314); one merged before its last claim release rates `weak` at most (#4432).
- `reason: 'unlanded-blocker'` (`detail: {blockers: [{blocker, commit}]}`, #4792) — every remaining candidate with an out-of-run blocker that `preflight-records.js --blocker-landing` judges `unlanded` or `hollow` (closed, its closing commit not on `origin/{integration-branch}`), the verdicts `/flow` Step 2.7b stops on. This one DOES remove excluded candidates from `dispatch-groups.json`, with no `#N`/`#N,#M,...` bypass, and the record is eligible again on the first pull after its blocker lands. `bin/dispatch-unlanded-blockers.js` runs the pass and fails open: an `undetermined` verdict keeps the candidate, and a failed `preflight-records.js` call excludes no `unlanded-blocker` record.
- `reason: 'malformed-blocker'` (`detail: {cause}`, #4792) — every remaining candidate whose blocker declaration that pass cannot check, because it would fail the pass's `preflight-records.js` call for the whole pull or names no issue that can exist: a `Blocked by` line naming no valid issue number (`#0`, or above 2147483647, under every `work-links` value), no entry in the native dependency response, or a record the call cannot read. Removed the same way, with no bypass, and eligible again on the first pull after its blocker declaration can be checked; every other candidate is still checked. Eligibility writes it for non-array labels until fixed (#5315).

One further reason, `firing`, is never written by this script — it is appended incrementally by `SKILL.md`'s Loop between successive re-runs of this script within one firing (`firing-exclusion.md`), which is exactly why this script's own truncation step preserves it rather than dropping it.

```bash
DISPATCH_QUEUE_RAW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-queue-raw.json)"
DISPATCH_OPEN_NUMBERS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-open-numbers.json)"
DISPATCH_ELIGIBLE_PRE_DEP="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-eligible-pre-dep.json)"
DISPATCH_UNRESOLVED_DEPS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-unresolved-deps.json)"
DISPATCH_VERIFIED_OPEN_DEPS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-verified-open-deps.txt)"
DISPATCH_ELIGIBLE="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-eligible.json)"
DISPATCH_BLOCKED_EXCLUDED_BODY="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-blocked-excluded-body.json)"
DISPATCH_NATIVE_DEPS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-native-deps.json)"
DISPATCH_NATIVE_DEPS_TMP="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-native-deps.tmp.json)"
DISPATCH_NATIVE_DEPS_ERR="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-native-deps.err)"
DISPATCH_GROUPS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-groups.json)"
DISPATCH_EXCLUSIONS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-exclusions.json)"
DISPATCH_FASTLANE_BUNDLES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-fastlane-bundles.json)"
DISPATCH_IN_FLIGHT_RAW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-in-flight-raw.json)"
DISPATCH_IN_FLIGHT_CLAIMS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-in-flight-claims.json)"
DISPATCH_DEP_FRESHNESS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-dep-freshness.json)"
DISPATCH_OPEN_PRS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-open-prs.json)"
DISPATCH_CROSSPR_OVERLAP="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-crosspr-overlap.json)"
DISPATCH_NEAR_DUP_PAIRS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-near-dup-pairs.json)"
DISPATCH_LINKED_PRS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-linked-prs.json)"
DISPATCH_LINKED_PRS_ERR="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-linked-prs.err)"
DISPATCH_NAMED_TARGETS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-named-targets.json)"
DISPATCH_SHIPPED_PROBE_PRS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-shipped-probe-prs.json)"
DISPATCH_SHIPPED_PR_FILES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-shipped-pr-files.jsonl)"
DISPATCH_SHIPPED_RELEASES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-shipped-releases.json)"
DISPATCH_SHAPE_GATE_ERR="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-shape-gate.err)"
rm -f "$DISPATCH_NAMED_TARGETS" "$DISPATCH_SHIPPED_PROBE_PRS" "$DISPATCH_SHIPPED_RELEASES" "$DISPATCH_CROSSPR_OVERLAP" "$DISPATCH_NEAR_DUP_PAIRS" # #5409: no earlier pull's copy
# #1752: truncate dispatch-exclusions.json, keeping only 'firing' entries (the Loop's, firing-exclusion.md); other reasons are recomputed.
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_EXCLUSIONS" <<NODE_EVAL_EOF
  const { readExclusions } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const fs = require('fs');
  const kept = readExclusions(process.argv[1]).filter((e) => e.reason === 'firing');
  fs.writeFileSync(process.argv[1], JSON.stringify(kept));
NODE_EVAL_EOF

# #3691: MCP returns snake_case created_at/updated_at; this adds camelCase keys in place after each
# fetch (a no-op on gh input), so both transports run the same line.
# #5307: a non-array file is a Warning, left as written; the reads after it fail their own array checks.
alias_mcp_timestamps() {
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$@" <<NODE_EVAL_EOF
  const fs = require('fs');
  const { aliasMcpTimestamps } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/mcp-issue-shape.js');
  for (const file of process.argv.slice(1)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(value)) { console.error('Warning: ' + file + ' is not a JSON array — treated as a failed read'); process.exitCode = 1; continue; }
    fs.writeFileSync(file, JSON.stringify(aliasMcpTimestamps(value)));
  }
NODE_EVAL_EOF
}

gh issue list --label auto:build --state open --json number,title,body,labels,createdAt,updatedAt,state --limit 500 > "$DISPATCH_QUEUE_RAW"
alias_mcp_timestamps "$DISPATCH_QUEUE_RAW"
QUEUE_RAW_COUNT=$(node -e "const v = require(process.argv[1]); console.log(Array.isArray(v) ? v.length : 0)" -- "$DISPATCH_QUEUE_RAW")
if [ "$QUEUE_RAW_COUNT" -ge 500 ]; then
  echo "Warning: the auto:build queue pull returned exactly the --limit cap (500) — this repo may have more open auto:build records than fetched. gh issue list returns newest-first, so any records beyond the cap are the OLDEST same-priority ones, exactly what next's own oldest-first tie-break (Step 3) exists to surface first. Consider raising the cap, or filing this as a signal to re-triage the queue down." >&2
fi

# #1571: cache-check prefix. `updatedAt,state` (in DISPATCH_QUEUE_RAW's --json list) plus this one
# dependency-freshness call are the "at most two bulk calls" AC1 requires. The comparison and the
# persisted-blob read/write live in bin/lib/dispatch/queue-order.js. A cache, not a lock: racing firings
# both attempt the write-back below, and each CAS loser's own in-memory groups stay valid for it.
DISPATCH_DEP_NUMBERS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_QUEUE_RAW" <<NODE_EVAL_EOF
  const { mainCheckoutRoot } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js');
  const { readOrder, buildFreshnessSignal } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/queue-order.js');
  const root = mainCheckoutRoot(process.cwd()) || process.cwd();
  const persisted = readOrder(root);
  if (!persisted) { console.log(''); process.exit(0); }
  const autoBuildNumbers = new Set(require(process.argv[1]).map((i) => i.number));
  const depOnly = (persisted.freshnessSignal.issues || []).filter((i) => !autoBuildNumbers.has(i.number));
  console.log(depOnly.map((i) => i.number).join(','));
NODE_EVAL_EOF
)
echo '[]' > "$DISPATCH_DEP_FRESHNESS"
# Placeholder: the CACHE_HIT block below overwrites it with persisted.bundles (#2066) on a hit.
echo '[]' > "$DISPATCH_FASTLANE_BUNDLES"
if [ -n "$DISPATCH_DEP_NUMBERS" ]; then
  gh issue list --search "$(echo "$DISPATCH_DEP_NUMBERS" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || { echo '[]' > "$DISPATCH_DEP_FRESHNESS"; echo "Warning: dependency-freshness search failed — queue-order cache not used this run" >&2; }
fi
alias_mcp_timestamps "$DISPATCH_DEP_FRESHNESS"
CACHE_HIT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_QUEUE_RAW" "$DISPATCH_DEP_FRESHNESS" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" "$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values dispatch-group-size-guard)" "$DISPATCH_FASTLANE_BUNDLES" <<NODE_EVAL_EOF
  const { mainCheckoutRoot } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js');
  const { readOrder, buildFreshnessSignal, cacheUsable } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/queue-order.js');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const fs = require('fs');
  const root = mainCheckoutRoot(process.cwd()) || process.cwd();
  const persisted = readOrder(root);
  if (!persisted) { console.log('0'); process.exit(0); }
  const autoBuild = require(process.argv[1]);
  const depFreshness = require(process.argv[2]);
  if (!Array.isArray(autoBuild) || !Array.isArray(depFreshness)) throw new Error('not a JSON array');
  const current = buildFreshnessSignal([...autoBuild, ...depFreshness]);
  if (!autoBuild.length || !cacheUsable(persisted, current, require('${CLAUDE_PLUGIN_ROOT}/bin/lib/express/queue.js').expressQueuePolicy().grouping)) { console.log('0'); process.exit(0); }
  fs.writeFileSync(process.argv[3], JSON.stringify(persisted.groups));
  // persisted.excluded keeps the disk cache's {number, blockedBy}[] shape; convert to reason:'blocked' entries here.
  for (const e of persisted.excluded) {
    appendExclusion(process.argv[4], { reason: 'blocked', records: [e.number], detail: { blockedBy: e.blockedBy } });
  }
  const groupSizeGuard = parseInt(process.argv[5], 10);
  const { partitionGroupsBySizeGuard } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grouping.js');
  const { oversized, threshold } = partitionGroupsBySizeGuard(persisted.groups, { groupSizeGuard });
  for (const g of oversized) {
    appendExclusion(process.argv[4], { reason: 'oversized', records: g.map((i) => i.number), detail: { size: g.length, threshold } });
  }
  // #2066: a blob from before the field has no 'bundles' key: [].
  fs.writeFileSync(process.argv[6], JSON.stringify(persisted.bundles || []));
  console.log('1');
NODE_EVAL_EOF
)
CACHE_HIT_RC=$?
# #3110: a non-zero exit here (e.g. appendExclusion refusing a corrupt
# dispatch-exclusions.json) means this pass's exclusions may be partially
# written -- stop rather than fall through to the recompute below.
if [ "$CACHE_HIT_RC" -ne 0 ]; then
  echo "dispatch: queue-pull stopped -- cache-hit exclusion pass failed (exit $CACHE_HIT_RC); see error above." >&2
  exit 1
fi

if [ "$CACHE_HIT" = "1" ]; then
  echo "Queue-order cache hit — using persisted groups/excluded, skipping dependency verification and native blocker query (#1571)." >&2
fi

if [ "$CACHE_HIT" != "1" ]; then

gh issue list --state open --json number --limit 200 > "$DISPATCH_OPEN_NUMBERS"
WORK_LINKS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links)
DISPATCH_GROUP_SIZE_GUARD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values dispatch-group-size-guard)
DISPATCH_FASTLANE_BUNDLE_CAP=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values dispatch-fastlane-bundle-cap)
# #5314: no earlier pull's eligibility files.
rm -f "$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_UNRESOLVED_DEPS" "$DISPATCH_ELIGIBLE" "$DISPATCH_BLOCKED_EXCLUDED_BODY"
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_QUEUE_RAW" "$DISPATCH_OPEN_NUMBERS" "$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_UNRESOLVED_DEPS" "$DISPATCH_EXCLUSIONS" <<NODE_EVAL_EOF
  const { parseRecordFacets, parseDependencies } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const issues = require(process.argv[1]);
  const openNumbers = new Set(require(process.argv[2]).map((i) => i.number));
  for (const i of issues.filter((i) => i.labels != null && !Array.isArray(i.labels))) { require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js').appendExclusion(process.argv[5], { reason: 'malformed-blocker', records: [i.number], detail: { cause: 'its labels are not an array' } }); console.error('Warning: #' + i.number + ' excluded — its labels are not an array'); process.exitCode = 3; }
  const eligiblePreDep = issues.filter((i) => i.labels == null || Array.isArray(i.labels))
    .map((i) => ({ ...i, facets: parseRecordFacets(i.labels) }))
    .filter((i) => i.facets.grants.build && !i.facets.bot.inProgress && !i.facets.bot.blocked && !i.facets.bot.parked);
  // Outside the --limit 200 pull = unresolved, not closed: checked live below. #0/>GRAPHQL_INT_MAX: malformed-blocker's, unchecked.
  const unresolved = [...new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)).filter((dep) => dep > 0 && dep <= 2147483647 && !openNumbers.has(dep)))];
  require('fs').writeFileSync(process.argv[3], JSON.stringify(eligiblePreDep));
  require('fs').writeFileSync(process.argv[4], JSON.stringify(unresolved));
NODE_EVAL_EOF
[ $? -eq 3 ] && LABELS_SKIPPED=1 || LABELS_SKIPPED=
DEP_UNREADABLE=
rm -f "$DISPATCH_VERIFIED_OPEN_DEPS"
DEP_LIST=$(node -e "console.log(require(process.argv[1]).join(' '))" -- "$DISPATCH_UNRESOLVED_DEPS") && : > "$DISPATCH_VERIFIED_OPEN_DEPS"
for DEP in $DEP_LIST; do
  STATE=$(gh issue view "$DEP" --json state -q .state 2>/dev/null) || { STATE=OPEN; DEP_UNREADABLE=1; echo "Warning: gh issue view $DEP failed — dependency #$DEP treated as open (fail closed) this run" >&2; }
  if [ "$STATE" = "OPEN" ]; then echo "$DEP" >> "$DISPATCH_VERIFIED_OPEN_DEPS"; fi
done
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_OPEN_NUMBERS" "$DISPATCH_VERIFIED_OPEN_DEPS" "$DISPATCH_ELIGIBLE" "$DISPATCH_BLOCKED_EXCLUDED_BODY" "$DISPATCH_UNRESOLVED_DEPS" <<NODE_EVAL_EOF
  const fs = require('fs');
  const { partitionByOpenBodyBlockers } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const { bodyForeignBlockers } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/cross-repo-states.js');
  const eligiblePreDep = require(process.argv[1]);
  const openNumbers = new Set(require(process.argv[2]).map((i) => i.number));
  // #5311: missing/malformed: all unresolved count as open; exit 3 sets shell DEP_UNREADABLE.
  const lines = fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').filter(Boolean) : null;
  const bad = lines === null || lines.some((l) => !/^\d+$/.test(l.trim()));
  const unresolved = require(process.argv[6]);
  if (bad && unresolved.length) { process.stderr.write('Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run\n'); process.exitCode = 3; }
  const verifiedOpen = bad ? unresolved : lines.map(Number);
  for (const dep of verifiedOpen) openNumbers.add(dep);
  // #4793: DISPATCH_FOREIGN_STATES is set only on the MCP path (mcp-transport.md); unset asks gh.
  let statesIgnored = false;
  const stderr = (line) => { if (line.startsWith('Warning: foreign blocker states file ')) statesIgnored = true; else if (statesIgnored && /^Warning: foreign blocker state lookup failed \(exit 2: [^)]*gh[^)]* is required\)/.test(line)) return; process.stderr.write(line); };
  const { eligible, excluded } = partitionByOpenBodyBlockers(eligiblePreDep, openNumbers, bodyForeignBlockers(eligiblePreDep, { statesFile: process.env.DISPATCH_FOREIGN_STATES, stderr }));
  fs.writeFileSync(process.argv[4], JSON.stringify(eligible));
  fs.writeFileSync(process.argv[5], JSON.stringify(excluded));
NODE_EVAL_EOF
[ $? -ne 3 ] || DEP_UNREADABLE=1
echo '{}' > "$DISPATCH_NATIVE_DEPS"
DISPATCH_TRANSPORT="${DISPATCH_TRANSPORT:-gh}"
NATIVE_UNREADABLE=
if [ "$WORK_LINKS" = "native" ]; then
  NATIVE_NUMS=$(node -e "console.log(require(process.argv[1]).map((i) => i.number).join(','))" -- "$DISPATCH_ELIGIBLE")
  if [ -n "$NATIVE_NUMS" ]; then
    if node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-blockers.js" "$NATIVE_NUMS" \
      > "$DISPATCH_NATIVE_DEPS_TMP" 2>"$DISPATCH_NATIVE_DEPS_ERR" && mv "$DISPATCH_NATIVE_DEPS_TMP" "$DISPATCH_NATIVE_DEPS"; then
      :
    else
      NATIVE_RC=$?
      if [ "$DISPATCH_TRANSPORT" != files ] || [ "$NATIVE_RC" -eq 3 ]; then
        NATIVE_UNREADABLE=1
        echo "Warning: native dependency query failed — every candidate excluded as blocked (native blockers unreadable, fail closed) this run: $(cat "$DISPATCH_NATIVE_DEPS_ERR")" >&2
      else
        echo "Warning: native dependency query failed — falling back to no native filtering this run: $(cat "$DISPATCH_NATIVE_DEPS_ERR")" >&2
      fi
    fi
  fi
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_ELIGIBLE" "$DISPATCH_NATIVE_DEPS" "$DISPATCH_BLOCKED_EXCLUDED_BODY" "$DISPATCH_EXCLUSIONS" "$DISPATCH_GROUP_SIZE_GUARD" "$DISPATCH_FASTLANE_BUNDLE_CAP" "$DISPATCH_FASTLANE_BUNDLES" "$NATIVE_UNREADABLE" > "$DISPATCH_GROUPS" <<NODE_EVAL_EOF
  const fs = require('fs');
  const { extractKeyFiles, expectsKeyFilesSection, buildDispatchGroups, partitionGroupsBySizeGuard } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grouping.js');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const { openBlockerRefs } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const eligible = require(process.argv[1]);
  const nativeDeps = require(process.argv[2]);
  const finalEligible = [];
  const excludedNative = [];
  for (const c of eligible) {
    const dep = nativeDeps[c.number];
    const refs = process.argv[8] ? ['native blockers (state unreadable)'] : (dep ? openBlockerRefs(dep) : []);
    if (refs.length > 0) excludedNative.push({ number: c.number, blockedBy: refs });
    else finalEligible.push(c);
  }
  const items = finalEligible.map((i) => ({ id: i.number, keyFiles: extractKeyFiles(i) }));
  const byId = new Map(finalEligible.map((i) => [i.number, i]));
  for (const item of items) {
    if (item.keyFiles.length === 0 && expectsKeyFilesSection(byId.get(item.id))) {
      console.error('Warning: eligible record #' + item.id + ' has no ### Key Files subsection — overlap detection disabled for it.');
    }
  }
  // Grouping is per-record (#3278): one group per record, fast-lane bundles
  // (#1910) kept disjoint, before the size guard -- a bundle tops out at
  // bundleCap (default 3), always well under the size guard's own default of
  // 10, so ordering here never interacts with that gate.
  const bundleCap = parseInt(process.argv[6], 10);
  const { groups, bundles } = buildDispatchGroups(finalEligible, { bundleCap, keepSingleton: require('${CLAUDE_PLUGIN_ROOT}/bin/lib/express/queue.js').expressQueuePolicy().keepSingleton });
  console.log(JSON.stringify(groups));
  fs.writeFileSync(process.argv[7], JSON.stringify(bundles));
  const excludedBody = require(process.argv[3]);
  for (const e of [...excludedBody, ...excludedNative]) {
    appendExclusion(process.argv[4], { reason: 'blocked', records: [e.number], detail: { blockedBy: e.blockedBy } });
  }
  // Size guard (#1228): flagged, never removed from DISPATCH_GROUPS.
  const groupSizeGuard = parseInt(process.argv[5], 10);
  const { oversized, threshold } = partitionGroupsBySizeGuard(groups, { groupSizeGuard });
  for (const g of oversized) {
    appendExclusion(process.argv[4], { reason: 'oversized', records: g.map((i) => i.number), detail: { size: g.length, threshold } });
  }
NODE_EVAL_EOF
GROUPING_RC=$?
# #3110: stop, as the cache-hit check above does.
if [ "$GROUPING_RC" -ne 0 ]; then
  echo "dispatch: queue-pull stopped -- group-building exclusion pass failed (exit $GROUPING_RC); see error above." >&2
  exit 1
fi

# #1571: write-back, cache-miss path only; best-effort (AC5). #5309-#5311, #5315: skipped after a fail-closed verdict, a failed dependency search or non-array labels.
DISPATCH_ALL_DEP_NUMBERS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_ELIGIBLE_PRE_DEP" <<NODE_EVAL_EOF
  const { parseDependencies } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const eligiblePreDep = require(process.argv[1]);
  const deps = new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)));
  console.log([...deps].join(','));
NODE_EVAL_EOF
)
echo '[]' > "$DISPATCH_DEP_FRESHNESS"
DEP_FRESH_FAIL=
if [ -n "$DISPATCH_ALL_DEP_NUMBERS" ]; then
  gh issue list --search "$(echo "$DISPATCH_ALL_DEP_NUMBERS" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || { echo '[]' > "$DISPATCH_DEP_FRESHNESS"; DEP_FRESH_FAIL=1; echo "Warning: dependency-freshness search failed — queue-order cache not written this run" >&2; }
fi
alias_mcp_timestamps "$DISPATCH_DEP_FRESHNESS"
if [ -z "$NATIVE_UNREADABLE$DEP_UNREADABLE$DEP_FRESH_FAIL$LABELS_SKIPPED" ]; then
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_QUEUE_RAW" "$DISPATCH_DEP_FRESHNESS" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" "$DISPATCH_FASTLANE_BUNDLES" <<NODE_EVAL_EOF
  const { mainCheckoutRoot } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js');
  const path = require('path');
  const { writeOrder, buildFreshnessSignal, composeOrderBlob } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/queue-order.js');
  const { readExclusions } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const root = mainCheckoutRoot(process.cwd()) || process.cwd();
  const autoBuild = require(process.argv[1]);
  const depFreshness = require(process.argv[2]);
  if (!Array.isArray(autoBuild) || !Array.isArray(depFreshness)) throw new Error('not a JSON array');
  const groups = require(process.argv[3]);
  // The disk cache keeps its pre-#1752 {number, blockedBy}[] 'excluded' shape: reshape the 'blocked' entries here.
  const excluded = readExclusions(process.argv[4])
    .filter((e) => e.reason === 'blocked')
    .map((e) => ({ number: e.records[0], blockedBy: e.detail.blockedBy }));
  const bundles = require(process.argv[5]);
  const freshnessSignal = buildFreshnessSignal([...autoBuild, ...depFreshness]);
  const blob = composeOrderBlob({
    computedAt: new Date().toISOString(),
    runId: process.env.PIPELINE_RUN_DIR ? path.basename(process.env.PIPELINE_RUN_DIR) : null,
    freshnessSignal, groups, excluded, bundles, grouping: require('${CLAUDE_PLUGIN_ROOT}/bin/lib/express/queue.js').expressQueuePolicy().grouping,
  });
  const result = writeOrder(root, blob);
  if (!result.ok) console.error('Queue-order cache write-back failed (non-blocking): ' + result.error);
NODE_EVAL_EOF
fi

fi

# #2829: not-spec-shaped exclusion. Why here, and why no #N bypass: queue-pull-notes.md.
if node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" > "${DISPATCH_GROUPS}.tmp" 2>"$DISPATCH_SHAPE_GATE_ERR" <<NODE_EVAL_EOF
  const { shapeGate } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/materialize-format.js');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const groups = require(process.argv[1]);
  const finalGroups = groups
    .map((g) => g.filter((c) => {
      const result = shapeGate(c.body);
      if (!result.ok) {
        appendExclusion(process.argv[2], { reason: 'not-spec-shaped', records: [c.number], detail: { missing: result.missing } });
        return false;
      }
      return true;
    }))
    .filter((g) => g.length > 0);
  console.log(JSON.stringify(finalGroups));
NODE_EVAL_EOF
then
  mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"
else
  rm -f "${DISPATCH_GROUPS}.tmp"
  # #3110: same distinction as the open-linked-PR pass below -- a thrown
  # appendExclusion means the exclusions file may be partially written.
  if grep -q 'appendExclusion:' "$DISPATCH_SHAPE_GATE_ERR" 2>/dev/null; then
    echo "dispatch: queue-pull stopped -- not-spec-shaped exclusion pass hit a corrupt exclusions file: $(cat "$DISPATCH_SHAPE_GATE_ERR")" >&2
    exit 1
  fi
  echo "Warning: not-spec-shaped pass skipped — $(cat "$DISPATCH_SHAPE_GATE_ERR")" >&2
fi

# #1224: open-linked-PR exclusion. Why it runs unconditionally: queue-pull-notes.md.
DISPATCH_GROUP_NUMS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" <<NODE_EVAL_EOF
  const groups = require(process.argv[1]);
  console.log(groups.flat().map((i) => i.number).join(','))
NODE_EVAL_EOF
)
echo '{}' > "$DISPATCH_LINKED_PRS"
if [ -n "$DISPATCH_GROUP_NUMS" ]; then
  if ! node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-linked-prs.js" "$DISPATCH_GROUP_NUMS" \
    > "$DISPATCH_LINKED_PRS" 2>"$DISPATCH_LINKED_PRS_ERR"; then
    echo "Warning: linked-PR query failed — falling back to no open-PR or shipped-candidate exclusion this run: $(cat "$DISPATCH_LINKED_PRS_ERR")" >&2
    echo '{}' > "$DISPATCH_LINKED_PRS"
  fi
fi
if node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_LINKED_PRS" "$DISPATCH_EXCLUSIONS" > "${DISPATCH_GROUPS}.tmp" 2>"$DISPATCH_LINKED_PRS_ERR" <<NODE_EVAL_EOF
  const fs = require('fs');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const groups = require(process.argv[1]);
  const linkedPRs = require(process.argv[2]);
  const finalGroups = groups
    .map((g) => g.filter((c) => {
      const entry = linkedPRs[c.number];
      if (entry && entry.openPR) {
        appendExclusion(process.argv[3], { reason: 'open-pr', records: [c.number], detail: { pr: entry.openPR } });
        return false;
      }
      return true;
    }))
    .filter((g) => g.length > 0);
  console.log(JSON.stringify(finalGroups));
NODE_EVAL_EOF
then
  mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"
else
  rm -f "${DISPATCH_GROUPS}.tmp"
  # #3110: a thrown appendExclusion (corrupt
  # exclusions file) is not a transient
  # resolve-linked-prs.js/network issue: stop,
  # don't degrade unfiltered below.
  if grep -q 'appendExclusion:' "$DISPATCH_LINKED_PRS_ERR" 2>/dev/null; then
    echo "dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: $(cat "$DISPATCH_LINKED_PRS_ERR")" >&2
    exit 1
  fi
  echo "Warning: open-linked-PR filtering failed — dispatch-groups.json left unfiltered for this exclusion this run: $(cat "$DISPATCH_LINKED_PRS_ERR")" >&2
fi

# #1983: named-target existence exclusion. Why at the integration tip: queue-pull-notes.md.
DISPATCH_STANDALONE_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "dispatch-standalone")
# {integration-branch}: _shared/integration-branch.md ladder rank 3 (policy.yml), rank-6 git-remote fallback;
# ranks 4-5 need a human to disambiguate, and this script has none (settle-and-merge.md).
INTEGRATION_BRANCH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch)
if [ -z "$INTEGRATION_BRANCH" ]; then
  INTEGRATION_BRANCH=$(git remote show origin | sed -n '/HEAD branch/s/.*: //p')
fi
INTEGRATION_REF=${INTEGRATION_BRANCH:+origin/$INTEGRATION_BRANCH}
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_NAMED_TARGETS" <<NODE_EVAL_EOF
  const fs = require('fs');
  const { namedTarget } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/named-target.js');
  const groups = require(process.argv[1]);
  const named = groups.flat()
    .map((c) => ({ number: c.number, target: namedTarget(c) }))
    .filter((c) => c.target);
  fs.writeFileSync(process.argv[2], JSON.stringify(named));
NODE_EVAL_EOF
if [ -z "$INTEGRATION_BRANCH" ] || ! git rev-parse --verify --quiet "$INTEGRATION_REF^{commit}" >/dev/null 2>&1; then # #5305 empty, #5863 unresolved ref: skips only this pass
  echo "Warning: target-missing pass skipped — no resolvable integration branch" >&2
else
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_NAMED_TARGETS" "$INTEGRATION_REF" "$DISPATCH_EXCLUSIONS" <<NODE_EVAL_EOF
  const { execFileSync } = require('child_process');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const named = require(process.argv[1]);
  const ref = process.argv[2];
  const missing = named.filter(({ target }) => {
    try {
      execFileSync('git', ['cat-file', '-e', ref + ':' + target.path], { stdio: 'pipe' });
      return false;
    } catch {
      return true;
    }
  });
  for (const { number, target } of missing) {
    appendExclusion(process.argv[3], { reason: 'target-missing', records: [number], detail: { path: target.path } });
  }
NODE_EVAL_EOF
TARGET_MISSING_RC=$?
# #3110: stop rather than continue with a partial exclusion list when
# appendExclusion throws.
if [ "$TARGET_MISSING_RC" -ne 0 ]; then
  echo "dispatch: queue-pull stopped -- target-missing exclusion pass failed (exit $TARGET_MISSING_RC); see error above." >&2
  exit 1
fi
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" > "${DISPATCH_GROUPS}.tmp" <<NODE_EVAL_EOF && mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"
  const fs = require('fs');
  const { readExclusions, groupIsExcluded } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const groups = require(process.argv[1]);
  const entries = readExclusions(process.argv[2]);
  const finalGroups = groups
    .map((g) => g.filter((c) => !groupIsExcluded([c], entries, ['target-missing'])))
    .filter((g) => g.length > 0);
  console.log(JSON.stringify(finalGroups));
NODE_EVAL_EOF
for ROW in $(node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_EXCLUSIONS" <<NODE_EVAL_EOF
  const { readExclusions } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const missing = readExclusions(process.argv[1])
    .filter((e) => e.reason === 'target-missing')
    .map((e) => ({ number: e.records[0], path: e.detail.path }));
  for (const m of missing) console.log(Buffer.from(JSON.stringify(m)).toString('base64'));
NODE_EVAL_EOF
); do
  NUM=$(node -e "console.log(JSON.parse(Buffer.from(process.argv[1], 'base64').toString()).number)" -- "$ROW")
  TPATH=$(node -e "console.log(JSON.parse(Buffer.from(process.argv[1], 'base64').toString()).path)" -- "$ROW")
  node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$DISPATCH_STANDALONE_DIR" --status AUTO \
    --text "dispatch: #${NUM} excluded, named target ${TPATH} absent at ${INTEGRATION_REF}" --reversibility n/a
  PROPOSAL="$(dirname "$DISPATCH_EXCLUSIONS")/target-missing-proposal-${NUM}.md"
  {
    echo "# Staged: Close (GitHub) — #${NUM} (named target absent at ${INTEGRATION_REF})"
    echo ""
    echo "**Finding:** \`[gh-issue] #${NUM}\` names target \`${TPATH}\`, which is absent at \`${INTEGRATION_REF}\` — deleted by a later commit after this record was filed."
    echo ""
    echo "**Proposed:** Close #${NUM} as not planned — named target deleted, nothing left to fix."
    echo ""
    echo "**Commands:**"
    echo "gh issue comment ${NUM} --body $(node -e "console.log(\"'\"+process.argv[1].replace(/'/g,\"'\\\\''\")+\"'\")" -- "Closing: the named target ${TPATH} no longer exists at ${INTEGRATION_REF} — this record's Acceptance Criteria has no remaining target. Filed by /claude-tweaks:dispatch (queue pull).")"
    echo "gh issue close ${NUM} --reason \"not planned\""
  } > "$PROPOSAL" || continue
  # stage-item.js is the sanctioned writer for a run dir's staged/
  # (pipeline-run-dir.md) -- never a direct Write/heredoc into it. Comment quoting: queue-pull-notes.md.
  node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$DISPATCH_STANDALONE_DIR" --id "dispatch-target-missing-${NUM}" --file "$PROPOSAL"
done

# #5304: a stop before the claim line prints the shipped claims read so far, once (at each stop below that calls this).
flush_shipped_claims() {
  node -e "const s = (() => { try { const v = JSON.parse(process.argv[1]); return Array.isArray(v) ? v : []; } catch (e) { return []; } })(); if (s.length) console.error('AUTO — dispatch: shipped-candidate claim read failed for ' + s.join(', ') + '; release time unknown, no downgrade')" -- "${SHIPPED_UNREADABLE:-[]}"
}

# #1984/#4314/#4432/#5722: first pass title-only; probes a `weak` not downgraded after the merge.
SHIPPED_UNREADABLE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_LINKED_PRS" "$DISPATCH_SHIPPED_PROBE_PRS" "$DISPATCH_SHIPPED_RELEASES" <<NODE_EVAL_EOF
  const { classifyShipped, downgradedAfterMerge } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/shipped-candidate.js');
  const groups = require(process.argv[1]);
  const linkedPRs = require(process.argv[2]);
  const unreadable = [];
  const releases = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/shipped-releases.js').writeReleaseTimes(process.argv[4], groups.flat(), linkedPRs, { unreadable });
  console.log(JSON.stringify(unreadable));
  const toProbe = [];
  for (const c of groups.flat()) {
    const entry = linkedPRs[c.number];
    const mentions = (entry && entry.mentions) || [];
    if (mentions.length === 0) continue;
    const result = classifyShipped(c, mentions, { lastReleasedAt: releases[c.number], lastShapedAt: entry.lastShapedAt });
    if (result.tier === 'weak' && !downgradedAfterMerge(result)) toProbe.push(result.pr);
  }
  require('fs').writeFileSync(process.argv[3], JSON.stringify([...new Set(toProbe)].slice(0, 5)));
NODE_EVAL_EOF
)

: > "$DISPATCH_SHIPPED_PR_FILES"
for PR in $(node -e "console.log(require(process.argv[1]).join(' '))" -- "$DISPATCH_SHIPPED_PROBE_PRS"); do
  FILES_JSON=$(gh pr view "$PR" --json files -q '[.files[].path]' 2>/dev/null) || FILES_JSON=null
  node -e "console.log(JSON.stringify({pr: Number(process.argv[1]), files: JSON.parse(process.argv[2])}))" -- "$PR" "$FILES_JSON" >> "$DISPATCH_SHIPPED_PR_FILES"
done

# #1984/#4314/#4432/#5722, second pass: `strong` is excluded for a staged Close; `weak` stays.
if node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_LINKED_PRS" "$DISPATCH_EXCLUSIONS" "$DISPATCH_SHIPPED_PR_FILES" "$DISPATCH_SHIPPED_RELEASES" > "${DISPATCH_GROUPS}.tmp" <<NODE_EVAL_EOF
  const fs = require('fs');
  const { classifyShipped, predatesClaimRelease, downgradedAfterMerge } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/shipped-candidate.js');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const groups = require(process.argv[1]);
  const linkedPRs = require(process.argv[2]);
  const prFilesLines = fs.existsSync(process.argv[4])
    ? fs.readFileSync(process.argv[4], 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const prFiles = new Map(prFilesLines.map((e) => [e.pr, e.files]));
  const releases = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/shipped-releases.js').readReleaseTimes(process.argv[5]);
  const finalGroups = groups
    .map((g) => g.filter((c) => {
      const entry = linkedPRs[c.number];
      const mentions = (entry && entry.mentions) || [];
      if (mentions.length === 0) return true;
      const result = classifyShipped(c, mentions, { prFiles, lastReleasedAt: releases[c.number], lastShapedAt: entry.lastShapedAt });
      if (result.tier === 'strong') {
        appendExclusion(process.argv[3], { reason: 'shipped', records: [c.number], detail: { pr: result.pr, signals: result.signals } });
        console.error('AUTO — dispatch: #' + c.number + ' excluded, shipped by merged PR #' + result.pr + ' (' + result.signals.join(', ') + ')');
        return false;
      }
      if (result.tier === 'weak') {
        console.error('AUTO — dispatch: #' + c.number + (predatesClaimRelease(result)
          ? ' kept: merged PR #' + result.pr + ' predates claim release at ' + releases[c.number] + ' — remaining work assumed'
          : downgradedAfterMerge(result)
            ? ' kept: merged PR #' + result.pr + ' predates ready/auto:build labeling at ' + entry.lastShapedAt + ' — remaining work assumed'
            : ' mentioned by merged PR #' + result.pr + ' without a closing keyword; dispatching anyway'));
        if (!downgradedAfterMerge(result) && prFiles.get(result.pr) === null) console.error('Warning: gh pr view ' + result.pr + ' failed — #' + c.number + ' kept as a weak shipped candidate (files unprobed) this run');
      }
      return true;
    }))
    .filter((g) => g.length > 0);
  console.log(JSON.stringify(finalGroups));
NODE_EVAL_EOF
then
  mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"
else
  # #3110: stop -- this pass's shipped-candidate exclusions may be only
  # partially written (e.g. appendExclusion refusing a corrupt file).
  flush_shipped_claims
  echo "dispatch: queue-pull stopped -- shipped-candidate exclusion pass failed; see error above." >&2
  rm -f "${DISPATCH_GROUPS}.tmp"
  exit 1
fi

# Stage one Close proposal per strong-tier exclusion into this firing's standalone run dir, never onto GitHub.
DISPATCH_FIRING_RUN_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug dispatch-standalone 2>/dev/null || true)
if [ -n "$DISPATCH_FIRING_RUN_DIR" ]; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_EXCLUSIONS" "$(dirname "$DISPATCH_EXCLUSIONS")" <<NODE_EVAL_EOF | while IFS='=' read -r NUM FILE; do
    const fs = require('fs');
    const path = require('path');
    const { readExclusions } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
    const shippedExcluded = readExclusions(process.argv[1])
      .filter((e) => e.reason === 'shipped')
      .map((e) => ({ number: e.records[0], pr: e.detail.pr, signals: e.detail.signals }));
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
        'Comment then close: \`gh issue close ' + entry.number + ' --comment "Deliverables already shipped by #' + entry.pr + '"\`',
      ].join('\n'));
      console.log(entry.number + '=' + file);
    }
NODE_EVAL_EOF
    node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$DISPATCH_FIRING_RUN_DIR" --id "shipped-close-$NUM" --file "$FILE" >/dev/null || true
  done
fi

# #4792: unlanded-blocker and malformed-blocker exclusions. Why here, and why it fails open: queue-pull-notes.md.
if node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-unlanded-blockers.js" --groups "$DISPATCH_GROUPS" --exclusions "$DISPATCH_EXCLUSIONS" --integration-branch "$INTEGRATION_BRANCH" --work-links "$WORK_LINKS" > "${DISPATCH_GROUPS}.tmp"; then
  mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"
else
  rm -f "${DISPATCH_GROUPS}.tmp"
  flush_shipped_claims
  echo "dispatch: queue-pull stopped -- unlanded-blocker exclusion pass failed; see error above." >&2
  exit 1
fi

# #3278: neighbour-in-flight pass. Neighbour: a linking Key File or a strong
# near-duplicate (isStrongNearDuplicate, #3520). Claim blobs chain one fetch via the first git-tip read.
# MCP transport: mcp-transport.md's neighbour-in-flight section replaces this pass.
if ! gh issue list --label bot:in-progress --state open --json number,title,body,labels --limit 200 > "$DISPATCH_IN_FLIGHT_RAW" 2>/dev/null; then
  echo '[]' > "$DISPATCH_IN_FLIGHT_RAW"
  echo "AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull" >&2
fi
IN_FLIGHT_COUNT=$(node -e "console.log(require(process.argv[1]).length)" -- "$DISPATCH_IN_FLIGHT_RAW")
if [ -n "$IN_FLIGHT_COUNT" ] && [ "$IN_FLIGHT_COUNT" -ge 200 ]; then
  echo "Warning: the bot:in-progress pull for the neighbour-in-flight pass (#3278) returned exactly the --limit cap (200) — in-flight records beyond the cap are not checked as neighbours. Informational only; never blocks dispatch." >&2
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" "$DISPATCH_EXCLUSIONS" "${SHIPPED_UNREADABLE:-[]}" <<NODE_EVAL_EOF
  // #5304: one line per pull, printed on every exit of this process (the finally), so an append that throws still reports the
  // neighbour claims read before it. The shipped pass's unreadable claims (argv 4) join this pass's. This node process makes its own claim
  // reader, so the fence reads claims twice by necessity (two processes); the module shares one (claimReader(ctx)).
  const shipped = (() => { try { const v = JSON.parse(process.argv[4]); return Array.isArray(v) ? v : []; } catch (e) { return []; } })();
  let neighbour = [];
  try {
    const { neighbourInFlightExclusions } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/in-flight-neighbours.js');
    const { createClaimReader } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claim-store.js');
    const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
    const result = neighbourInFlightExclusions({
      candidates: require(process.argv[1]).flat(), inFlight: require(process.argv[2]), readClaimContent: createClaimReader().read, now: Date.now(),
    });
    neighbour = result.unreadable.map((n) => '#' + n);
    for (const e of result.exclusions) appendExclusion(process.argv[3], e);
  } finally {
    if (shipped.length && neighbour.length) console.error('AUTO — dispatch: claim read failed for ' + shipped.concat(neighbour).join(', ') + '; shipped-candidate release time unknown, no downgrade; neighbour-in-flight treated as not in flight');
    else if (neighbour.length) console.error('AUTO — dispatch: neighbour-in-flight claim read failed for ' + neighbour.join(', ') + '; treated as not in flight');
    else if (shipped.length) console.error('AUTO — dispatch: shipped-candidate claim read failed for ' + shipped.join(', ') + '; release time unknown, no downgrade');
  }
NODE_EVAL_EOF
NEIGHBOUR_RC=$?
if [ "$NEIGHBOUR_RC" -ne 0 ]; then
  echo "dispatch: queue-pull stopped -- neighbour-in-flight exclusion pass failed (exit $NEIGHBOUR_RC); see error above." >&2
  exit 1
fi

# #1579: cross-PR root-cause overlap report. Runs unconditionally, read-only, never gates eligibility
# (AC2); SKILL.md Step 3 surfaces its file. A candidate whose key files overlap an UNRELATED open PR
# (grouping.js's detectCrossPRFileOverlap) is a possible duplicate fix. `--limit 100`: the same
# truncation posture as the queue pulls (queue-pull-notes.md).
gh pr list --state open --json number,files,closingIssuesReferences --limit 100 > "$DISPATCH_OPEN_PRS" 2>/dev/null || { echo '[]' > "$DISPATCH_OPEN_PRS"; echo "Warning: open-PR pull failed — cross-PR overlap not checked this run" >&2; }
OPEN_PR_COUNT=$(node -e "console.log(require(process.argv[1]).length)" -- "$DISPATCH_OPEN_PRS")
if [ "$OPEN_PR_COUNT" -ge 100 ]; then
  echo "Warning: the open-PR pull for the cross-PR overlap report (#1579) returned exactly the --limit cap (100) — overlap detection may be missing older open PRs. Informational only; never blocks dispatch." >&2
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_OPEN_PRS" "$DISPATCH_CROSSPR_OVERLAP" <<NODE_EVAL_EOF
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
NODE_EVAL_EOF

# #1944: cross-group near-duplicate warning. Removes nothing from $DISPATCH_GROUPS (AC4). Pairs span
# DIFFERENT groups only (a same-group pair is a fast-lane bundle, already co-built). Each firing pair is
# logged to decisions.md as an AUTO line. Since #3520 the STRONG pairs (isStrongNearDuplicate) also go to
# $DISPATCH_NEAR_DUP_PAIRS, always written ([] when none), for Step 4/6 and the explicit-list line.
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_NEAR_DUP_PAIRS" <<NODE_EVAL_EOF
  const { nearDuplicatePairsAcrossGroups } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/near-dup-pairs.js');
  const pairs = nearDuplicatePairsAcrossGroups(require(process.argv[1]));
  for (const p of pairs) console.error('AUTO — dispatch: near-duplicate candidates across groups: #' + p.records[0] + ' / #' + p.records[1] + ' (' + p.signals.join(', ') + ')');
  require('fs').writeFileSync(process.argv[2], JSON.stringify(pairs.filter((p) => p.strong).map(({ records, signals, sharedAnchors }) => ({ records, signals, sharedAnchors }))));
NODE_EVAL_EOF
```

**MCP path** (`gh` unavailable): see `mcp-transport.md` in this skill's directory for the queue pull and the per-dependency open-state check. Both replace their `gh`-CLI equivalent one-for-one — no change to the surrounding `node -e` eligibility/dependency logic, which only consumes the fetched JSON shape, not how it was fetched. **That file's own `#3137` subsection documents a `list_issues` `fields`-triggered label-truncation gotcha and its required per-candidate cross-check mitigation — read it before trusting this pull's labels for any eligibility/exclusion decision.** `list_issues`/`issue_read` return snake_case `created_at`/`updated_at`; this script's `alias_mcp_timestamps` calls (`#3691`) alias both `$DISPATCH_QUEUE_RAW` and `$DISPATCH_DEP_FRESHNESS` unconditionally, so write the raw MCP JSON to those paths and run the script as written (see `mcp-transport.md`'s `#3691` subsection). The Write calls split the script across several Bash calls and a shell function does not survive between calls, so re-run the `alias_mcp_timestamps() { … }` definition at the top of any Bash call that calls it.

**Queue-pull notes.** Read `queue-pull-notes.md` in this skill's directory when this repo sets `work-links: native` (the `bin/resolve-blockers.js` branch above), or when either pull returns exactly its `--limit` cap — it covers why the two bulk calls plus the bounded per-dependency fallback are shaped this way, what a truncated pull silently drops on each and which one has no per-record recovery, and the native query's fail-safe posture (including the `gh`-absent case). It changes nothing in the script above; skip it otherwise.
