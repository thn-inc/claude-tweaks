# Staged: Promote — #3686

**Finding:** `[parked]` #3686 "delete-ledger and finish-console: test the unattributable arms and report inherited-only ledgers distinctly". Its parked trigger has been met: commit `5914ef11b` (#3684, 2026-10-20) changed finish-console's error paths in `plugin/bin/wrap-up-engine.js` after the record was parked on 2026-10-20. That commit adds no `unattributable`-arm tests, so the described problem is still open (Shape 2: trigger met, not resolved).

**Proposed:** Promote #3686: remove parked, re-shape via /specify

**Commands:**
```
/claude-tweaks:specify #3686
```
