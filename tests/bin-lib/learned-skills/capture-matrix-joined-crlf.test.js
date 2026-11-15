'use strict';
// learned-skills capture (#5290) fault matrix, joined target, on a core.autocrlf=true checkout: the
// tree holds CRLF, both edits are written with LF, and every git apply or checkout writes CRLF back.
// CI runs on ubuntu with autocrlf off, so this file is what keeps a Windows checkout under the matrix.
// Machinery: tests/helpers/learned-skills-capture.js.
const { registerMatrix } = require('../../helpers/learned-skills-capture.js');

registerMatrix('joined', 'chains', undefined, { autocrlf: 'true' });
