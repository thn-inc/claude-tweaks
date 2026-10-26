---
files:
  - plugin/bin/lib/shared-primitives.js
  - plugin/bin/lib/plan-audit/checks.js
  - plugin/bin/lib/docs-health/findability.js
  - plugin/bin/lib/code-health/scope.js
  - plugin/bin/lib/residue/probes/worktrees.js
  - plugin/bin/lib/residue/probes/pipeline-runs.js
  - plugin/bin/lib/timing/transcript.js
  - plugin/bin/lib/timing/turn-class.js
---

# Run the Health Tools on a Windows Checkout

**Persona:** claude-tweaks user who works in a Windows checkout of their project (Git for Windows, native `C:\...` paths) and runs the plugin's own CLIs — directly or through `/claude-tweaks:build`, `/claude-tweaks:docs-health`, `/claude-tweaks:code-health`, `/claude-tweaks:wrap-up` — exactly as a macOS or Linux user would.
**Goal:** Get the same answers a POSIX checkout gives: the same file IDs, the same slices, the same reaper classification, the same skill-load numbers — not output that silently differs because a path came back with `\` separators.
**Entry point:** Any of `node plugin/bin/plan-audit.js {plan}`, `node plugin/bin/docs-health.js find-refs {doc}`, `node plugin/bin/code-health.js`, `node plugin/bin/residue.js`, `node plugin/bin/skill-load-report.js` — or the skill step that runs it.
**Success state:** Every path the tool prints as an identifier reads with `/` (`plugin/bin/new`, `docs/guide/howto.md`), nested code-health slices keep their own entries, a worktree under `.claude\worktrees\` counts as in the reaper domain, and a transcript's Windows-path skill reads count as procedure bytes. Paths the tool later opens on disk stay native.

## Steps

### 1. Audit a plan before dispatch — `plan-audit.js {plan}`
- **Action:** Run the plan audit (or let `/claude-tweaks:build` Common Step 1.5 run it) on a plan whose `Create:`/`Modify:` entry names a file in a directory that does not exist yet, or whose `Scope keywords:` match unplanned files.
- **Should feel:** Identical to a POSIX run — the missing entry's `nearestExistingAncestor` and Check B's `unplanned` list are the repo-relative IDs the plan itself uses.
- **Should understand:** `nearestExistingAncestor` falls back to `.` when the nearest existing directory is the repo root.
- **Red flags:** `plugin\bin` in `nearestExistingAncestor`, or `plugin\bin\hit.js` in `unplanned` — IDs that no longer match the plan's own `/` paths.

### 2. Find what links to a doc — `docs-health.js find-refs {doc}`
- **Action:** Ask docs-health which files reference a doc (the findability check behind `/claude-tweaks:docs-health`).
- **Should feel:** Trustworthy — the `referencedBy` list can be pasted into a registry row or compared across machines.
- **Red flags:** `docs\guide\howto.md` in `referencedBy`.

### 3. Pick a code-health slice — `code-health.js`
- **Action:** Run a code-health sweep on a repo with an oversized directory that has nested subdirectories (over the 30 KiB slice cap).
- **Should feel:** Complete — every nested subdirectory that needs its own slice gets one (`big/one/deeper`), exactly as on POSIX.
- **Should understand:** Slice IDs are `/`-joined; each slice's `path` is a native absolute path, because the sweep opens it.
- **Red flags:** A nested subdirectory missing from the slice list, or a bogus child slice named `one\deeper` — the files inside it silently drop out of rotation.

### 4. Close out a run's residue — `residue.js` (via `/claude-tweaks:wrap-up`)
- **Action:** Let the residue sweep classify leftover worktrees, whether git printed them as `C:/repo/.claude/worktrees/x` or `C:\repo\.claude\worktrees\x`, and report any closed-but-unarchived pipeline run dir.
- **Should feel:** Like nothing special — plugin-provisioned worktrees read `in reaper domain`, everything else `outside reaper domain (no reaper collects it)`; a leftover run dir's finding reads `.claude-tweaks/pipelines/{run-id}`, the same ID a POSIX sweep prints.
- **Red flags:** A plugin worktree reported as outside the reaper domain (it would be routed to you instead of the reaper), whichever separator git used; a pipeline-run finding whose subject reads `.claude-tweaks\pipelines\{run-id}`.

### 5. Measure skill load from a transcript — `skill-load-report.js`
- **Action:** Measure which skill files a session read, from a transcript recorded on Windows (`file_path` values like `C:\repo\plugin\skills\review\SKILL.md` or the installed plugin cache under `C:\Users\...\.claude\plugins\cache\...`).
- **Should feel:** Accurate — procedure bytes match what the session actually read.
- **Red flags:** Zero or undercounted procedure bytes for a Windows transcript, or a non-skill `.md` (e.g. `docs\notes.md`) counted as a procedure read.

## Origin
- Created during build of record #3315 (flow run `2026-10-22T001546-record-3315`), fixing the latent Windows path producers #2767's class map found.
- Steps 1-5 built in this session; on POSIX every step's output is unchanged.
- Step 4's pipeline-run subject added by record #4430 (flow run `2026-10-26T170403-spec-4430`) — the last residue display ID built with a native `path.relative`.
- Related: record #2767 (the class map), `learn-of-a-windows-regression-after-merge.md` (how a Windows-only break is reported after merge).
