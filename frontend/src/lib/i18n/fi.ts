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
  scan: "Skannaa QR-koodi",
  scanTitle: "Skannaa QR-koodi",
  scanHint: "Osoita pelin QR-koodia",
  scanInvalid: "Tämä ei ole dice-pelin koodi",
  scanDenied: "Kameran käyttö estetty — salli se asetuksista",
  scanNoCam: "Kameraa ei löytynyt",
  namePromptTitle: "Valitse nimi",
  namePromptBody: (assigned: string) =>
    `Olet pelissä nimellä ${assigned}. Voit vaihtaa sen tässä tai pitää sen.`,
  saveName: "Tallenna",
  errNoGame: (code: string) =>
    `Peliä "${code}" ei löydy — se on ehkä vanhentunut.`,
  storageBlocked:
    "Selaimesi estää sivustodatan, joten nimeäsi tai paikkaasi ei muisteta sivun latauksen jälkeen. Pelaaminen toimii silti.",

  // Header + notices
  settings: "Asetukset",
  leave: "Poistu",
  cancel: "Peruuta",
  leaveTitle: "Poistutaanko pelistä?",
  leaveBody:
    "Poistut tästä pelistä. Muut jatkavat — voit liittyä uudelleen koodilla.",
  leaveTitleLast: "Poistutaanko ja lopetetaanko peli?",
  leaveBodyLast:
    "Olet viimeinen pelaaja — poistuminen lopettaa pelin lopullisesti ja vapauttaa koodin.",
  connecting: "Yhdistetään…",
  connected: "yhteydessä",
  disconnected: "ei yhteyttä",
  connectionLost: "Yhteys katkesi — yhdistetään uudelleen…",
  backToStart: "Takaisin alkuun",
  retry: "Yritä uudelleen",
  notFoundTitle: "Peliä ei löytynyt",
  notFoundBody: (code: string) =>
    `Koodia ${code} ei ole olemassa tai se on vanhentunut.`,
  endedTitle: "Peli päättyi",
  endedBody: (code: string) =>
    `Peli ${code} ei ole enää saatavilla — se vanhentui tai palvelin käynnistyi uudelleen (pelejä ei tallenneta). Aloita uusi peli.`,
  joinFail: {
    notfound: {
      title: "Peliä ei löydy",
      body: "Koodia ei ole olemassa tai se on vanhentunut.",
    },
    full: {
      title: "Peli on täynnä",
      body: "Pelissä on jo suurin sallittu määrä pelaajia. Pyydä jotakuta poistumaan tai aloita uusi peli.",
    },
    busy: {
      title: "Palvelin on täynnä",
      body: "Kapasiteetti on juuri nyt täynnä. Yritä hetken kuluttua uudelleen.",
    },
    throttled: {
      title: "Liian monta yritystä",
      body: "Verkostasi tuli liian monta yritystä peräkkäin. Odota minuutti ja yritä uudelleen.",
    },
    offline: {
      title: "Ei verkkoyhteyttä",
      body: "Laitteellasi ei ole verkkoyhteyttä. Tarkista se ja yritä uudelleen.",
    },
    timeout: {
      title: "Palvelin ei vastannut",
      body: "Vastaus kesti liian kauan. Palvelin voi olla käynnistymässä uudelleen.",
    },
    unreachable: {
      title: "Palvelimeen ei saada yhteyttä",
      body: "Verkkosi toimii, mutta palvelin ei vastaa. Se voi olla alhaalla tai käynnistymässä uudelleen.",
    },
    wsRefused: {
      title: "Palvelin on kiireinen",
      body: "Palvelin toimii, mutta ei ota juuri nyt uusia yhteyksiä. Yritä pian uudelleen.",
    },
    unknown: {
      title: "Yhteys epäonnistui",
      body: "Jotain meni pieleen palvelimeen yhdistäessä.",
    },
  },
  staleSeat:
    "Vanha paikkasi tässä pelissä on poissa — liityit uutena pelaajana.",
  crashTitle: "Jotain hajosi",
  crashBody:
    "Sovellus törmäsi virheeseen, josta se ei toipunut. Uudelleenyritys yleensä korjaa asian — jos ei, lähetä alla olevat tiedot linkin jakajalle.",
  reload: "Lataa uudelleen",

  // Dice stage
  yourTurn: "Sinun vuorosi",
  invite: "Kutsu",
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
  yatzyDice: "Yatzy",
  farkleDice: "Farkle",
  dice: "Nopat",
  roundedDice: "Pyöristetyt nopat",
  dieMaterial: "Materiaali",
  trayCount: (n: number, max: number) => `${n}/${max}`,
  addDie: (kind: string) => `Lisää ${kind}`,
  removeDie: (kind: string) => `Poista ${kind}`,
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
  dragHint:
    "Vedä riviä — tai valitse kahva ja paina ↑/↓ — muuttaaksesi vuorojärjestystä.",
  renameSelf: "Nimeä itsesi uudelleen",
  dragReorder: (name: string) => `Järjestä ${name}`,
  movedTo: (name: string, pos: number, total: number) =>
    `${name} siirretty kohtaan ${pos}/${total}`,
  turnBadge: "vuoro",
  online: "paikalla",
  offline: "poissa",
  history: "Historia",
  historyEmpty: "Heitot näkyvät tässä.",

  // Share + bots
  addBot: "Lisää botti",
  botSkillEasy: "Helppo",
  botSkillHard: "Vaikea",
  botSkillCheater: "Ovela",
  botBadge: "Botti",
  removeBot: (name: string) => `Poista ${name}`,
  gameCode: "Pelikoodi",
  copyCode: "Kopioi koodi",
  copyInviteLink: "Kopioi kutsulinkki",
  linkCopied: "Linkki kopioitu",
  codeCopied: "Koodi kopioitu",
  shareHint: "Skannaa QR tai jaa koodi / linkki kutsuaksesi pelaajia.",
  qrAlt: "QR-koodi peliin liittymiseen",

  // Modal
  close: "Sulje",

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
  liarsNeedsOpponent: "Odotetaan toista pelaajaa — itseään ei voi bluffata",
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

  // Yatzy
  yatzyRoll: (n: number) => (n === 3 ? "Heitä" : `Heitä (${n} jäljellä)`),
  yatzyRollAll: "Heitä kaikki viisi",
  yatzyRollsLeft: (n: number) =>
    `${n} heitto${n === 1 ? "" : "a"} jäljellä · napauta pitääksesi`,
  yatzyHoldHint: "Napauta noppaa pitääksesi sen",
  yatzyPickBox: "Valitse ruutu pisteytettäväksi",
  yatzyTapToScore: "Napauta ruutua pisteyttääksesi tähän",
  yatzyUpper: "Yläosa",
  yatzyBonus: "Bonus",
  yatzyBonusHint: "Yläbonus: +50 kun ykköset–kutoset yhteensä 63 tai enemmän",
  yatzyToGo: (n: number) => `${n} vielä`,
  yatzyTotal: "Yhteensä",
  yatzySwipeHint: "Pyyhkäise tai napauta nimeä vaihtaaksesi pelaajaa",
  yatzyWaitingRoll: (name: string) => `Odotetaan, että ${name} heittää…`,
  yatzyYourTurn: "Sinun vuorosi — heitä",
  yatzyScratchHint: "Ei heittoja jäljellä — täytä ruutu (0 sallittu)",
  yatzyWin: (name: string, isYou: boolean) =>
    isYou ? "Voitit!" : `${name} voittaa!`,
  // Category names, keyed by YatzyCat.
  yatzyCats: {
    ones: "Ykköset",
    twos: "Kakkoset",
    threes: "Kolmoset",
    fours: "Neloset",
    fives: "Vitoset",
    sixes: "Kutoset",
    onePair: "Pari",
    twoPairs: "Kaksi paria",
    threeKind: "Kolme samaa",
    fourKind: "Neljä samaa",
    smallStraight: "Pieni suora",
    largeStraight: "Suuri suora",
    fullHouse: "Täyskäsi",
    chance: "Sattuma",
    yatzy: "Yatzy",
  } as Record<string, string>,

  // Farkle
  farkleTarget: (n: number) => `Ensimmäisenä ${n}`,
  farkleRoll: "Heitä",
  farkleRollRemaining: (n: number) => `Heitä ${n} noppaa`,
  farkleBank: (n: number) => `Pankkiin ${n}`,
  farklePass: "Ohita",
  farkleThisTurn: (n: number) => `Tällä vuorolla: ${n}`,
  farkleRemaining: (n: number) => `${n} ${n === 1 ? "noppa" : "noppaa"}`,
  // Sääntöpaneeli (laudan ?-käännös)
  farkleRules: "Säännöt",
  farkleRulesScoring: "Pisteytys",
  farkleRulesThreeKind: "Kolme samaa",
  farkleRuleLadder: "×2 / ×4 / ×8 = kolmikon pisteet kerrottuna",
  farkleRuleName: {
    fourKind: "Neljä samaa",
    fiveKind: "Viisi samaa",
    sixKind: "Kuusi samaa",
    straight: "Suora 1–6",
    threePairs: "Kolme paria",
    twoTriplets: "Kaksi kolmikkoa",
  },
  farklePick: "Napauta pisteyttäviä noppia sivuun",
  farkleSetAside: (n: number) => `Sivuun +${n}`,
  farkleHotDice: "Kuumat nopat! Heitä kaikki kuusi uudelleen",
  farkleBusted: "Farkle! Ei pisteitä — menetät vuoron",
  farkleBustedOther: (name: string) => `Farkle! ${name} jäi ilman pisteitä`,
  farkleYourRoll: "Sinun vuorosi — heitä",
  farkleWaiting: (name: string) => `Odotetaan pelaajaa ${name}…`,
  farkleKept: "Sivussa",
  farkleWin: (name: string, isYou: boolean) =>
    isYou ? "Voitit!" : `${name} voittaa!`,
  farkleHint:
    "Laita joka heitolla vähintään yksi pisteyttävä noppa sivuun, sitten pankita tai jatka onneasi. Jos et saa yhtään pisteyttävää noppaa, menetät vuoron pisteet.",

  // Table (deck) names
  decks: {
    "felt-green": "Vihreä verka",
    "felt-red": "Punainen verka",
    "felt-blue": "Sininen verka",
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
    fire: "Tuli",
    water: "Vesi",
    air: "Ilma",
    earth: "Maa",
    nixie: "Nixie",
  },
};
