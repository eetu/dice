import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The reporting path has to be unbreakable: it runs precisely when the app is
// already failing, so it must never throw, and must never turn one broken device
// into a flood (a reload loop would otherwise report on every cycle).

type Beacon = { url: string; body: string };

async function freshReport() {
  vi.resetModules();
  return import("../report");
}

let sent: Beacon[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal("navigator", {
    userAgent: "test-agent",
    sendBeacon: (url: string, body: Blob) => {
      // Node's Blob is async-only; the tests just need the shape, and the
      // production payload is built with JSON.stringify before this call.
      sent.push({
        url,
        body: String((body as unknown as { __text: string }).__text),
      });
      return true;
    },
  });
  vi.stubGlobal("location", { href: "https://dice.test/g/ABCDE" });
  // Capture the serialized body without needing Blob.text().
  vi.stubGlobal(
    "Blob",
    class {
      __text: string;
      constructor(parts: string[]) {
        this.__text = parts.join("");
      }
    },
  );
  vi.stubGlobal("__APP_VERSION__", "9.9.9");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("report", () => {
  it("posts the closed shape to the backend, not the collector", async () => {
    const { report } = await freshReport();
    report("render", "TypeError: nope");

    expect(sent).toHaveLength(1);
    // Through our own backend: the browser never holds an ingest credential, and
    // the backend sanitizes + rate limits before anything reaches telemetry.
    expect(sent[0].url).toBe("/api/client-error");
    expect(JSON.parse(sent[0].body)).toEqual({
      kind: "render",
      message: "TypeError: nope",
      url: "https://dice.test/g/ABCDE",
    });
  });

  it("sends one report per kind per page load", async () => {
    const { report } = await freshReport();
    report("ws", "first");
    report("ws", "second");
    report("join", "different kind");

    expect(sent.map((s) => JSON.parse(s.body).kind)).toEqual(["ws", "join"]);
  });

  it("truncates a long message", async () => {
    const { report } = await freshReport();
    report("runtime", "x".repeat(1000));

    expect(JSON.parse(sent[0].body).message).toHaveLength(300);
  });

  it("never throws, even with no sendBeacon and no fetch", async () => {
    vi.stubGlobal("navigator", { userAgent: "test-agent" });
    vi.stubGlobal("fetch", undefined);
    const { report } = await freshReport();

    expect(() => report("boot", "nothing available")).not.toThrow();
  });
});

describe("diagnostics", () => {
  it("carries build, browser and page — what a bug report needs", async () => {
    const { diagnostics } = await freshReport();

    expect(diagnostics("500 boom").split("\n")).toEqual([
      "500 boom",
      "build: 9.9.9",
      "browser: test-agent",
      "page: https://dice.test/g/ABCDE",
    ]);
  });
});

describe("describe", () => {
  it("summarizes whatever was thrown", async () => {
    const { describe: d } = await freshReport();

    expect(d(new TypeError("bad"))).toBe("TypeError: bad");
    expect(d("a string")).toBe("a string");
    expect(d({ weird: true })).toBe('{"weird":true}');
    expect(d(undefined)).toBe("unknown error");
  });
});
