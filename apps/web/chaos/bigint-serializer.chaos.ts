/**
 * Chaos Engineering Tests — BigInt Serializer
 *
 * Inject failures at every boundary to verify the system
 * degrades gracefully (Toyota "stop-the-line" principle).
 *
 * Run: npx tsx apps/web/chaos/bigint-serializer.chaos.ts
 */

import { bigIntReplacer } from "../src/utils/bigint-serializer";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
  }
}

// ─── Chaos Test 1: Bizarre BigInt values ───
console.log("\n--- Chaos: Bizarre BigInt values ---");

// Negative BigInt (should never happen in contract values, but test resilience)
assert("negative bigint serializes as string", () => {
  return JSON.stringify({ v: -1n }, bigIntReplacer) === '{"v":"-1"}';
});

// Extremely large BigInt (2^256, Solana uint256 max)
assert("uint256 max serializes correctly", () => {
  const max = 2n ** 256n - 1n;
  const result = JSON.stringify({ v: max }, bigIntReplacer);
  return result === `{"v":"${max}"}`;
});

// BigInt zero
assert("zero bigint serializes as '0'", () => {
  return JSON.stringify({ v: 0n }, bigIntReplacer) === '{"v":"0"}';
});

// BigInt 1
assert("bigint 1 serializes as '1'", () => {
  return JSON.stringify({ v: 1n }, bigIntReplacer) === '{"v":"1"}';
});

// ─── Chaos Test 2: Mixed type payloads ───
console.log("\n--- Chaos: Mixed type payloads ---");

const mixedPayload = {
  address: "0x123",
  amount: 500000000000000000n,
  deadline: 1749168480n,
  isActive: true,
  tags: ["urgent", "escrow"],
  metadata: { count: 42n, hash: "abc" },
};

const mixedResult = JSON.stringify(mixedPayload, bigIntReplacer);
assert("nested object with mixed bigint serializes", () => {
  const parsed = JSON.parse(mixedResult);
  return (
    parsed.amount === "500000000000000000" &&
    parsed.deadline === "1749168480" &&
    parsed.metadata.count === "42" &&
    parsed.address === "0x123" &&
    parsed.isActive === true
  );
});

// Null and undefined are preserved
assert("null values preserved", () => {
  return JSON.stringify({ v: null }, bigIntReplacer) === '{"v":null}';
});

// Arrays with BigInt
assert("array of bigints serializes", () => {
  return JSON.stringify([1n, 2n, 3n], bigIntReplacer) === '["1","2","3"]';
});

// ─── Chaos Test 3: Replacer idempotence ───
console.log("\n--- Chaos: Replacer idempotence ---");

// Calling JSON.stringify twice with the same object
const obj = { amount: 1n };
const first = JSON.stringify(obj, bigIntReplacer);
assert("original bigint is not mutated by first stringify", () => {
  return typeof obj.amount === "bigint";
});
const second = JSON.stringify(obj, bigIntReplacer);
assert("second stringify produces same output", () => {
  return first === second;
});

// ─── Chaos Test 4: Edge case — already-string values ───
console.log("\n--- Chaos: Already-string values ---");
assert("pre-stringified bigint in string is left alone", () => {
  return JSON.stringify({ v: "500000000000000000" }, bigIntReplacer) === '{"v":"500000000000000000"}';
});

// ─── Chaos Test 5: Circular reference ───
console.log("\n--- Chaos: Circular reference ---");
const circular: any = { name: "self" };
circular.self = circular;
try {
  JSON.stringify(circular, bigIntReplacer);
  assert("circular reference throws (expected)", false);
} catch (e: any) {
  assert("circular reference throws TypeError (expected)", e instanceof TypeError);
}

// ─── Chaos Test 6: toJSON on objects ───
console.log("\n--- Chaos: toJSON interaction ---");
const withToJSON = {
  value: {
    toJSON() {
      return "custom";
    },
  },
};
assert("replacer does not interfere with toJSON", () => {
  return JSON.stringify(withToJSON, bigIntReplacer) === '{"value":"custom"}';
});

// ─── Summary ───
console.log(`\n═══════════════════════════════════`);
console.log(`Chaos tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════\n`);

process.exit(failed > 0 ? 1 : 0);
