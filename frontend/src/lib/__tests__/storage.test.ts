import { afterEach, describe, expect, it, vi } from "vitest";

// The regression these cover: `typeof localStorage` looks like a guard but
// evaluates a getter that THROWS when a browser blocks site data, and every
// store reads its initial value at module-eval time in the root layout's import
// graph — so one throw used to render an empty <body>. Nothing here may throw.
//
// `storage` memoizes its probe, so each case needs a fresh module instance.
async function freshStorage() {
  vi.resetModules();
  return (await import("../storage")).storage;
}

function defineLocalStorage(value: PropertyDescriptor) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    ...value,
  });
}

function workingStore(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("storage", () => {
  it("round-trips through a working store and is not 'blocked'", async () => {
    defineLocalStorage({ value: workingStore() });
    const storage = await freshStorage();

    expect(storage.blocked).toBe(false);
    storage.set("dice:name", "Ada");
    expect(storage.get("dice:name")).toBe("Ada");
    storage.remove("dice:name");
    expect(storage.get("dice:name")).toBeNull();
  });

  it("survives a getter that throws (site data blocked) and keeps values in memory", async () => {
    // Chrome for Android "block all cookies", Samsung Internet, most in-app
    // WebViews: reading `window.localStorage` at all raises SecurityError.
    defineLocalStorage({
      get() {
        throw new Error("SecurityError: Access is denied for this document");
      },
    });
    const storage = await freshStorage();

    expect(storage.blocked).toBe(true);
    expect(() => storage.set("dice:name", "Ada")).not.toThrow();
    expect(storage.get("dice:name")).toBe("Ada"); // in-memory, for this tab
    storage.remove("dice:name");
    expect(storage.get("dice:name")).toBeNull();
  });

  it("falls back to memory when the store is readable but setItem throws", async () => {
    // Safari private mode / any zero-quota config: readable, unwritable. This is
    // why the probe does a real write instead of just touching the getter.
    const store = workingStore();
    defineLocalStorage({
      value: {
        ...store,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    const storage = await freshStorage();

    expect(storage.blocked).toBe(true);
    storage.set("dice:theme", "dark");
    expect(storage.get("dice:theme")).toBe("dark");
  });

  it("does not throw when there is no localStorage at all", async () => {
    const storage = await freshStorage();

    expect(storage.blocked).toBe(true);
    expect(() => storage.set("dice:lang", "fi")).not.toThrow();
    expect(storage.get("dice:lang")).toBe("fi");
  });
});
