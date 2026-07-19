// WebSocket client (the `nib` pattern) with auto-reconnect. Connects to
// /ws/games/{code}?token=…, dispatches ServerMsgs into the game store, and
// exposes a reactive connection `status` + a typed `send`.

import { base } from "$app/paths";
import type { ClientMsg, ServerMsg } from "$lib/api";

import { game } from "./game.svelte";
import { liars } from "./liars.svelte";

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

  status = $state<"disconnected" | "connecting" | "connected">("disconnected");
  /** True once we conclude the room is gone (server restart / expired): the
   *  backend accepted the WS upgrade then closed it before sending a snapshot.
   *  The page surfaces this instead of reconnecting forever. */
  ended = $state(false);

  connect(code: string, token: string): void {
    this.disconnect();
    this.#closedByUs = false;
    this.ended = false;
    this.#code = code;
    this.#token = token;
    this.#open();
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
      this.status = "connected";
    });
    ws.addEventListener("message", (e) => {
      if (this.#ws === ws) {
        gotMessage = true;
        this.#retry = 0; // a real, working connection — reset backoff
      }
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(msg);
    });
    const drop = () => {
      if (this.#ws !== ws) return;
      this.status = "disconnected";
      this.#ws = null;
      if (this.#closedByUs) return;
      if (opened && !gotMessage) {
        // Accepted then closed before any snapshot → the room no longer exists.
        // Stop reconnecting; the page shows "game ended".
        this.ended = true;
        return;
      }
      this.#scheduleReconnect();
    };
    ws.addEventListener("close", drop);
    ws.addEventListener("error", drop);
  }

  #scheduleReconnect(): void {
    if (this.#retryTimer) return;
    const delay = Math.min(1000 * 2 ** this.#retry, 8000);
    this.#retry += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      if (!this.#closedByUs) this.#open();
    }, delay);
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
