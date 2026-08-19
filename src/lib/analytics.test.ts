import { describe, expect, it } from "vitest";
import { ANALYTICS_OPT_OUT_KEY, isAnalyticsOptedOut, setAnalyticsOptOut } from "@/lib/analytics";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("analytics opt-out", () => {
  it("excludes the current browser until the preference is disabled", () => {
    const storage = memoryStorage();

    expect(isAnalyticsOptedOut(storage)).toBe(false);
    setAnalyticsOptOut(true, storage);
    expect(storage.getItem(ANALYTICS_OPT_OUT_KEY)).toBe("1");
    expect(isAnalyticsOptedOut(storage)).toBe(true);

    setAnalyticsOptOut(false, storage);
    expect(isAnalyticsOptedOut(storage)).toBe(false);
  });

  it("fails open when browser storage is unavailable", () => {
    const blockedStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(isAnalyticsOptedOut(blockedStorage)).toBe(false);
    expect(() => setAnalyticsOptOut(true, blockedStorage)).not.toThrow();
  });
});
