import { bigIntReplacer } from "./bigint-serializer";

describe("bigIntReplacer", () => {
  it("converts bigint to string", () => {
    expect(JSON.stringify({ amount: 1000000000000000000n }, bigIntReplacer))
      .toBe('{"amount":"1000000000000000000"}');
  });

  it("leaves non-bigint values untouched", () => {
    expect(JSON.stringify({ a: "hello", b: 42, c: true }, bigIntReplacer))
      .toBe('{"a":"hello","b":42,"c":true}');
  });

  it("handles nested bigint fields", () => {
    const payload = { amount: 500000000000000000n, deadline: 1749168480n };
    const result = JSON.parse(JSON.stringify(payload, bigIntReplacer));
    expect(result.amount).toBe("500000000000000000");
    expect(result.deadline).toBe("1749168480");
  });

  it("handles zero bigint", () => {
    expect(JSON.stringify({ v: 0n }, bigIntReplacer)).toBe('{"v":"0"}');
  });

  it("does not mutate the original object", () => {
    const obj = { amount: 1n };
    JSON.stringify(obj, bigIntReplacer);
    expect(typeof obj.amount).toBe("bigint");
  });
});
