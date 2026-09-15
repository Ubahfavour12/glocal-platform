/**
 * A localStorage value, read the way React wants external state read.
 *
 * WHY NOT useState + useEffect. The obvious shape is `useState(default)` plus an
 * effect that reads localStorage and calls setState. It works, and the React
 * compiler rejects it, correctly: the component renders once with the default,
 * the effect fires, and a second render is triggered from inside an effect.
 * That is a cascading render, and with a theme or a collapsed sidebar it is
 * visible — the wrong state paints for a frame before snapping.
 *
 * useSyncExternalStore is built for exactly this. It has a separate server
 * snapshot, so server rendering and hydration agree by construction, and the
 * subscription means a change made in one component reaches every other one
 * reading the same key — including in another tab, via the `storage` event.
 *
 * Every access is wrapped: localStorage throws in private mode and in some
 * embedded browsers, and a settings toggle is never worth a blank page.
 */

type Parse<T> = (raw: string | null) => T;

export type PersistedStore<T> = {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  set: (value: T, serialise?: (v: T) => string) => void;
};

/**
 * `fallback` is returned both on the server and whenever storage is
 * unreadable, so it has to be the honest default rather than a placeholder —
 * it is what a first-time visitor genuinely sees.
 */
export function createPersistedStore<T>(
  key: string,
  parse: Parse<T>,
  fallback: T,
): PersistedStore<T> {
  const listeners = new Set<() => void>();
  // Cached because getSnapshot must return a STABLE reference for an unchanged
  // value. Reading and parsing on every call can hand React a fresh object each
  // time, which it reads as a perpetual change and loops on.
  let cached: T | null = null;
  let cachedRaw: string | null = null;
  let primed = false;

  function notify() {
    primed = false;
    listeners.forEach((fn) => fn());
  }

  if (typeof window !== "undefined") {
    // Another tab changing the same key. Cheap to support and surprising to
    // omit: two open tabs disagreeing about the theme looks like a bug.
    window.addEventListener("storage", (e) => {
      if (e.key === key) notify();
    });
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    getSnapshot() {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        return fallback;
      }
      if (primed && raw === cachedRaw) return cached as T;
      cachedRaw = raw;
      cached = parse(raw);
      primed = true;
      return cached;
    },

    getServerSnapshot() {
      return fallback;
    },

    set(value, serialise = String) {
      try {
        localStorage.setItem(key, serialise(value));
      } catch {
        /* private mode: the choice applies for this page's lifetime only */
      }
      notify();
    },
  };
}
