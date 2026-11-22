# Spec Step 2 — Reuse a Plan Reviewed at Specify (#6060)

Read only from `build/SKILL.md`'s "Before Spec Step 3" pointer, once `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values plan-at-specify` prints `on`. `{worktree}` is the worktree root (the project root under current-branch), `{n}` the record, and `{spec}` the worktree's copy of `{run-dir}/work/{n}-spec.md` as `build/SKILL.md` defines it (`{run-dir}` is `$PIPELINE_RUN_DIR`, which a multi-spec run sets to its `spec-{N}/` subdirectory), that run-dir-relative path under `{worktree}` — never the main checkout's copy.

## Preconditions

In order, each its own plain call; a hit returns to Spec Step 3 as written:

1. When Spec Step 2 found a stale plan `{plan}` (the stale-plan route), `git log --diff-filter=A --format=%s -1 -- "{plan}"` prints the subject of the commit that added it (run once at plan time against the #6060 plan: printed `Add the #6060 build plan — …`). A subject starting with `Add the plan reviewed at specify` means this file already committed that plan: return to Spec Step 3, logging nothing.
2. When the materialize envelope for this record reported `template.changed: true`, skip reuse (Spec Step 3's template version delta needs a new plan, #1840): log `--status SKIP --section "/build" --step "Spec Step 2 (plan reuse)" --text "condition: template changed since filing → fallback: new plan written at Spec Step 3" --reversibility n/a`, then return to Spec Step 3.

## Probe

Resolve `{line-file}` with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value plan-reuse-line-{n}.txt`, then run this fence verbatim (run once at plan time against the real #6060 spec: printed `{"plan":"absent"}`):

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node -e 'const fs=require("fs");const {parsePlanLine}=require(process.env.PLUGIN_ROOT+"/bin/lib/issues/plan-line.js");const lines=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/);const end=lines.findIndex((l)=>/^## /.test(l));const hit=lines.slice(0,end===-1?lines.length:end).find((l)=>l.startsWith("Plan:"));if(hit===undefined){console.log(JSON.stringify({plan:"absent"}));process.exit(0)}fs.writeFileSync(process.argv[2],hit+"\n");const p=parsePlanLine(hit);console.log(JSON.stringify(p.ok?{plan:"present",ok:true,record:p.record,commit:p.commit}:{plan:"present",ok:false,reason:p.reason}))' "{spec}" "{line-file}"
```

Outcomes:

- `{"plan":"absent"}` — return to Spec Step 3 as written; this file logs nothing (AC1.1).
- `ok: false` — failed `malformed Plan line` (the only parse failure).
- `ok: true` but `record` is not `{n}` (the line names another record's plan) — failed `ref`.
- A non-zero exit, or output that is none of the three JSON shapes above, is an infrastructure fault (an unreadable spec or an unwritable session temp, right after Spec Step 1 read the spec), not a verdict on the plan: a BLOCKED stop — report the error and log no reuse verdict; Spec Step 3 is not entered from here.

## Checks

In order, the first failure wins, each its own plain call from the worktree:

1. Resolve `{integration-branch}` per `_shared/integration-branch.md`; `git merge-base HEAD origin/{integration-branch}` prints `{base}`, the newest integration-branch commit HEAD contains (no fetch: Common Step 1's catch-up already merged it). Run once at plan time: printed `639b48d5…`. A failed call is failed `base`.
2. `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" check --line-file "{line-file}" --spec-file "{spec}" --base {base}` — `{"valid": true}` (exit 0) passes; otherwise the reason is the JSON line's `failed` value (`ref`, `hash`, `base` or `files`); no JSON line is `ref`.
3. Resolve `{read-dir}` with `session-tmp-resolve.js --value plan-reuse-{n}`; `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" read --record {n} --commit {commit} --out "{read-dir}"` prints `{path}`, the `{read-path}`. Non-zero is `ref`.
4. `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" "{read-path}" --spec "{spec}" --repo-root "{worktree}"` — exit 0 passes; anything else is `plan-audit`.
5. Probe every `## Gotchas` bullet carrying `ASSUMPTION — verify at build:` exactly as Spec Step 3 does, logging each outcome as Spec Step 3 says; any reversed one is `premise` (the reused plan would build on a disproven claim, which Spec Step 3 never allows).

## All checks valid

`mkdir -p "docs/superpowers/plans"` (a project that never wrote a plan has no such directory), then `cp "{read-path}" "docs/superpowers/plans/{basename}"` (`{basename}` is `{read-path}`'s basename), `git add` that path, `git commit -m "Add the plan reviewed at specify ({commit})"`, each its own plain call. A failed `mkdir`, copy, `git add` or commit is an infrastructure fault, not a verdict on the plan: a BLOCKED stop — report the error and log no reuse verdict; Spec Step 3 is not entered from here. Otherwise, with a run dir, three `log-decision.js` calls (`--section "/build"`):

- `--status AUTO --step "Spec Step 2 (plan reuse)" --text "reused the plan reviewed at specify ({commit}), committed as {sha}" --reversibility high`
- `--status SKIP --step "Spec Step 3" --text "condition: plan reviewed at specify ({commit}) → fallback: stored plan reused, no new plan written" --reversibility n/a`
- `--status SKIP --step "Common Step 1.6 (plan review)" --text "condition: plan reviewed at specify ({commit}) → fallback: no plan review" --reversibility n/a`

Standalone (no run dir): list the three in the Step 7 handoff. Continue at Spec Step 2.5; skip Spec Step 3; Common Step 1.5 runs as today on the committed plan; skip Common Step 1.6; Common Step 1.7 onward as written.

## A check failed

Log `--status SKIP --step "Spec Step 2 (plan reuse)" --text "condition: plan-reuse failed: {reason} → fallback: new plan written at Spec Step 3" --reversibility n/a`, `{reason}` one of `ref`, `hash`, `base`, `files`, `plan-audit`, `malformed Plan line`, `premise`. Remove nothing from the worktree (nothing was written there). When Check 5 ran, it already logged every probe outcome, so Spec Step 3 reuses those outcomes and neither re-probes nor re-logs them. Spec Step 3 then runs as written, and its `/superpowers:writing-plans` context names every `Settled at planning:` and `Decided by the user at planning:` line in the spec's `## Planning Decisions` as a decided input. A new plan that departs from one logs it: write `planning decision departed: {line} → {plan behavior}` with the Write tool to the path `session-tmp-resolve.js --value plan-reuse-departure-{n}-{k}.md` prints, then `log-decision.js --status AUTO --section "/build" --step "Spec Step 3" --text-file "{text-file}" --reversibility high`.

## Resumed build

A resumed build finds the committed plan in Spec Step 2's plan search and takes the existing-plan branch; this file never runs again for it, and that branch re-decides Common Step 1.6 under its own rule (a reuse SKIP is not a completed review, so the review runs), unchanged. A stale plan this check committed (an `Add the plan reviewed at specify` commit) goes to Spec Step 3 as written, and this file logs no reuse verdict for it.
