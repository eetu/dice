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

/** Which game the room is playing. Mirrors `room::Mode`. */
export type Mode = "free" | "liars" | "yatzy" | "farkle";

/** Full room state. Mirrors `room::Snapshot`. */
export type Snapshot = {
  code: string;
  players: Player[];
  mode: Mode;
  turnIdx: number;
  currentPlayerId: string | null;
  diceCount: number;
  diceTheme: string;
  deck: string;
  history: RollRecord[];
};

// ---- Liar's Dice (mirrors room.rs) ----

export type LiarsPhase = "bidding" | "reveal" | "over";

/** A bid: "at least `quantity` dice showing `face`" across all cups. */
export type Bid = {
  playerId: string;
  quantity: number;
  face: number;
};

/** One player's full hand — only present in a `reveal`. */
export type HandReveal = {
  playerId: string;
  dice: number[];
};

/** Outcome of a "liar" call: every cup revealed + who lost a die. */
export type Reveal = {
  hands: HandReveal[];
  bid: Bid;
  callerId: string;
  actual: number;
  loserId: string;
  bidWasTrue: boolean;
};

/** A player in a Liar's Dice view — only the public dice count, never values. */
export type LiarsPlayerView = {
  playerId: string;
  diceCount: number;
  out: boolean;
};

/** Per-viewer Liar's Dice state: your own hand in full, others by count only. */
export type LiarsView = {
  phase: LiarsPhase;
  currentPlayerId: string | null;
  bid: Bid | null;
  totalDice: number;
  players: LiarsPlayerView[];
  yourDice: number[];
  reveal: Reveal | null;
  winner: string | null;
  startDice: number;
};

// ---- Yatzy (Nordic; mirrors room.rs) ----

/** A Yatzy scorecard box id. Mirrors `room::YatzyCat`. */
export type YatzyCat =
  | "ones"
  | "twos"
  | "threes"
  | "fours"
  | "fives"
  | "sixes"
  | "onePair"
  | "twoPairs"
  | "threeKind"
  | "fourKind"
  | "smallStraight"
  | "largeStraight"
  | "fullHouse"
  | "chance"
  | "yatzy";

/** One scored (or previewed) box. */
export type YatzyCell = { category: YatzyCat; value: number };

/** A player's public scorecard. Mirrors `room::YatzyCard`. */
export type YatzyCard = {
  playerId: string;
  cells: YatzyCell[];
  upper: number;
  bonus: number;
  total: number;
};

/** Public Yatzy state — the same for every client. Mirrors `room::YatzyView`. */
export type YatzyView = {
  order: string[];
  currentPlayerId: string | null;
  dice: number[];
  held: boolean[];
  rollsLeft: number;
  rolled: boolean;
  cards: YatzyCard[];
  preview: YatzyCell[];
  winner: string | null;
  over: boolean;
};

// ---- Farkle (mirrors room.rs) ----

/** A player's banked Farkle total. */
export type FarkleScore = { playerId: string; score: number };

/** Public Farkle state — the same for every client. Mirrors `room::FarkleView`. */
export type FarkleView = {
  order: string[];
  currentPlayerId: string | null;
  scores: FarkleScore[];
  target: number;
  dice: number[];
  turnScore: number;
  remaining: number;
  mustPick: boolean;
  busted: boolean;
  winner: string | null;
  over: boolean;
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
  | { type: "presence"; playerId: string; connected: boolean }
  // `liarsChanged` is a server-internal rebuild signal; clients only receive the
  // personalized `liars` view below (kept in the union for completeness).
  | { type: "liarsChanged" }
  | { type: "liars"; view: LiarsView }
  | { type: "yatzy"; view: YatzyView }
  | { type: "farkle"; view: FarkleView };

/** Client → server WS messages. Mirrors `room::ClientMsg`. */
export type ClientMsg =
  | { type: "roll" }
  | { type: "reorder"; order: string[] }
  | { type: "setDiceCount"; count: number }
  | { type: "setName"; name: string }
  | { type: "setDiceTheme"; theme: string }
  | { type: "setDeck"; deck: string }
  | { type: "skipTurn" }
  | { type: "setMode"; mode: Mode }
  | { type: "bid"; quantity: number; face: number }
  | { type: "callLiar" }
  | { type: "nextRound" }
  | { type: "yatzyRoll" }
  | { type: "yatzyHold"; index: number }
  | { type: "yatzyScore"; category: YatzyCat }
  | { type: "farkleRoll" }
  | { type: "farkleSetAside"; keep: number[] }
  | { type: "farkleBank" }
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
  createGame: (name: string, mode: Mode = "free") =>
    request<Credentials>("/api/games", {
      method: "POST",
      body: JSON.stringify({ name, mode }),
    }),
  joinGame: (code: string, name: string) =>
    request<Credentials>(`/api/games/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getGame: (code: string) =>
    request<Snapshot>(`/api/games/${encodeURIComponent(code)}`),
};
