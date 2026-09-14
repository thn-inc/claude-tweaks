'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const createAndUpdate = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'routine', 'create-and-update.md'),
  'utf8'
);

test('create-and-update.md #68: Step 6 body template sets notifications unconditionally', () => {
  // Sibling of cron_expression, top-level, not nested under job_config.
  assert.ok(
    /"cron_expression":[^\n]*\n\s*"notifications":\s*\{"channel":\s*\{"email":\s*true,\s*"push":\s*false,\s*"slack":\s*false\}\}/.test(
      createAndUpdate
    ),
    'notifications field must sit directly below cron_expression, before job_config'
  );
});

test('create-and-update.md #68: at least two references to notifications (AC5)', () => {
  const matches = createAndUpdate.match(/notifications/g) || [];
  assert.ok(matches.length >= 2, `expected >= 2 matches, got ${matches.length}`);
});

test('create-and-update.md #68: doc sentence next to Step 6 body explains the field', () => {
  assert.ok(
    /`notifications` is set unconditionally on every routine this skill creates/.test(createAndUpdate)
  );
});

test('create-and-update.md #68: Step 7 preview states an email fires on every firing', () => {
  assert.ok(
    /Render one further line stating the routine will send an email notification on every firing/.test(
      createAndUpdate
    )
  );
});

test('create-and-update.md #1301: Step 8 no longer issues the non-functional follow-up RemoteTrigger update for notifications', () => {
  // Live probe (record #1301) confirmed update has no notifications parameter and
  // silently drops an unsupported notifications value rather than applying or rejecting it —
  // the follow-up call this test used to require would appear to succeed while doing nothing.
  assert.ok(
    !createAndUpdate.includes(
      'RemoteTrigger {action: "update", trigger_id, body: {"notifications": {"channel": {"email": true, "push": false, "slack": false}}}}'
    ),
    'Step 8 must not issue the confirmed-non-functional follow-up update call'
  );
});

test('create-and-update.md #1301: Step 8 documents the live-confirmed limitation and the manual fallback', () => {
  assert.ok(
    /Confirmed live \(#1301\)/.test(createAndUpdate),
    'Step 8 must cite the live probe that found update cannot set notifications'
  );
  assert.ok(
    /must turn it on manually at the routine's console URL/.test(createAndUpdate),
    'Step 8 must direct the user to the manual fallback'
  );
});
