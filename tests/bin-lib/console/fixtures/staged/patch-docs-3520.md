Target: docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md
Invariant: the journey's Success state names a strong near-duplicate in flight as a wait condition alongside a file-sharing neighbour, and its Step 4 report lists the combined files-plus-near-duplicate neighbour form that neighbour-in-flight-report.md renders.
Finding: low staleness — Success state still says only a direct file-sharing neighbour holds a record back, and Step 4 omits the combined `#{m} ({files}; near-duplicate: …)` form, both incomplete after #3520
Staged-at: 3fb1edb24

diff --git a/docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md b/docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md
index ad224c045..40d13ae73 100644
--- a/docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md
+++ b/docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md
@@ -17,7 +17,7 @@ files:
 **Persona:** a scheduled Routine firing bare `/claude-tweaks:dispatch --budget 3` unattended against a queue of about 60 `auto:build` records, where many pairs edit the same hot files (`hooks.js`, `code-mode-steps.md`). Also the maintainer who reads that firing's report the next morning.
 **Goal:** keep building records from a queue whose Key Files chain together, instead of finding that most of the queue has fused into one group too large to dispatch.
 **Entry point:** bare `/claude-tweaks:dispatch` (or a `--budget` drain), headless.
-**Success state:** every eligible record is its own group, apart from disjoint fast-lane bundles. The firing builds up to `{budget}` records. A record whose direct file-sharing neighbour is mid-build waits for a later firing and is named in the report. Nothing is starved by a chain of records it shares no file with.
+**Success state:** every eligible record is its own group, apart from disjoint fast-lane bundles. The firing builds up to `{budget}` records. A record whose direct file-sharing neighbour, or strong near-duplicate, is mid-build waits for a later firing and is named in the report. Nothing is starved by a chain of records it shares no file with.
 
 ## Steps
 
@@ -44,7 +44,7 @@ files:
 
 ### 4. Read the report
 - **URL:** `plugin/skills/dispatch/neighbour-in-flight-report.md`
-- **Action:** **The maintainer** reads the firing's report. Each waiting record has one line: `#{n} waits — direct neighbour(s) in flight: #{m} ({files}); bare drain skips it this firing`. A near-duplicate neighbour reads `#{m} (near-duplicate: {signals}; shared: {sharedAnchors})` in place of `#{m} ({files})`.
+- **Action:** **The maintainer** reads the firing's report. Each waiting record has one line: `#{n} waits — direct neighbour(s) in flight: #{m} ({files}); bare drain skips it this firing`. A near-duplicate neighbour reads `#{m} (near-duplicate: {signals}; shared: {sharedAnchors})` in place of `#{m} ({files})`, and one that also shares files reads `#{m} ({files}; near-duplicate: {signals}; shared: {sharedAnchors})`.
 - **Should feel:** Explained. Each idle record names exactly which build it is waiting on, and why.
 - **Should understand:** Nothing needs doing. The record is picked up automatically once the neighbour finishes. `/claude-tweaks:dispatch #n` builds it now regardless, if the maintainer accepts the merge-time conflict risk.
 - **Red flags:** A waiting record with no report line. A report line naming a neighbour that is not in flight.
