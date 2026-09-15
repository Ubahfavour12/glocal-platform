import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistedStore } from "./persisted";

/** A localStorage that can be told to misbehave, which is the interesting case. */
function fakeStorage() {
  let data: Record<string, string> = {};
  let broken = false;
  return {
    break: () => (broken = true),
    getItem: (k: string) => {
      if (broken) throw new Error("access denied");
      return k in data ? data[k] : null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("access denied");
      data[k] = v;
    },
    reset: () => (data = {}),
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { addEventListener: () => {} });
});

afterEach(() => vi.unstubAllGlobals());

const asText = (raw: string | null) => raw ?? "default";

describe("reading", () => {
  it("returns the stored value", () => {
    storage.setItem("k", "stored");
    expect(createPersistedStore("k", asText, "default").getSnapshot()).toBe("stored");
  });

  it("returns the fallback when nothing is stored", () => {
    expect(createPersistedStore("k", asText, "default").getSnapshot()).toBe("default");
  });

  it("returns the fallback rather than throwing when storage is blocked", () => {
    // Private mode, or an embedded browser. A settings toggle must never be
    // the reason a page fails to render.
    storage.break();
    expect(createPersistedStore("k", asText, "default").getSnapshot()).toBe("default");
  });

  it("gives the server the fallback, so hydration agrees by construction", () => {
    storage.setItem("k", "stored");
    expect(createPersistedStore("k", asText, "default").getServerSnapshot()).toBe("default");
  });
});

describe("snapshot stability — the one that causes infinite loops", () => {
  it("returns the SAME reference while the raw value is unchanged", () => {
    // useSyncExternalStore compares snapshots by identity. A parse that builds
    // a fresh object each call reads as a perpetual change and React re-renders
    // forever. This is the test that catches that.
    storage.setItem("k", '{"a":1}');
    const store = createPersistedStore("k", (raw) => JSON.parse(raw ?? "{}"), {});
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("returns a new value once the stored raw value changes", () => {
    const store = createPersistedStore("k", asText, "default");
    expect(store.getSnapshot()).toBe("default");
    store.set("changed");
    expect(store.getSnapshot()).toBe("changed");
  });
});

describe("writing and notifying", () => {
  it("writes and tells subscribers", () => {
    const store = createPersistedStore("k", asText, "default");
    const seen = vi.fn();
    store.subscribe(seen);
    store.set("next");
    expect(seen).toHaveBeenCalled();
    expect(storage.getItem("k")).toBe("next");
  });

  it("still notifies when the write fails, so the UI is not stuck", () => {
    // In private mode the choice cannot persist, but it should still apply for
    // this page's lifetime rather than appearing to do nothing.
    const store = createPersistedStore("k", asText, "default");
    const seen = vi.fn();
    store.subscribe(seen);
    storage.break();
    expect(() => store.set("next")).not.toThrow();
    expect(seen).toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const store = createPersistedStore("k", asText, "default");
    const seen = vi.fn();
    store.subscribe(seen)();
    store.set("next");
    expect(seen).not.toHaveBeenCalled();
  });
});
