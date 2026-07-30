// English catalog — the source of truth for the message shape. Other locales are
// typed as `Catalog`, so a missing/renamed key fails the build. String values are
// plain; anything with interpolation or agreement is a function.

import type { FailReason } from "$lib/api";

export const en = {
  // Lobby
  tagline: "Roll dice together, in turns.",
  yourName: "Your name",
  namePlaceholder: "Anonymous",
  createGame: "Create a game",
  orJoin: "or join one",
  codePlaceholder: "CODE",
  join: "Join",
  scan: "Scan a QR code",
  scanTitle: "Scan QR code",
  scanHint: "Point at a game's QR code",
  scanInvalid: "That's not a dice game code",
  scanDenied: "Camera access denied — allow it in settings",
  scanNoCam: "No camera available",
  namePromptTitle: "Pick a name",
  namePromptBody: (assigned: string) =>
    `You're in the game as ${assigned}. Change it here, or keep it.`,
  saveName: "Save",
  // Everything else that can go wrong reaching the server lives in `joinFail`
  // below, keyed by the classified reason.
  errNoGame: (code: string) => `No game "${code}" — it may have expired.`,
  storageBlocked:
    "Your browser is blocking site data, so your name and seat won't be remembered after a reload. Games still work.",

  // Header + notices
  settings: "Settings",
  leave: "Leave",
  cancel: "Cancel",
  leaveTitle: "Leave the game?",
  leaveBody:
    "You'll leave this game. Others keep playing — rejoin any time with the code.",
  leaveTitleLast: "Leave and end the game?",
  leaveBodyLast:
    "You're the last player — leaving ends the game for good and frees the code.",
  connecting: "Connecting…",
  connected: "connected",
  disconnected: "disconnected",
  connectionLost: "Connection lost — reconnecting…",
  backToStart: "Back to start",
  retry: "Retry",
  notFoundTitle: "Game not found",
  notFoundBody: (code: string) =>
    `The code ${code} doesn't exist or has expired.`,
  endedTitle: "Game ended",
  endedBody: (code: string) =>
    `The game ${code} is no longer available — it expired or the server restarted (games aren't saved). Start a fresh one.`,
  // One entry per FailReason (api.ts). `satisfies` keeps the literal type — so
  // fi.ts is forced to mirror every key, and a new reason breaks the build here
  // instead of silently rendering the generic "something went wrong".
  joinFail: {
    notfound: {
      title: "Game not found",
      body: "That code doesn't exist or has expired.",
    },
    full: {
      title: "This game is full",
      body: "It already has the maximum number of players. Ask someone to leave, or start a new game.",
    },
    busy: {
      title: "The server is full",
      body: "It's at capacity right now. Try again in a minute.",
    },
    throttled: {
      title: "Too many attempts",
      body: "Too many tries in a row from your network. Wait a minute, then retry.",
    },
    offline: {
      title: "You're offline",
      body: "Your device has no network connection. Check it and retry.",
    },
    timeout: {
      title: "The server didn't answer",
      body: "It took too long to respond. It may be restarting.",
    },
    unreachable: {
      title: "Can't reach the server",
      body: "Your network is up, but the server isn't answering. It may be down or restarting.",
    },
    wsRefused: {
      title: "The server is busy",
      body: "It's up, but refusing new live connections right now. Try again shortly.",
    },
    unknown: {
      title: "Couldn't connect",
      body: "Something went wrong reaching the server.",
    },
  } satisfies Record<FailReason, { title: string; body: string }>,
  staleSeat: "Your old seat in this game is gone — rejoined as a new player.",
  crashTitle: "Something broke",
  crashBody:
    "The app hit an error it couldn't recover from. Trying again usually fixes it — if it doesn't, send the details below to whoever shared the link.",
  reload: "Reload",
  // A URL that matches no route — a mistyped or truncated invite link, usually.
  missingTitle: "Nothing here",
  missingBody:
    "That link doesn't lead anywhere. Head back to start a game, or join one with a code.",

  // Dice stage
  yourTurn: "Your turn",
  invite: "Invite",
  tapToRoll: "Tap to roll",
  tapOrShakeToRoll: "Tap or shake to roll",
  shaking: "Shaking… let go to roll",
  rolledResult: (name: string, total: number) => `${name} rolled ${total}`,
  diceFallback: "Dice",

  // Toolbar
  rolling: "Rolling…",
  roll: "Roll",
  waitingFor: (name: string) => `Waiting for ${name}…`,
  skip: "Skip",
  playersTurn: (name: string) => `${name}'s turn`,
  waiting: "Waiting…",

  // Settings
  game: "Game",
  freeDice: "Free dice",
  liarsDice: "Liar's Dice",
  yatzyDice: "Yatzy",
  farkleDice: "Farkle",
  dice: "Dice",
  roundedDice: "Rounded dice",
  dieMaterial: "Material",
  trayCount: (n: number, max: number) => `${n}/${max}`,
  addDie: (kind: string) => `Add ${kind}`,
  removeDie: (kind: string) => `Remove ${kind}`,
  tableSelectLabel: "Table",
  appearance: "Appearance",
  sound: "Sound",
  shakeSetting: "Shake to roll",
  language: "Language",

  // Theme + language
  light: "light",
  dark: "dark",
  auto: "auto",
  english: "English",
  finnish: "Suomi",

  // Players + history
  players: "Players",
  dragHint:
    "Drag a row — or focus the grip and press ↑/↓ — to set the turn order.",
  renameSelf: "Rename yourself",
  dragReorder: (name: string) => `Reorder ${name}`,
  movedTo: (name: string, pos: number, total: number) =>
    `${name} moved to ${pos} of ${total}`,
  turnBadge: "turn",
  online: "online",
  offline: "offline",
  history: "History",
  historyEmpty: "Rolls will appear here.",

  // Share + bots
  addBot: "Add a bot",
  botSkillEasy: "Easy",
  botSkillHard: "Hard",
  botSkillCheater: "Sneaky",
  botBadge: "Bot",
  removeBot: (name: string) => `Remove ${name}`,
  gameCode: "Game code",
  copyCode: "Copy code",
  copyInviteLink: "Copy invite link",
  linkCopied: "Link copied",
  codeCopied: "Code copied",
  shareHint: "Scan the QR or share the code / link to invite players.",
  qrAlt: "QR code to join this game",

  // Modal
  close: "Close",

  // Liar's Dice
  dealing: "Dealing…",
  liarsWin: (name: string, isYou: boolean) =>
    isYou ? "You win!" : `${name} wins!`,
  playAgain: "Play again",
  outShort: "out",
  toOpen: (name: string, isYou: boolean) =>
    isYou ? "You open" : `${name} to open`,
  diceInPlay: (n: number) => `${n} dice in play · 1s are wild`,
  bids: (name: string, isYou: boolean) => (isYou ? "You bid" : `${name} bids`),
  nextRound: "Next round",
  spectating: "You're out — spectating",
  liarsNeedsOpponent: "Waiting for another player — you can't bluff yourself",
  bidLabel: (q: number) => `Bid ${q} ×`,
  liar: "Liar!",
  you: "You",
  someone: "Someone",
  playerFallback: "Player",
  fewer: "Fewer",
  more: "More",
  faceAria: (f: number) => `Face ${f}`,
  liarsReveal: (
    caller: string,
    actual: number,
    bidTrue: boolean,
    loser: string,
    loserIsYou: boolean,
  ) =>
    `${caller} called liar — there ${actual === 1 ? "was" : "were"} ${actual}, so ${
      bidTrue ? "the bid held" : "the bid was a bluff"
    }. ${loser} lose${loserIsYou ? "" : "s"} a die.`,

  // Yatzy
  yatzyRoll: (n: number) => (n === 3 ? "Roll" : `Roll (${n} left)`),
  yatzyRollAll: "Roll all five",
  yatzyRollsLeft: (n: number) =>
    `${n} roll${n === 1 ? "" : "s"} left · tap dice to hold`,
  yatzyHoldHint: "Tap a die to hold it",
  yatzyPickBox: "Pick a box to score",
  yatzyTapToScore: "Tap a box to score it here",
  yatzyUpper: "Upper",
  yatzyBonus: "Bonus",
  yatzyBonusHint: "Upper bonus: +50 when ones–sixes total 63 or more",
  yatzyToGo: (n: number) => `${n} to go`,
  yatzyTotal: "Total",
  yatzySwipeHint: "Swipe or tap a name to switch player",
  yatzyWaitingRoll: (name: string) => `Waiting for ${name} to roll…`,
  yatzyYourTurn: "Your turn — roll",
  yatzyScratchHint: "No roll left — you must fill a box (0 is allowed)",
  yatzyWin: (name: string, isYou: boolean) =>
    isYou ? "You win!" : `${name} wins!`,
  // Category names, keyed by YatzyCat.
  yatzyCats: {
    ones: "Ones",
    twos: "Twos",
    threes: "Threes",
    fours: "Fours",
    fives: "Fives",
    sixes: "Sixes",
    onePair: "One pair",
    twoPairs: "Two pairs",
    threeKind: "Three of a kind",
    fourKind: "Four of a kind",
    smallStraight: "Small straight",
    largeStraight: "Large straight",
    fullHouse: "Full house",
    chance: "Chance",
    yatzy: "Yatzy",
  } as Record<string, string>,

  // Farkle
  farkleTarget: (n: number) => `First to ${n}`,
  farkleRoll: "Roll",
  farkleRollRemaining: (n: number) => `Roll ${n} ${n === 1 ? "die" : "dice"}`,
  farkleBank: (n: number) => `Bank ${n}`,
  farklePass: "Pass",
  farkleThisTurn: (n: number) => `This turn: ${n}`,
  farkleRemaining: (n: number) => `${n} ${n === 1 ? "die" : "dice"}`,
  // Rules panel (the ? flip on the board)
  farkleRules: "Rules",
  farkleRulesScoring: "Scoring",
  farkleRulesThreeKind: "Three of a kind",
  farkleRuleLadder: "×2 / ×4 / ×8 = that many times the three-of-a-kind score",
  farkleRuleName: {
    fourKind: "Four of a kind",
    fiveKind: "Five of a kind",
    sixKind: "Six of a kind",
    straight: "Run 1–6",
    threePairs: "Three pairs",
    twoTriplets: "Two triplets",
  },
  farklePick: "Tap scoring dice to set aside",
  farkleSetAside: (n: number) => `Set aside +${n}`,
  farkleHotDice: "Hot dice! Roll all six again",
  farkleBusted: "Farkle! No score — you lose this turn",
  farkleBustedOther: (name: string) => `Farkle! ${name} rolled no score`,
  farkleYourRoll: "Your turn — roll",
  farkleWaiting: (name: string) => `Waiting for ${name}…`,
  farkleKept: "Set aside",
  farkleWin: (name: string, isYou: boolean) =>
    isYou ? "You win!" : `${name} wins!`,
  farkleHint:
    "Set aside at least one scoring die each roll, then bank or push your luck. Roll no scoring dice and you lose the turn's points.",

  // Table (deck) names, keyed by deck id.
  decks: {
    "felt-green": "Green felt",
    "felt-red": "Red felt",
    "felt-blue": "Blue felt",
    oak: "Oak wood",
    walnut: "Walnut wood",
    concrete: "Concrete",
    steel: "Steel",
    water: "Water",
  } as Record<string, string>,

  // Dice theme names, keyed by theme id.
  themes: {
    ivory: "Ivory",
    obsidian: "Obsidian",
    ruby: "Ruby",
    emerald: "Emerald",
    gold: "Gold",
    fire: "Fire",
    water: "Water",
    air: "Air",
    earth: "Earth",
    nixie: "Nixie",
  } as Record<string, string>,
};

export type Catalog = typeof en;
