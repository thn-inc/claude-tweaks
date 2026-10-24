// Reads the fixture file named by argv[2] (repo-relative) — run as a child by b.fixture.js, so the
// read is only visible if the tracer reached this process through its env injection (#4024).
'use strict';
const fs = require('fs');
const path = require('path');

fs.readFileSync(path.join(__dirname, '..', process.argv[2]));
