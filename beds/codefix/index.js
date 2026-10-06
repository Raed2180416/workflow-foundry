// Shim so that `node --test beds/codefix/` works: Node resolves a directory argument to its
// index.js, which loads the bed's test files. The bed interface itself is index.mjs.
import './codefix.test.mjs';
import './codefix.controls-d1.test.mjs';
import './codefix.controls-d2.test.mjs';
import './codefix.controls-d3.test.mjs';
import './codefix.controls-d4.test.mjs';
import './codefix.controls-d5.test.mjs';
