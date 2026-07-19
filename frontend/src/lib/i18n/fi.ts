// Finnish (Suomi) catalog. Typed as Catalog so it stays in lockstep with en.ts.

import type { Catalog } from "./en";

export const fi: Catalog = {
  // Lobby
  tagline: "Heitelkää noppia yhdessä, vuorotellen.",
  yourName: "Nimesi",
  namePlaceholder: "Nimetön",
  createGame: "Luo peli",
  orJoin: "tai liity peliin",
  codePlaceholder: "KOODI",
  join: "Liity",
  errCreate: "Pelin luonti epäonnistui — onko palvelin käynnissä?",
  errNoGame: (code: string) =>
    `Peliä "${code}" ei löydy — se on ehkä vanhentunut.`,
  errJoin: "Liittyminen epäonnistui — yritä uudelleen.",

  // Header + notices
  settings: "Asetukset",
  leave: "Poistu",
  connecting: "Yhdistetään…",
  backToStart: "Takaisin alkuun",
  retry: "Yritä uudelleen",
  notFoundTitle: "Peliä ei löytynyt",
  notFoundBody: (code: string) =>
    `Koodia ${code} ei ole olemassa tai se on vanhentunut.`,
  endedTitle: "Peli päättyi",
  endedBody: (code: string) =>
    `Peli ${code} ei ole enää saatavilla — se vanhentui tai palvelin käynnistyi uudelleen (pelejä ei tallenneta). Aloita uusi peli.`,
  errorTitle: "Yhteys epäonnistui",
  errorBody: "Jotain meni pieleen palvelimeen yhdistäessä.",

  // Dice stage
  yourTurn: "Sinun vuorosi",
  invite: "Kutsu",
  diceBack: "Nopat",
  tapToRoll: "Napauta heittääksesi",
  tapOrShakeToRoll: "Napauta tai ravista heittääksesi",
  shaking: "Ravistetaan… irrota heittääksesi",
  rolledResult: (name: string, total: number) => `${name} heitti ${total}`,
  diceFallback: "Nopat",

  // Toolbar
  rolling: "Heitetään…",
  roll: "Heitä",
  waitingFor: (name: string) => `Odotetaan pelaajaa ${name}…`,
  skip: "Ohita",
  playersTurn: (name: string) => `${name} on vuorossa`,
  waiting: "Odotetaan…",

  // Settings
  game: "Peli",
  freeDice: "Vapaat nopat",
  liarsDice: "Valehtelijan nopat",
  diceCount: "Noppien määrä",
  diceSelectLabel: "Nopat",
  tableSelectLabel: "Pöytä",
  appearance: "Ulkoasu",
  sound: "Äänet",
  shakeSetting: "Ravista heittääksesi",
  language: "Kieli",

  // Theme + language
  light: "vaalea",
  dark: "tumma",
  auto: "auto",
  english: "English",
  finnish: "Suomi",

  // Players + history
  players: "Pelaajat",
  dragHint: "Vedä riviä muuttaaksesi vuorojärjestystä.",
  renameSelf: "Nimeä itsesi uudelleen",
  dragReorder: (name: string) => `Vedä järjestääksesi ${name}`,
  history: "Historia",
  historyEmpty: "Heitot näkyvät tässä.",

  // Share
  gameCode: "Pelikoodi",
  copyCode: "Kopioi koodi",
  copyInviteLink: "Kopioi kutsulinkki",
  linkCopied: "Linkki kopioitu",
  codeCopied: "Koodi kopioitu",
  shareHint: "Skannaa QR tai jaa koodi / linkki kutsuaksesi pelaajia.",
  qrAlt: "QR-koodi peliin liittymiseen",

  // Modal
  closeSettings: "Sulje asetukset",

  // Liar's Dice
  dealing: "Jaetaan…",
  liarsWin: (name: string, isYou: boolean) =>
    isYou ? "Voitit!" : `${name} voittaa!`,
  playAgain: "Pelaa uudelleen",
  outShort: "ulkona",
  toOpen: (name: string, isYou: boolean) =>
    isYou ? "Avaat kierroksen" : `${name} avaa`,
  diceInPlay: (n: number) =>
    `${n} ${n === 1 ? "noppa" : "noppaa"} pelissä · ykköset ovat jokereita`,
  bids: (name: string, isYou: boolean) =>
    isYou ? "Tarjoat" : `${name} tarjoaa`,
  nextRound: "Seuraava kierros",
  spectating: "Olet ulkona — seuraat peliä",
  bidLabel: (q: number) => `Tarjoa ${q} ×`,
  liar: "Valehtelija!",
  you: "Sinä",
  someone: "Joku",
  playerFallback: "Pelaaja",
  fewer: "Vähemmän",
  more: "Enemmän",
  faceAria: (f: number) => `Silmäluku ${f}`,
  liarsReveal: (
    caller: string,
    actual: number,
    bidTrue: boolean,
    loser: string,
    loserIsYou: boolean,
  ) =>
    `${caller}: valehtelija! Niitä oli ${actual}, joten ${
      bidTrue ? "tarjous piti paikkansa" : "tarjous oli bluffi"
    }. ${loser} ${loserIsYou ? "menetät" : "menettää"} nopan.`,

  // Table (deck) names
  decks: {
    "felt-green": "Vihreä veran",
    "felt-red": "Punainen veran",
    "felt-blue": "Sininen veran",
    oak: "Tammi",
    walnut: "Pähkinäpuu",
    concrete: "Betoni",
    steel: "Teräs",
    water: "Vesi",
  },

  // Dice theme names
  themes: {
    ivory: "Norsunluu",
    obsidian: "Obsidiaani",
    ruby: "Rubiini",
    emerald: "Smaragdi",
    gold: "Kulta",
    nixie: "Nixie",
  },
};
