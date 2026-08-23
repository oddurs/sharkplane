export type Lang = "en" | "is";

const STRINGS = {
  en: {
    tagline: "You are a big plane with a bad attitude. Don't shoot them.", eatThem: "EAT THEM.",
    sortie: "SORTIE", controls: "CONTROLS", options: "OPTIONS", back: "BACK", resume: "RESUME", restart: "RESTART", quit: "QUIT TO TITLE",
    paused: "PAUSED", complete: "SORTIE COMPLETE", flyAgain: "FLY AGAIN", copy: "COPY SCORE", copied: "COPIED!", title: "TITLE",
    score: "SCORE", planesEaten: "PLANES EATEN", bestCombo: "BEST COMBO", firstBite: "TIME TO FIRST BITE", highScore: "HIGH SCORE", never: "never!",
    newHigh: "NEW HIGH SCORE", unlocked: "UNLOCKED", medal: "MEDAL", daily: "Daily sortie — same skies for everyone today.",
    yourRide: "YOUR RIDE", skip: "PRESS ANY KEY TO SKIP", wave: "WAVE", frenzy: "FRENZY", throttleUp: "THROTTLE UP (SHIFT)", pullUp: "PULL UP", boost: "BOOST",
    hungry: "HUNGRY", starving: "STARVING — EAT!", zeppelin: "ZEPPELIN", lowQuality: "LOW QUALITY MODE", resuming: "RESUMING",
    // radio lines
    r_takeoff: "Tower: Shark One, you're clear. Go eat something.", r_rotate: "Tower: Rotate, rotate!", r_firstEat: "You: Mmm. Tastes like aluminium.",
    r_combo: "You: I could do this all day.", r_frenzy: "You: FEEDING TIME!", r_boss: "Tower: Uh… Shark One, there's a zeppelin. Bon appétit.",
    r_bossDown: "You: Burp. Excuse me.", r_enemySpot: "Enemy: It's behind me! IT'S BEHIND ME!", r_enemyPair: "Enemy: Stay close, wingman— wingman?",
    r_land: "Tower: Nice landing. Did you bring us anything?", r_hungry: "You: Getting peckish up here.", r_starving: "Tower: Shark One, your engine sounds… hungry.",
    r_crash: "Enemy: I'd rather crash than— oh.", r_wave: "Tower: Fresh batch inbound. Chew with your mouth closed.", r_bird: "You: Snack.",
    // tutorial
    t_throttle: "Tower: Hold SHIFT to throttle up and roll down the strip.", t_rotate: "Tower: Past 150 — pull back (S) to rotate.",
    t_find: "Tower: Follow the yellow arrow to your first meal.", t_bite: "Tower: Line the bracket up with your nose and close in. Tap SPACE to lunge.",
    t_done: "Tower: That's it. You're a natural. A horrible, horrible natural.",
  },
  is: {
    tagline: "Þú ert stór flugvél með slæmt viðhorf. Ekki skjóta þær.", eatThem: "ÉTTU ÞÆR.",
    sortie: "FLUGFERÐ", controls: "STÝRING", options: "STILLINGAR", back: "TIL BAKA", resume: "HALDA ÁFRAM", restart: "BYRJA AFTUR", quit: "Á TITILSÍÐU",
    paused: "Í BIÐ", complete: "FLUGFERÐ LOKIÐ", flyAgain: "FLJÚGA AFTUR", copy: "AFRITA STIG", copied: "AFRITAÐ!", title: "TITILL",
    score: "STIG", planesEaten: "VÉLAR ÉTNAR", bestCombo: "BESTA KEÐJA", firstBite: "TÍMI AÐ FYRSTA BITA", highScore: "MET", never: "aldrei!",
    newHigh: "NÝTT MET", unlocked: "OPNAÐ", medal: "VERÐLAUN", daily: "Dagleg ferð — sami himinn fyrir alla í dag.",
    yourRide: "VÉLIN ÞÍN", skip: "ÝTTU Á HVAÐA TAKKA SEM ER", wave: "BYLGJA", frenzy: "ÆÐI", throttleUp: "GEFA Í (SHIFT)", pullUp: "TOGA UPP", boost: "SKOT",
    hungry: "SVANGUR", starving: "HUNGRAÐUR — ÉTTU!", zeppelin: "LOFTSKIP", lowQuality: "LÁG GÆÐI", resuming: "HELDUR ÁFRAM",
    r_takeoff: "Turn: Hákarl eitt, leiðin er greið. Farðu að éta.", r_rotate: "Turn: Toga upp, toga upp!", r_firstEat: "Þú: Mmm. Bragðast eins og ál.",
    r_combo: "Þú: Ég gæti gert þetta allan daginn.", r_frenzy: "Þú: MATARTÍMI!", r_boss: "Turn: Ehm… Hákarl eitt, það er loftskip. Verði þér að góðu.",
    r_bossDown: "Þú: Rop. Afsakið.", r_enemySpot: "Óvinur: Hann er fyrir aftan mig! FYRIR AFTAN MIG!", r_enemyPair: "Óvinur: Haltu þig nálægt, vængmaður— vængmaður?",
    r_land: "Turn: Flott lending. Komstu með eitthvað handa okkur?", r_hungry: "Þú: Farinn að verða svangur hérna uppi.", r_starving: "Turn: Hákarl eitt, vélin hljómar… svöng.",
    r_crash: "Óvinur: Frekar brotlendi ég en— ó.", r_wave: "Turn: Ný sending á leiðinni. Tyggðu með lokaðan munn.", r_bird: "Þú: Snarl.",
    t_throttle: "Turn: Haltu SHIFT til að gefa í og rúlla eftir brautinni.", t_rotate: "Turn: Yfir 150 — togaðu aftur (S) til að lyfta.",
    t_find: "Turn: Fylgdu gulu örinni að fyrstu máltíðinni.", t_bite: "Turn: Stilltu rammann við nefið og nálgastu. Ýttu á SPACE til að stökkva.",
    t_done: "Turn: Þetta er komið. Þú ert náttúrutalent. Hræðilegt, hræðilegt náttúrutalent.",
  },
} as const;

export type StringKey = keyof typeof STRINGS.en;
let current: Lang = "en";
export function setLang(l: Lang) { current = l; }
export function t(key: StringKey): string { return (STRINGS[current] as Record<string, string>)[key] ?? STRINGS.en[key]; }
export const LANGS: Array<{ code: Lang; name: string }> = [{ code: "en", name: "English" }, { code: "is", name: "Íslenska" }];
