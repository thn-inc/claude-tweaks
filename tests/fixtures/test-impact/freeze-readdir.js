// A `--require` preload loaded before tools/test-impact/tracer.js by tests/test-impact-tracer.test.js's
// fail-closed run: it makes fs.readdirSync non-writable, so the tracer's patch of it fails (#4024).
'use strict';
Object.defineProperty(require('fs'), 'readdirSync', { writable: false, configurable: false });
