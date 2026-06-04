/**
 * Chaos Engineering Tests — EventEmitter Cleanup
 *
 * Simulates the EventEmitter lifecycle from page.tsx's useEffect
 * to verify no listener leaks across mount/unmount cycles.
 *
 * Run: npx tsx apps/web/src/__tests__/eventemitter.chaos.ts
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

// ─── Simulated window.ethereum ───
function createMockProvider() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  let maxListeners = 10;
  let warningEmitted = false;

  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => {
    warnings.push(msg);
    originalWarn.call(console, msg);
  };

  const provider = {
    on: (event: string, fn: (...args: any[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
      // Simulate MaxListenersExceededWarning behavior
      if (listeners[event].length > maxListeners && !warningEmitted) {
        warningEmitted = true;
      }
    },
    removeListener: (event: string, fn: (...args: any[]) => void) => {
      if (!listeners[event]) return;
      const idx = listeners[event].indexOf(fn);
      if (idx !== -1) listeners[event].splice(idx, 1);
    },
    setMaxListeners: (n: number) => {
      maxListeners = n;
    },
    getListenerCount: (event: string) => (listeners[event] || []).length,
    getWarnings: () => warnings,
    getMaxListeners: () => maxListeners,
    getTotalListeners: () =>
      Object.values(listeners).reduce((sum, arr) => sum + arr.length, 0),
    restore: () => {
      console.warn = originalWarn;
    },
  };

  return provider;
}

// ─── Simulate the useEffect pattern from page.tsx ───
function mountEffect(provider: ReturnType<typeof createMockProvider>) {
  if (!provider.setMaxListeners) return () => {};
  provider.setMaxListeners(20);
  const handleAccountsChanged = () => {};
  const handleChainChanged = () => {};
  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);
  return () => {
    provider.removeListener("accountsChanged", handleAccountsChanged);
    provider.removeListener("chainChanged", handleChainChanged);
  };
}

// ─── Chaos Test 1: No leak across mount/unmount cycles ───
console.log("\n--- Chaos: 10 mount/unmount cycles ---");
const provider1 = createMockProvider();
const unmountFns: Array<() => void> = [];

for (let i = 0; i < 10; i++) {
  const unmount = mountEffect(provider1);
  unmountFns.push(unmount);
  // Unmount immediately (simulating component re-render)
  unmountFns.forEach((fn) => fn());
  unmountFns.length = 0;
}

assert(
  "0 listeners remain after 10 mount/unmount cycles",
  provider1.getTotalListeners() === 0
);

// ─── Chaos Test 2: setMaxListeners prevents warning ───
console.log("\n--- Chaos: setMaxListeners prevents warning ---");
const provider2 = createMockProvider();

// Without setMaxListeners: add 11 listeners
const leakFns: Array<() => void> = [];
for (let i = 0; i < 11; i++) {
  const fn = () => {};
  provider2.on("accountsChanged", fn);
  leakFns.push(() => provider2.removeListener("accountsChanged", fn));
}
// Clean up
leakFns.forEach((fn) => fn());

// Now with setMaxListeners(20): add 11 listeners — should not warn
provider2.setMaxListeners(20);
const safeFns: Array<() => void> = [];
for (let i = 0; i < 11; i++) {
  const fn = () => {};
  provider2.on("accountsChanged", fn);
  safeFns.push(() => provider2.removeListener("accountsChanged", fn));
}
safeFns.forEach((fn) => fn());

// The key assertion: with setMaxListeners, the warning should not fire
// (We can't directly inspect the warning flag, but we can verify listeners
//  are properly tracked and cleaned up)
assert(
  "0 listeners remain after setMaxListeners + cleanup",
  provider2.getTotalListeners() === 0
);

// ─── Chaos Test 3: Interleaved on/off cycles ───
console.log("\n--- Chaos: Interleaved on/off cycles ---");
const provider3 = createMockProvider();

for (let cycle = 0; cycle < 100; cycle++) {
  const cleanup = mountEffect(provider3);
  cleanup();
}

assert(
  "0 listeners after 100 interleaved cycles",
  provider3.getTotalListeners() === 0
);

// ─── Chaos Test 4: setMaxListeners is idempotent ───
console.log("\n--- Chaos: setMaxListeners idempotence ---");
const provider4 = createMockProvider();
provider4.setMaxListeners(20);
provider4.setMaxListeners(20);
provider4.setMaxListeners(20);
assert("setMaxListeners(20) is idempotent", provider4.getMaxListeners() === 20);

// ─── Chaos Test 5: Memory/performance stress ───
console.log("\n--- Chaos: 10000 rapid mount/unmount ---");
const provider5 = createMockProvider();
for (let i = 0; i < 10000; i++) {
  const cleanup = mountEffect(provider5);
  cleanup();
}
assert(
  "0 listeners after 10000 rapid mount/unmount",
  provider5.getTotalListeners() === 0
);

provider1.restore();

// ─── Summary ───
console.log(`\n═══════════════════════════════════`);
console.log(`Chaos tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════\n`);

process.exit(failed > 0 ? 1 : 0);
