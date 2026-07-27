// Local identity. There's no auth: a player is a name + a per-game secret token
// handed out by the backend on create/join. We persist the display name globally
// and the credentials per game code, so a refresh or revisit re-attaches as the
// same player instead of spawning a duplicate.

import { storage } from "$lib/storage";

const NAME_KEY = "dice:name";
const credKey = (code: string) => `dice:game:${code.toUpperCase()}`;

export type Creds = { playerId: string; token: string };

function loadName(): string {
  return storage.get(NAME_KEY) ?? "";
}

class Session {
  name = $state(loadName());

  setName(n: string): void {
    this.name = n;
    storage.set(NAME_KEY, n);
  }

  credsFor(code: string): Creds | null {
    const raw = storage.get(credKey(code));
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      if (typeof v?.playerId === "string" && typeof v?.token === "string") {
        return { playerId: v.playerId, token: v.token };
      }
    } catch {
      return null;
    }
    return null;
  }

  saveCreds(code: string, creds: Creds): void {
    storage.set(credKey(code), JSON.stringify(creds));
  }

  clearCreds(code: string): void {
    storage.remove(credKey(code));
  }
}

export const session = new Session();
