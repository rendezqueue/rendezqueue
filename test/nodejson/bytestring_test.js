"use strict";

const assert = require("assert").strict;

// Will javascript be cool if this string holds arbitrary bytes?
var expect = ""
for (let i = 0; i < 256; ++i) {
  expect += String.fromCharCode(i);
}
assert.equal(expect.length, 256);

var encoded = JSON.stringify(expect)
var result = JSON.parse(encoded)
assert.equal(result.length, 256);
assert.equal(result, expect);

console.log(encoded);
