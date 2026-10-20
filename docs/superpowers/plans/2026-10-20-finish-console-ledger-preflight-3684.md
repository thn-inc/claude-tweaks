# finish-console: decide whether a ledger row it cannot flip should stop it before steps 1-2 land (#3684) Implementation Plan

**Goal:** `finish-console --approve-all` validates ledger resolution, the ledger read and every row flip before it writes anything, so a ledger row it cannot flip refuses with nothing written instead of stopping at step 3 after steps 1-2 landed.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T185239-record-3684/work/3684-spec.md` (materialized from GitHub issue #3684)

---

### Task 1: Pre-flight the ledger flips before step 1 in finish-console

**Files:**
- Modify: `plugin/bin/wrap-up-engine.js`
- Modify: `plugin/skills/_shared/ledger-format.md`
- Modify: `docs/plugin-structure.md` (scope-creep, add-to-plan: its `finish-console` command-reference sentence says "a failure names which of the three steps failed and that every earlier step already landed" — reword so it says ledger resolution and row flips are validated before any write, and only a write failure leaves earlier steps landed)
- Test: `tests/bin-lib/wrap-up/finish-console-cli.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/wrap-up/finish-console-cli.test.js`, rewrite the case "finish-console with a ledger update but no ledger file anywhere exits 1 naming the failure, verify-expectations.json still written (step 1 already completed)" and the case "finish-console rejects an unknown ledger item number, nothing in the ledger file changes"; add a third case for a ledger row carrying an unescaped raw `|` inside a cell (so `flipLedgerRow` refuses it). Each of the three must snapshot `verify-expectations.json`, `decisions.md` and the ledger file (absent files recorded as absent) BEFORE the call, pass a payload that also carries a `memory` entry (so step 1/2 would have something to write), and assert after the call: exit 1; stderr names the failure (`ledger[0]` for the flip-refusal cases, the resolution reason for the no-ledger case) and says nothing was written; and all three artifacts are byte-identical to the snapshot (absent stays absent). Do not pre-escape `resolution` in payloads. Run `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js` — the three cases FAIL against the current code.
- [ ] **Step 2: Implement** — in `runFinishConsole`, after `validateFinishConsolePayload` (keep that branch first) and before step 1: when `ledgerUpdates.length > 0`, resolve the ledger path (`readRunState(args.runDir)?.worktree || process.cwd()` moves with the block, keep the #3017 comment), read it, and apply every `flipLedgerRow` in memory, keeping today's error branches and detail text but replacing "— steps 1-2 already completed" with "— nothing written" (and dropping the "N of M rows flipped so far … NONE have been written yet" clause, now moot); exit code 1 and return without writing anything. Hold `{ path, text }`; step 3 only calls `writeFileAtomic(path, text)` and keeps its "steps 1-2 already completed" message for a write failure. Rewrite the #2544 atomicity comment above `validateFinishConsolePayload`: payload, ledger resolution and every row flip are validated before any write; only a write failure (an I/O fault mid-call) can leave earlier steps landed; drop the claim that a re-run never duplicates `decisions.md` lines (step 2 is append-only, so a re-run after a step-2/3 write failure does append again). Update `plugin/skills/_shared/ledger-format.md` line 37's last sentence so it says `finish-console --approve-all` refuses before writing anything (names the row, writes none of its three artifacts). Update the `docs/plugin-structure.md` sentence above. No change to `plugin/bin/lib/wrap-up/ledger-write.js`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js` — PASS (every other case in the file passes unmodified). Then run the conformance tests that read `_shared/ledger-format.md` (`git grep -ln "ledger-format" -- tests`) — PASS.
- [ ] **Step 4: Commit** — one commit, message `Pre-flight finish-console ledger flips before any write — refs #3684`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (pre-flight before step 1, "nothing written", exit 1) → Step 2; Deliverable 2 (step 3 writes precomputed text, keeps "steps 1-2 already completed" on write failure) → Step 2; Deliverable 3 (#2544 comment rewrite) → Step 2; Deliverable 4 (ledger-format.md line 37) → Step 2; Deliverable 5 (two rewritten tests + unescaped-pipe case, byte-identical asserts, red without pre-flight) → Step 1. AC 1 (flipLedgerRow refusal → exit 1, names ledger[i], no artifact touched) → Step 1 unknown-item + raw-pipe cases; AC 2 (resolveLedgerPath ok:false) → Step 1 no-ledger case; AC 3 (no-ledger payload unchanged) and AC 4 (valid payload writes all three, byte-identical rows) → existing cases pass unmodified in Step 3; AC 5 (ledger-format.md wording) → Step 2; AC 6 (focused file + full `npm test`) → Step 3 here, full suite in /build Common Step 5.
- **Placeholders:** none.
