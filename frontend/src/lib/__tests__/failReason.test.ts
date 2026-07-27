import { afterEach, describe, expect, it } from "vitest";

import { ApiError, failReason } from "../api";

// Every one of these used to render as the same "Something went wrong reaching
// the server", which is how a full room and a dead server became the same bug
// report.

function setOnLine(value: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: value },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "navigator");
});

describe("failReason", () => {
  it("maps the statuses the backend actually returns", () => {
    expect(failReason(new ApiError(404, "x"))).toBe("notfound");
    expect(failReason(new ApiError(409, "x"))).toBe("full");
    expect(failReason(new ApiError(429, "x"))).toBe("throttled");
    expect(failReason(new ApiError(503, "x"))).toBe("busy");
  });

  it("treats an unmapped status as unknown", () => {
    expect(failReason(new ApiError(418, "x"))).toBe("unknown");
  });

  it("recognises the request timeout", () => {
    // AbortSignal.timeout rejects with this; a plain AbortController's AbortError
    // would be indistinguishable from a deliberate cancel.
    expect(failReason(new DOMException("timed out", "TimeoutError"))).toBe(
      "timeout",
    );
  });

  it("splits a transport TypeError by connectivity", () => {
    // fetch reports every network failure as an identical TypeError on purpose,
    // so `onLine` is the only signal available.
    setOnLine(false);
    expect(failReason(new TypeError("Failed to fetch"))).toBe("offline");
    setOnLine(true);
    expect(failReason(new TypeError("Failed to fetch"))).toBe("unreachable");
  });

  it("falls back to unknown for anything else", () => {
    expect(failReason(new Error("boom"))).toBe("unknown");
    expect(failReason("not an error")).toBe("unknown");
  });
});

describe("ApiError", () => {
  it("carries the backend's own explanation for display", () => {
    const e = new ApiError(409, "POST /api/games/X/join → 409", "game is full");
    expect(e.status).toBe(409);
    expect(e.detail).toBe("game is full");
  });
});
