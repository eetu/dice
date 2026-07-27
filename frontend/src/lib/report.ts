// Client-side error reporting. Posts a tiny, closed-shape record to the backend,
// which counts it and forwards it to the OTel collector — so "it didn't work on
// my phone" becomes a searchable record with a real message and User-Agent
// instead of a shrug.
//
// The pre-boot cases (bundle won't parse, module-eval throws) can't reach this
// module at all — `app.html`'s inline watchdog has its own copy for those, and
// posts the same shape.

/** Closed set, mirrored by the backend (`CLIENT_ERROR_KINDS` in `routes.rs`),
 *  which rejects anything else. Low cardinality on purpose: it's a metric
 *  attribute. The distinction that matters most in the data is "never started"
 *  (boot/noEsm/chunk) vs "started, then broke" (runtime/render/route). */
export type ReportKind =
  | "boot" // never rendered
  | "noEsm" // browser can't run ES modules
  | "chunk" // a script/asset failed to load
  | "storage" // site data blocked
  | "runtime" // uncaught error / rejection after the app booted
  | "render" // threw while rendering or in an $effect (svelte:boundary)
  | "route" // a route load/navigation error (hooks.client.ts)
  | "ws" // couldn't establish the game socket
  | "join"; // couldn't create/join a game

const sent = new Set<ReportKind>();

/** Turn an error into the block we show the user and they paste back to us: what
 *  broke, which build, which browser, where. Kept next to `report` so the
 *  on-screen text and the telemetry record describe the same thing. */
export function diagnostics(what: string): string {
  return [
    what,
    `build: ${__APP_VERSION__}`,
    `browser: ${navigator.userAgent}`,
    `page: ${location.href}`,
  ].join("\n");
}

/** Best-effort one-line description of an unknown thrown value. */
export function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "unknown error";
  } catch {
    return "unknown error";
  }
}

/** Fire-and-forget; never throws, never awaited. One report per kind per page
 *  load, so a reconnect or reload loop can't turn into a flood. */
export function report(kind: ReportKind, message: string): void {
  if (sent.has(kind)) return;
  sent.add(kind);
  const body = JSON.stringify({
    kind,
    message: message.slice(0, 300),
    url: location.href,
  });
  try {
    // sendBeacon survives the page going away (a failed boot often does).
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/client-error",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* reporting a failure must never cause one */
    });
  } catch {
    /* reporting a failure must never cause one */
  }
}
