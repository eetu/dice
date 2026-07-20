// English catalog — the source of truth for the message shape. Other locales are
// typed as `Catalog`, so a missing/renamed key fails the build. String values are
// plain; anything with interpolation or agreement is a function.

export const en = {
  // Lobby
  tagline: "Roll dice together, in turns.",
  yourName: "Your name",
  namePlaceholder: "Anonymous",
  createGame: "Create a game",
  orJoin: "or join one",
  codePlaceholder: "CODE",
  join: "Join",
  joinPromptTitle: "Pick a name to join",
  errCreate: "Couldn't create a game — is the server running?",
  errNoGame: (code: string) => `No game "${code}" — it may have expired.`,
  errJoin: "Couldn't join — try again.",

  // Header + notices
  settings: "Settings",
  leave: "Leave",
  cancel: "Cancel",
  leaveTitle: "Leave the game?",
  leaveBody:
    "You'll leave this game. Others keep playing — rejoin any time with the code.",
  connecting: "Connecting…",
  connected: "connected",
  disconnected: "disconnected",
  backToStart: "Back to start",
  retry: "Retry",
  notFoundTitle: "Game not found",
  notFoundBody: (code: string) =>
    `The code ${code} doesn't exist or has expired.`,
  endedTitle: "Game ended",
  endedBody: (code: string) =>
    `The game ${code} is no longer available — it expired or the server restarted (games aren't saved). Start a fresh one.`,
  errorTitle: "Couldn't connect",
  errorBody: "Something went wrong reaching the server.",

  // Dice stage
  yourTurn: "Your turn",
  invite: "Invite",
  diceBack: "Dice",
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
  diceCount: "Dice count",
  diceSelectLabel: "Dice",
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

  // Share
  gameCode: "Game code",
  copyCode: "Copy code",
  copyInviteLink: "Copy invite link",
  linkCopied: "Link copied",
  codeCopied: "Code copied",
  shareHint: "Scan the QR or share the code / link to invite players.",
  qrAlt: "QR code to join this game",

  // Modal
  closeSettings: "Close settings",

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
    nixie: "Nixie",
  } as Record<string, string>,
};

export type Catalog = typeof en;
