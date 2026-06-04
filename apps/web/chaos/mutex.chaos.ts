/**
 * Chaos Engineering Tests — Submission Mutex
 *
 * Verifies the mutex guard using TPS one-piece-flow principle:
 * exactly one submission at a time, no queue buildup.
 *
 * Run: npx tsx apps/web/src/__tests__/mutex.chaos.ts
 */

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

// ─── Simulate the mutex pattern from page.tsx ───
function createMutex() {
  let isSubmitting = false;
  let submittingRef = false;
  let callCount = 0;

  return {
    handleSubmit: () => {
      if (submittingRef) return false;
      submittingRef = true;
      isSubmitting = true;
      callCount++;
      return true;
    },
    reset: () => {
      submittingRef = false;
      isSubmitting = false;
    },
    getCallCount: () => callCount,
    getIsSubmitting: () => isSubmitting,
  };
}

// ─── Chaos Test 1: 100 rapid-fire submissions ───
console.log("\n--- Chaos: 100 rapid-fire submissions ---");
const mutex1 = createMutex();
let accepted = 0;
for (let i = 0; i < 100; i++) {
  if (mutex1.handleSubmit()) accepted++;
}
assert("exactly 1 of 100 submissions accepted", accepted === 1);

// ─── Chaos Test 2: Reset then re-submit ───
console.log("\n--- Chaos: Reset and re-submit ---");
const mutex2 = createMutex();
mutex2.handleSubmit();
mutex2.reset();
const secondAccepted = mutex2.handleSubmit();
assert("second submission accepted after reset", secondAccepted === true);
assert("exactly 2 total calls", mutex2.getCallCount() === 2);

// ─── Chaos Test 3: Interleaved reset race ───
console.log("\n--- Chaos: Interleaved reset race ---");
const mutex3 = createMutex();
mutex3.handleSubmit();
// Simulate rapid success/failure cycle
mutex3.reset();
mutex3.handleSubmit();
mutex3.reset();
mutex3.handleSubmit();
assert("3 total calls across race cycle", mutex3.getCallCount() === 3);

// ─── Chaos Test 4: Double reset is safe ───
console.log("\n--- Chaos: Double reset ---");
const mutex4 = createMutex();
mutex4.handleSubmit();
mutex4.reset();
mutex4.reset(); // second reset should be no-op
const afterDoubleReset = mutex4.handleSubmit();
assert("submission works after double reset", afterDoubleReset === true);

// ─── Chaos Test 5: Stress test — rapid-fire with async completion simulation ───
console.log("\n--- Chaos: Stress with async completion ---");
function stressTest(concurrent: number): number {
  const m = createMutex();
  let submissions = 0;
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < concurrent; i++) {
      if (m.handleSubmit()) submissions++;
    }
    // Simulate transaction completing (success or error)
    m.reset();
  }
  return submissions;
}
const stressResult = stressTest(5);
assert(`1000 rounds of 5 concurrent: exactly ${stressResult} submissions`, stressResult === 1000);

// ─── Summary ───
console.log(`\n═══════════════════════════════════`);
console.log(`Chaos tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════\n`);

process.exit(failed > 0 ? 1 : 0);
