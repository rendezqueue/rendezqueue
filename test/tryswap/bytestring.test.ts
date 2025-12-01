
import assert from "assert";
import { test } from "vitest";

test("bytestring basic test", () => {
  // Will javascript be cool if this string holds arbitrary bytes?
  let expect = "";
  for (let i = 0; i < 256; ++i) {
    expect += String.fromCharCode(i);
  }
  assert.equal(expect.length, 256);

  const encoded = JSON.stringify(expect);
  const result = JSON.parse(encoded);
  assert.equal(result.length, 256);
  assert.equal(result, expect);

  console.log(encoded);
});
