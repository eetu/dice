// WebSocket client (the `nib` pattern) with auto-reconnect. Connects to
// /ws/games/{code}?token=…, dispatches ServerMsgs into the game store, and
// exposes a reactive connection `status` + a typed `send`.

import { base } from "$app/paths";
import {
  type ClientMsg,
  CLOSE_BAD_TOKEN,
  CLOSE_NO_ROOM,
  type ServerMsg,
} from "$lib/api";
import { report } from "$lib/report";

import { farkle } from "./farkle.svelte";
import { game } from "./game.svelte";
import { liars } from "./liars.svelte";
import { yatzy } from "./yatzy.svelte";

function wsUrl(code: string, token: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${base}/ws/games/${encodeURIComponent(
    code,
  )}?token=${encodeURIComponent(token)}`;
}

function dispatch(msg: ServerMsg): void {
  switch (msg.type) {
    case "sync":
      game.applySync(msg.state);
      break;
    case "rolled":
      game.applyRolled(msg.record, msg.turnIdx, msg.currentPlayerId);
      break;
    case "presence":
      game.applyPresence(msg.playerId, msg.connected);
      break;
    case "liars":
      liars.apply(msg.view);
      break;
    case "yatzy":
      yatzy.apply(msg.view);
      break;
    case "farkle":
      farkle.apply(msg.view);
      break;
    // "liarsChanged" is server-internal — clients only get the personalized
    // "liars" view above.
  }
}

class GameSocket {
  #ws: WebSocket | null = null;
  #code = "";
  #token = "";
  #closedByUs = false;
  #retry = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #failures = 0;
  #everOpened = false;

  status = $state<"disconnected" | "connecting" | "connected">("disconnected");
  /** True once we conclude the room is gone (server restart / expired): the
   *  backend accepted the WS upgrade then closed it before sending a snapshot.
   *  The page surfaces this instead of reconnecting forever. */
  ended = $state(false);
  /** We stopped trying. The browser tells us NOTHING about a rejected handshake
   *  (a pre-upgrade 429 from the socket caps looks like any other failure), so
   *  after giving up we probe `/status`: it answers ⇒ the server is up and
   *  refusing sockets (`refused`); it doesn't ⇒ `unreachable`. Either way the
   *  page shows a real message with a retry instead of a forever-spinner. */
  refused = $state(false);
  unreachable = $state(false);
  /** The room exists but our stored token isn't a member of it — rejoin fresh
   *  rather than showing the (untrue) "this game expired" dead end. */
  staleSeat = $state(false);

  connect(code: string, token: string): void {
    this.disconnect();
    this.#closedByUs = false;
    this.ended = false;
    this.#resetFailures();
    this.#code = code;
    this.#token = token;
    this.#open();
  }

  /** Retry after giving up (the page's Retry button). */
  retry(): void {
    if (!this.#code) return;
    this.#closedByUs = false;
    this.ended = false;
    this.#resetFailures();
    this.#open();
  }

  #resetFailures(): void {
    this.refused = false;
    this.unreachable = false;
    this.staleSeat = false;
    this.#failures = 0;
    this.#everOpened = false;
    this.#retry = 0;
  }

  #open(): void {
    this.status = "connecting";
    const ws = new WebSocket(wsUrl(this.#code, this.#token));
    this.#ws = ws;
    // Per-attempt: did the socket open, and did we get any snapshot? A valid
    // connection always receives a `sync` immediately; the backend closes
    // pre-sync only for an unknown room / bad token (both terminal).
    let opened = false;
    let gotMessage = false;

    ws.addEventListener("open", () => {
      if (this.#ws !== ws) return;
      opened = true;
      this.#everOpened = true;
      this.status = "connected";
    });
    ws.addEventListener("message", (e) => {
      if (this.#ws === ws) {
        gotMessage = true;
        // A real, working connection — reset the backoff and the give-up count.
        this.#retry = 0;
        this.#failures = 0;
      }
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(msg);
    });
    // The close CODE is the only thing distinguishing the terminal cases, and an
    // `error` event carries none — hence the explicit argument.
    const drop = (code: number) => {
      if (this.#ws !== ws) return;
      this.status = "disconnected";
      this.#ws = null;
      if (this.#closedByUs) return;
      if (code === CLOSE_BAD_TOKEN) {
        // The game is alive, our saved seat just isn't in it (a code recycled
        // after the old room was freed). The page drops the creds and rejoins.
        this.staleSeat = true;
        return;
      }
      if (code === CLOSE_NO_ROOM || (opened && !gotMessage)) {
        // Gone. The heuristic stays as a fallback for an older backend, or a
        // proxy that swallows the close frame.
        this.ended = true;
        return;
      }
      this.#scheduleReconnect();
    };
    ws.addEventListener("close", (e) => drop(e.code));
    ws.addEventListener("error", () => drop(0));
  }

  #scheduleReconnect(): void {
    if (this.#retryTimer) return;
    this.#failures += 1;
    // A handshake that never opened fails instantly, so a handful of those means
    // "being refused", not "flaky wifi". A socket that worked once gets more
    // patience — a phone changing networks should reconnect, not give up.
    if ((!this.#everOpened && this.#failures >= 4) || this.#failures >= 10) {
      void this.#giveUp();
      return;
    }
    const delay = Math.min(1000 * 2 ** this.#retry, 8000);
    this.#retry += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      if (!this.#closedByUs) this.#open();
    }, delay);
  }

  /** Stop retrying and work out WHICH failure this is. A refused WS handshake is
   *  invisible to the browser (the backend rejects pre-upgrade with a 429 when
   *  the socket caps trip — deliberately, so a flood never allocates a socket
   *  task), so ask plain HTTP whether the server is even there. */
  async #giveUp(): Promise<void> {
    try {
      const res = await fetch(`${base}/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) this.refused = true;
      else this.unreachable = true;
    } catch {
      this.unreachable = true;
    }
    report(
      "ws",
      this.refused ? "socket refused by server" : "server unreachable",
    );
  }

  send(msg: ClientMsg): void {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.#closedByUs = true;
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#ws?.close();
    this.#ws = null;
    this.status = "disconnected";
  }
}

export const socket = new GameSocket();
