'use strict';
// learned-skills capture (#5290) fault matrix, joined target (captured once, then edited again) — no
// fault, singles, named chains and sampled higher orders (the pairs run from
// capture-matrix-joined-pairs-{1,2}.test.js). Machinery: tests/helpers/learned-skills-capture.js.
const { registerMatrix } = require('../../helpers/learned-skills-capture.js');

registerMatrix('joined', 'chains');
