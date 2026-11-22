---
files:
  - plugin/bin/hooks.js
  - plugin/bin/lib/stage-item/ledger.js
  - plugin/bin/lib/wrap-up/ledger-write.js
  - plugin/bin/lib/wrap-up/ledger-cells.js
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/skills/_shared/ledger-format.md
---

# Record or Settle a Ledger Row From a Worktree

**Persona:** An agent session running `/claude-tweaks:build`, `/claude-tweaks:review` or `/claude-tweaks:wrap-up` inside a worktree-isolated `/flow` run. It has a finding to record (a deferred minor, an ops item, a review finding) or an existing row to settle (`fixed` after a fix commit, `acknowledged` at the resolve gate). Run `2026-10-26T123848-spec-4336-4419-4420-4421` hit this point and logged 42 harness refusals trying to hand-write those rows.
**Goal:** Append or settle exactly one row in the run's open-items ledger. The write must take the ledger lock and must never leave a half-written or mis-columned table, and the session must not have to hand-edit table lines the worktree guard refuses.
**Entry point:** Any writing site that cites `_shared/ledger-format.md`'s Writer section. Examples are `build/SKILL.md` Common Step 4, `review/step3-routing.md`'s finding append, and the resolve gate's Phase 3.
**Success state:** The verb prints one JSON line, e.g. `{"action":"appended","row":7,"status":"open","ledger":"…"}` or `{"action":"settled","row":3,"status":"fixed",…}`, and exits 0. The ledger holds the new or rewritten row as a single 5-column line with any `|` escaped. Every other line is byte-identical. The session moves on, confident that the row landed exactly once.

## Steps

### 1. Append a row — `node "{plugin-root}/bin/hooks.js" ledger-row --run "{run-dir}" --phase build --item-file "{tmp}" --status open`
- **URL:** `docs/plans/{date}-{slug}-ledger.md` (resolved from the run, or named with `--ledger`)
- **Action:** The session writes text it did not write itself (a finding, git output, user words) to a session temp file with the Write tool, then passes it with `--item-file`. Short literal text it wrote itself can go through `--item` directly. In a worktree session it substitutes the literal plugin root for `${CLAUDE_PLUGIN_ROOT}`.
- **Should feel:** One plain command, with no quoting gymnastics. The worktree guard accepts it, unlike the `node -e`/heredoc/`printf >>` forms that used to be refused.
- **Should understand:**
  - The verb takes `{run-dir}/.ledger.lock`, re-reads the ledger, writes it atomically, and escapes `|` itself, so the text goes in raw.
  - The JSON `row` is the item number, which a staged patch's `Ledger:` field needs.
  - `--phase` accepts any non-blank value.
- **Red flags:**
  - Pre-escaping the text, which leaves a stray `\\|`.
  - Dropping `--run` when the run has a run dir.
  - Reading the verb's `no pipeline run dir found` refusal as permission to hand-edit.

### 2. Settle a row by number — `ledger-row --run "{run-dir}" --row {N} --status fixed --resolution-file "{tmp}"`
- **URL:** the same ledger file, row `{N}`
- **Action:** After a fix commit, or at the resolve gate, the session settles the row. Only that row's Status and Resolution cells change.
- **Should feel:** Surgical. The other rows stay byte-for-byte as they were.
- **Should understand:**
  - Status must be one of `open, fixed, deferred, accepted, acknowledged, observation`.
  - `fixed` needs a commit sha, a file reference, `PR #N`, or this repo's `/pull/N`, `/commit/<sha>` or `/blob/…` URL. A bare `#N` is refused.
  - `deferred` needs a `staged/…` path or a record reference. A single valid `Defer-reason:` alone is accepted but comes back `"incompleteDeferral": true`, for the resolve gate to finish.
  - A terminal row cannot be rewritten. The two exceptions are an incomplete deferral, and the refused-proposal reopen to `open`, whose Resolution carries `proposal refused — no defer reason`.
- **Red flags:** Expecting `--status resolved` to work (it is refused, and the error names the enum). Re-settling an already-`fixed` row to change its wording instead of adding a new item.

### 3. Handle a refusal — stderr ends the write, exit 1 (or 2 for a text-file usage error)
- **URL:** the verb's stderr and the run's `decisions.md`
- **Action:** On a non-zero exit, the session follows the Writer section's one refusal rule:
  - A `LOCK_TIMEOUT` is retried once.
  - An `ambiguous`, `unattributable`, `not-found` or `rejected` ledger is re-run once with an explicit `--ledger` taken from `hooks.js resolve-ledger`'s candidates.
  - A rule refusal is re-run once with the arguments it names corrected. Examples: an interior newline in a text file is rewritten as one line with its lines joined by `; `, and `origin repo unresolvable` is re-run with `PR #N`.
  - A `multiple candidate runs` refusal is retried only when exactly one listed candidate is the caller's own run.
  - Anything still refused stays unwritten and gets a `SKIP` line: `condition: ledger-row exited {code}: {stderr} → fallback: row not written`.
- **Should feel:** Predictable. Each refusal names its kind, so the next move is mechanical.
- **Should understand:** A refusal writes nothing, and the ledger is byte-unchanged. An implicit `--run` that reaches a run another session owns is refused; an explicit `--run` is the caller taking responsibility. Never swap a refused status or Resolution for a different one the verb happens to accept.
- **Red flags:** Falling back to hand-editing the ledger after a refusal. Copying a foreign candidate run's `--run` line. Retrying a refusal more than once.

### 4. Two writers at once — concurrent appends take distinct numbers
- **URL:** the ledger file after two sessions or processes append together
- **Action:** Two `ledger-row` appends race on the same run's ledger.
- **Should feel:** Invisible. Both rows land, numbered `N` and `N+1`, and neither is lost.
- **Should understand:** Both appends run under the same `{run-dir}/.ledger.lock` that `stage-item.js --ledger`'s carry-forward uses. A writer that cannot get the lock refuses with `LOCK_TIMEOUT` rather than writing unlocked.
- **Red flags:** Two rows with the same number, or a row missing after a concurrent write.

## Origin
- Created during the build of #4439 (give the open-items ledger a sanctioned append/settle CLI), run `2026-11-03T204945-record-4439`.
- All four steps were built in this session: the `hooks.js ledger-row` verb, its locked library in `stage-item/ledger.js`, and the Writer section in `_shared/ledger-format.md` that the ten build/review/wrap-up writing sites cite.
- Related: `docs/journeys/approve-a-ledger-row-that-quotes-a-pipe-3512.md` (the pipe rule the verb applies), `docs/journeys/settle-a-refused-staged-proposal-in-the-ledger-4772.md` (the reopen the verb now performs), and `docs/journeys/find-this-runs-ledger-outside-wrap-up-3687.md` (the ledger resolution the verb uses).
