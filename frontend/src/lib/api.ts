// Thin fetch layer + the wire types. Hand-mirrored from the Rust structs in
// backend/src/room.rs and backend/src/routes.rs (no codegen). Keep in sync.

/** A participant. Mirrors `room::Player` (token is never sent). */
export type Player = {
  id: string;
  name: string;
  connected: boolean;
};

/** One completed roll. Mirrors `room::RollRecord`. */
export type RollRecord = {
  id: number;
  playerId: string;
  playerName: string;
  dice: number[];
  total: number;
  ts: number;
};

/** Full room state. Mirrors `room::Snapshot`. */
export type Snapshot = {
  code: string;
  players: Player[];
  turnIdx: number;
  currentPlayerId: string | null;
  diceCount: number;
  diceTheme: string;
  deck: string;
  history: RollRecord[];
};

/** Server → client WS messages. Mirrors `room::ServerMsg`. */
export type ServerMsg =
  | { type: "sync"; state: Snapshot }
  | {
      type: "rolled";
      record: RollRecord;
      turnIdx: number;
      currentPlayerId: string | null;
    }
  | { type: "presence"; playerId: string; connected: boolean };

/** Client → server WS messages. Mirrors `room::ClientMsg`. */
export type ClientMsg =
  | { type: "roll" }
  | { type: "reorder"; order: string[] }
  | { type: "setDiceCount"; count: number }
  | { type: "setName"; name: string }
  | { type: "setDiceTheme"; theme: string }
  | { type: "setDeck"; deck: string }
  | { type: "skipTurn" }
  | { type: "leave" };

/** Response from create / join. */
export type Credentials = {
  code: string;
  playerId: string;
  token: string;
};

export type StatusResponse = {
  service: string;
  version: string;
  rooms: number;
};

/** Thrown for any non-2xx response; carries the HTTP status (404 = dead code). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    ...init,
  });
  if (!res.ok) {
    throw new ApiError(
      res.status,
      `${init?.method ?? "GET"} ${path} → ${res.status}`,
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => request<StatusResponse>("/status"),
  createGame: (name: string) =>
    request<Credentials>("/api/games", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  joinGame: (code: string, name: string) =>
    request<Credentials>(`/api/games/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getGame: (code: string) =>
    request<Snapshot>(`/api/games/${encodeURIComponent(code)}`),
};
