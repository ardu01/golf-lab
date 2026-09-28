const STORAGE_KEY = "golf-lab-caddie-ai";
const SEASON_KEY = "golf-lab-caddie-season";
const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

export const seasonRule = "Tus güiros son el carry de verano. En invierno baja: wedge ≤100 m un 5–8%, hierros 6–8 un 8–12%, hierros largos e híbridos un 10–15%, maderas y driver un 8–12% de carry (el total cae más porque muere la rodada). Auto: noviembre–marzo en Madrid es invierno; el resto, verano. El viento se aplica después.";

export const SEASONS = {
  verano: { label: "Verano", note: "Base. El carry es el de tus güiros de verano y el green firme deja correr el golpe." },
  invierno: { label: "Invierno", note: "El carry baja desde el verano y el suelo blando casi no rueda. Si no hay güiro de invierno, es una estimación." },
};

const WINTER_BANDS = {
  wedge: { factor: 0.065, low: 5, high: 8, label: "wedge ≤100 m" },
  nine: { factor: 0.08, low: 8, high: 8, label: "hierro 9" },
  mid: { factor: 0.1, low: 8, high: 12, label: "hierros 6–8" },
  long: { factor: 0.125, low: 10, high: 15, label: "hierros largos e híbridos" },
  wood: { factor: 0.1, low: 8, high: 12, label: "maderas" },
  driver: { factor: 0.1, low: 8, high: 12, label: "driver" },
};

export function seasonOfMadrid(date = new Date()) {
  let month = madridMonth(date);
  if (month === 11 || month === 12 || month <= 3) return "invierno";
  return "verano";
}

function madridMonth(date) {
  let value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return 7;
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", month: "numeric" }).format(value));
}

export function readSeasonChoice() {
  try {
    let value = localStorage.getItem(SEASON_KEY);
    if (value === "auto" || value === "verano" || value === "invierno") return value;
  } catch {}
  return "auto";
}

export function writeSeasonChoice(value) {
  let next = value === "auto" || SEASONS[value] ? value : "auto";
  localStorage.setItem(SEASON_KEY, next);
  return next;
}

export function clearSeasonChoice() {
  localStorage.removeItem(SEASON_KEY);
}

export function resolveSeason(choice, date = new Date()) {
  if (choice && choice !== "auto" && SEASONS[choice]) return { id: choice, source: "manual" };
  return { id: seasonOfMadrid(date), source: "auto" };
}

function ironNumber(label) {
  let match = String(label ?? "").match(/hierro\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function familyFor(club, summerCarry) {
  let carry = Number(summerCarry) || 0;
  let cat = club?.category;
  let n = ironNumber(club?.typeLabel);
  if (cat === "driver") return "driver";
  if (cat === "wood") return "wood";
  if (cat === "wedge" || (carry > 0 && carry <= 100)) return "wedge";
  if (cat === "hybrid" || (n != null && n <= 5)) return "long";
  if (n === 9) return "nine";
  return "mid";
}

export function fairwayMode(query) {
  return query?.lie === "tee" || query?.target === "fairway" || query?.target === "layup" || !!query?.layup;
}

export function expectedRoll(family, season, mode, pin) {
  if (mode !== "fairway") {
    if (season === "invierno") return 0;
    if (family === "wedge") return pin === "fondo" ? 6 : pin === "delante" ? 3 : 4;
    if (pin === "fondo") return 12;
    if (pin === "delante") return 5;
    return 8;
  }
  let table = {
    verano: { wedge: 4, nine: 10, mid: 18, long: 12, wood: 22, driver: 30 },
    invierno: { wedge: 1, nine: 2, mid: 4, long: 3, wood: 8, driver: 10 },
  };
  return table[season]?.[family] ?? table[season]?.mid ?? 0;
}

export function seasonAim(query) {
  if (!query || fairwayMode(query)) return { meters: 0, label: "" };
  let pin = query.pin || "centro";
  if (query.season === "invierno") {
    if (pin === "delante") return { meters: 2, label: "Bandera delante, green blando: carry 1–3 m pasado" };
    if (pin === "fondo") return { meters: 0, label: "" };
    return { meters: 1, label: "Green blando: carry casi hasta la bandera" };
  }
  if (pin === "fondo") return { meters: -12, label: "Bandera al fondo, green firme: caer 12 m antes" };
  if (pin === "delante") return { meters: -5, label: "Bandera delante, green firme: caer 5 m antes" };
  return { meters: -8, label: "Green firme: caer unos 8 m antes y dejar correr" };
}

export function shotSeason(shot) {
  if (shot?.season === "invierno" || shot?.season === "verano") return { id: shot.season, tagged: true };
  return { id: seasonOfMadrid(shot?.recordedAt || Date.now()), tagged: false };
}

function meanOf(rows) {
  if (!rows.length) return null;
  return rows.reduce((sum, shot) => sum + shot.carry, 0) / rows.length;
}

function rowsFor(profile, shots) {
  let all = (shots || []).filter((shot) => shot.clubId === profile.club?.id && typeof shot.carry === "number");
  if (profile.swing) return all.filter((shot) => shot.swingType === profile.swing);
  let full = all.filter((shot) => shot.swingType === "full" || !shot.swingType);
  return full.length ? full : all;
}

function pct(factor) {
  let n = Math.round(factor * 1000) / 10;
  return String(n).replace(".", ",");
}

function bandText(band) {
  return band.low === band.high ? `${band.low}%` : `${band.low}–${band.high}%`;
}

function missNote(rows) {
  if (!rows || rows.length < 4) return "";
  let avg = meanOf(rows);
  let short = rows.filter((shot) => shot.carry < avg - 2).length;
  let long = rows.filter((shot) => shot.carry > avg + 2).length;
  if (short === long) return "Tus güiros se reparten corto y largo de la media.";
  if (short > long) return `De estos güiros, ${short} se quedan cortos de tu media y ${long} se pasan.`;
  return `De estos güiros, ${long} se pasan de tu media y ${short} se quedan cortos.`;
}

// Fractions come from the player's own wedges when a club has both a full
// swing and a partial with at least 3 güiros. The demo wedge book lands near
// 62% (½) and 84% (¾), above a generic 50–55 / 75–80 guess, so that book is
// the fallback until real partials exist.
export const SWING_FALLBACK = { half: 0.62, threeQuarter: 0.84 };
const SWING_IDS = ["half", "threeQuarter", "full"];
const GAP_METERS = 8;

function clubRows(club, shots, swing) {
  return (shots || []).filter((shot) => {
    if (!club || shot.clubId !== club.id || typeof shot.carry !== "number") return false;
    if (swing === "full") return shot.swingType === "full" || !shot.swingType;
    return shot.swingType === swing;
  });
}

export function fullCarryOf(club, shots) {
  let rows = clubRows(club, shots, "full");
  let mean = meanOf(rows);
  if (mean != null) return { carry: mean, n: rows.length, source: "logged" };
  if (club?.carryHabitual != null && club.carryHabitual > 0) return { carry: club.carryHabitual, n: 0, source: "stock" };
  return { carry: null, n: 0, source: "none" };
}

export function swingFractions(clubs, shots) {
  let buckets = { half: [], threeQuarter: [] };
  for (let club of clubs || []) {
    if (!club || club.category === "putter") continue;
    let full = fullCarryOf(club, shots);
    if (full.source !== "logged" || full.n < 3 || !full.carry) continue;
    for (let swing of ["half", "threeQuarter"]) {
      let rows = clubRows(club, shots, swing);
      if (rows.length < 3) continue;
      let mean = meanOf(rows);
      if (mean == null || mean <= 0) continue;
      buckets[swing].push(mean / full.carry);
    }
  }
  let ratio = (id) => (buckets[id].length ? buckets[id].reduce((sum, value) => sum + value, 0) / buckets[id].length : SWING_FALLBACK[id]);
  return {
    half: ratio("half"),
    threeQuarter: ratio("threeQuarter"),
    learnedHalf: buckets.half.length > 0,
    learnedThreeQuarter: buckets.threeQuarter.length > 0,
  };
}

function neighborLabel(clubs, shots, carry, selfId) {
  if (carry == null) return "";
  let best = null;
  for (let club of clubs || []) {
    if (!club || club.id === selfId || club.category === "putter") continue;
    let full = fullCarryOf(club, shots);
    if (full.carry == null) continue;
    let gap = Math.abs(full.carry - carry);
    if (gap <= GAP_METERS && (best == null || gap < best.gap)) best = { gap, label: club.typeLabel, carry: full.carry };
  }
  if (!best) return "";
  return `encaja con ${best.label} (${Math.round(best.carry)} m)`;
}

export function swingBook(club, shots, clubs) {
  let fractions = swingFractions(clubs, shots);
  let full = fullCarryOf(club, shots);
  let book = {};
  for (let swing of SWING_IDS) {
    if (swing === "full") {
      book.full = {
        swing,
        carry: full.carry,
        n: full.n,
        source: full.source === "logged" ? "logged" : full.source,
        ratio: full.carry ? 1 : null,
        percent: full.carry ? 100 : null,
        fullCarry: full.carry,
        nearLabel: "",
        learned: false,
      };
      continue;
    }
    let rows = clubRows(club, shots, swing);
    let logged = meanOf(rows);
    let ratio = fractions[swing];
    let learned = swing === "half" ? fractions.learnedHalf : fractions.learnedThreeQuarter;
    if (logged != null) {
      book[swing] = {
        swing,
        carry: logged,
        n: rows.length,
        source: "logged",
        ratio: full.carry ? logged / full.carry : null,
        percent: full.carry ? Math.round((logged / full.carry) * 100) : null,
        fullCarry: full.carry,
        nearLabel: "",
        learned,
      };
      continue;
    }
    if (full.carry == null) {
      book[swing] = { swing, carry: null, n: 0, source: "none", ratio, percent: Math.round(ratio * 100), fullCarry: null, nearLabel: "", learned };
      continue;
    }
    let carry = full.carry * ratio;
    book[swing] = {
      swing,
      carry,
      n: 0,
      source: "estimado",
      ratio,
      percent: Math.round(ratio * 100),
      fullCarry: full.carry,
      nearLabel: neighborLabel(clubs, shots, carry, club?.id),
      learned,
    };
  }
  return book;
}

function rollSentence(season, mode, pin, roll) {
  let greenRoll = season === "verano" ? (pin === "fondo" ? "12" : pin === "delante" ? "5" : "8") : "0";
  if (mode === "fairway") return `En el total, la rodada de ${season === "verano" ? "suelo firme" : "suelo blando"} suma ${roll} m. En verano un hierro medio corre 10–25 m y el driver 20–40 m; en invierno el hierro se queda en 0–8 m y el driver en 5–15 m.`;
  if (season === "verano") return `Green firme: el número ya deja la caída ${greenRoll} m antes (tramo 5–12) para que corra.`;
  return "Green blando: sin rodada. El número pide el carry hasta la bandera, o 1–3 m pasado si está delante.";
}

function applySwingEstimate(profile, season, pin, mode) {
  let summerFlight = profile.carry;
  let family = familyFor(profile.club, profile.fullCarry || summerFlight);
  let band = WINTER_BANDS[family];
  let flight = season === "invierno" ? summerFlight * (1 - band.factor) : summerFlight;
  let roll = mode === "fairway" ? expectedRoll(family, season, mode, pin) : 0;
  let percent = Math.round((profile.swingRatio || 0) * 100);
  let fullM = profile.fullCarry != null ? Math.round(profile.fullCarry) : null;
  let base = `No hay güiro de este swing. Estimo ${Math.round(summerFlight)} m, el ${percent}% del completo${fullM != null ? ` (${fullM} m)` : ""}.`;
  let seasonNote = season === "invierno"
    ? `${base} Estima invierno: ${Math.round(flight)} m, ${pct(band.factor)}% menos (tramo ${bandText(band)}, ${band.label}).`
    : base;
  return {
    ...profile,
    carry: flight,
    summerCarry: summerFlight,
    roll,
    playing: flight + roll,
    family,
    factor: season === "invierno" ? band.factor : 0,
    estimated: season === "invierno",
    swingEstimate: true,
    seasonShotSource: season === "invierno" ? "estima-swing-invierno" : "estima-swing",
    seasonNote: `${seasonNote} ${rollSentence(season, mode, pin, roll)}`,
    missNote: "",
    stats: { ...profile.stats, n: 0, mean: flight },
  };
}

export function applySeason(profile, shots, query) {
  if (!profile || profile.carry == null || !profile.club) return profile;
  let season = query?.season === "invierno" ? "invierno" : "verano";
  let pin = query?.pin || "centro";
  let mode = fairwayMode(query) ? "fairway" : "green";
  let rows = rowsFor(profile, shots);
  if (profile.swingEstimate && rows.length === 0) return applySwingEstimate(profile, season, pin, mode);
  let verano = rows.filter((shot) => shotSeason(shot).id === "verano");
  let invierno = rows.filter((shot) => shotSeason(shot).id === "invierno");
  let summerCarry = meanOf(verano);
  let winterCarry = meanOf(invierno);
  let stock = profile.used === "declared" || rows.length === 0;
  let familyCarry = summerCarry ?? winterCarry ?? profile.carry;
  let family = familyFor(profile.club, familyCarry);
  let band = WINTER_BANDS[family];
  let flight = profile.carry;
  let estimated = false;
  let source = "stock";
  let used = rows;
  if (season === "verano") {
    if (summerCarry != null) {
      flight = summerCarry;
      used = verano;
      source = verano.some((shot) => shotSeason(shot).tagged) ? "tag" : "fecha";
    } else if (winterCarry != null) {
      flight = winterCarry / (1 - band.factor);
      used = invierno;
      estimated = true;
      source = "estima-verano";
    } else {
      flight = profile.carry;
      estimated = stock;
      source = "stock";
      used = [];
    }
  } else if (winterCarry != null) {
    flight = winterCarry;
    used = invierno;
    source = invierno.some((shot) => shotSeason(shot).tagged) ? "tag" : "fecha";
  } else if (summerCarry != null) {
    flight = summerCarry * (1 - band.factor);
    used = verano;
    estimated = true;
    source = "estima-invierno";
  } else {
    flight = profile.carry * (1 - band.factor);
    estimated = true;
    source = "estima-stock";
    used = [];
  }
  let roll = mode === "fairway" ? expectedRoll(family, season, mode, pin) : 0;
  let playing = flight + roll;
  let tagged = source === "tag";
  let count = used.length;
  let noun = count === 1 ? "güiro" : "güiros";
  let seasonNote;
  if (source === "estima-stock") seasonNote = `No hay güiros de este palo. Stock de verano ${Math.round(profile.carry)} m. Estima invierno: ${Math.round(flight)} m (${pct(band.factor)}%, tramo ${bandText(band)} de ${band.label}).`;
  else if (source === "stock") seasonNote = `No hay güiros de este palo. Uso el stock de verano (${Math.round(flight)} m).`;
  else if (source === "estima-invierno") seasonNote = `Tus ${count} ${noun} son de verano (media ${Math.round(summerCarry)} m${tagged ? ", etiquetados" : ", por la fecha"}). Estima invierno: ${Math.round(flight)} m, ${pct(band.factor)}% menos (tramo ${bandText(band)}, ${band.label}).`;
  else if (source === "estima-verano") seasonNote = `Solo tengo ${count} ${noun} de invierno (media ${Math.round(winterCarry)} m). Estimo el verano en ${Math.round(flight)} m, invirtiendo el tramo ${bandText(band)}.`;
  else if (season === "invierno") seasonNote = `Uso ${count} ${noun} de invierno${tagged ? " etiquetados" : " (por la fecha, sin etiqueta)"}, media ${Math.round(flight)} m. No aplico la estimación.`;
  else seasonNote = `Base de verano: ${count} ${noun}${tagged ? " etiquetados" : " (por la fecha)"}, media ${Math.round(flight)} m.`;
  let greenRoll = season === "verano" ? (pin === "fondo" ? "12" : pin === "delante" ? "5" : "8") : "0";
  let rollNote = mode === "fairway"
    ? `En el total, la rodada de ${season === "verano" ? "suelo firme" : "suelo blando"} suma ${roll} m. En verano un hierro medio corre 10–25 m y el driver 20–40 m; en invierno el hierro se queda en 0–8 m y el driver en 5–15 m.`
    : season === "verano"
      ? `Green firme: el número ya deja la caída ${greenRoll} m antes (tramo 5–12) para que corra.`
      : "Green blando: sin rodada. El número pide el carry hasta la bandera, o 1–3 m pasado si está delante.";
  return {
    ...profile,
    carry: flight,
    summerCarry: summerCarry ?? (stock ? profile.carry : null),
    roll,
    playing,
    family,
    factor: estimated && season === "invierno" ? band.factor : 0,
    estimated,
    seasonShotSource: source,
    seasonNote: `${seasonNote} ${rollNote}`,
    missNote: missNote(used),
    stats: { ...profile.stats, n: count || profile.stats?.n || 0, mean: flight },
  };
}

function emptyConfig() {
  return { apiKey: "", baseUrl: "", model: "" };
}

export function readAiConfig() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyConfig();
    let parsed = JSON.parse(raw);
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return emptyConfig();
  }
}

export function writeAiConfig(config) {
  let next = {
    apiKey: String(config.apiKey ?? "").trim(),
    baseUrl: String(config.baseUrl ?? "").trim(),
    model: String(config.model ?? "").trim(),
  };
  if (!next.apiKey && !next.baseUrl && !next.model) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearAiConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

function who(name) {
  let n = String(name ?? "").trim();
  return n || "";
}

function strategyCopy(strategy, club, name, query, estimatedSwing) {
  let n = who(name);
  let you = n ? `${n}, ` : "";
  let winter = query?.season === "invierno";
  if (!club) return `${you}no tienes un palo con distancia para este número. Declara un carry o registra güiros.`;
  if (estimatedSwing && strategy !== "safe" && strategy !== "aggressive") return `${you}${club} es una estimación a partir del completo, no un güiro de ese swing. Si lo anotas, sustituye la cifra.`;
  if (winter && (strategy === "safe" || query?.pin === "delante" || query?.bunker || query?.shortHazard != null)) return `${you}en invierno, entre dos palos, coge el más largo si el problema es quedarte corto. ${club} es esa opción. El suelo blando no te perdona.`;
  if (!winter && strategy === "aggressive") return `${you}en verano la rodada a veces alcanza: ${club} puede bastar aunque el carry se quede un poco antes. Si no te sale, vuelve a conservador.`;
  if (strategy === "safe") return `${you}${club} es la opción holgada con tus güiros de verano. Si dudas entre dos palos, coge el de más.`;
  if (strategy === "aggressive") return `${you}${club} juega tu número. El margen es justo: si el golpe no te sale, baja a conservador.`;
  return `${you}${club} sale de tus propios güiros. Ni persigas la bandera ni dejes el palo corto a propósito.`;
}

const SWING = { full: "completo", threeQuarter: "¾", half: "½" };

function swingStats(shots) {
  return ["full", "threeQuarter", "half"].map((id) => {
    let rows = shots.filter((s) => s.swingType === id && typeof s.carry === "number");
    if (!rows.length) return null;
    let mean = rows.reduce((sum, s) => sum + s.carry, 0) / rows.length;
    return { id, n: rows.length, mean: Math.round(mean) };
  }).filter(Boolean);
}

function formatDay(iso) {
  let date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Madrid" }).format(date);
}

function personalLine(name, option, shots) {
  let n = who(name);
  let hello = n ? `${n}, ` : "";
  if (!option) return `${hello}no hay un palo con datos para este golpe.`;
  if (option.swingEstimate) {
    let swing = SWING[option.swing] || "swing";
    let percent = option.swingRatio != null ? Math.round(option.swingRatio * 100) : null;
    let full = option.fullCarry != null ? Math.round(option.fullCarry) : null;
    let meters = Math.round(option.summerCarry ?? option.carry);
    return `${hello}no has anotado un golpe de ${swing} con este palo. Estimo ${meters} m de verano${percent != null ? `, el ${percent}% del completo` : ""}${full != null ? ` (${full} m)` : ""}. Un güiro real sustituye esta cifra.`;
  }
  let mine = (shots || []).filter((s) => s.clubId === option.clubId);
  let swings = swingStats(mine);
  let swingBits = swings.map((s) => `${s.n} ${s.n === 1 ? "güiro" : "güiros"} de ${SWING[s.id]} (media ${s.mean} m)`);
  let body;
  if (option.used === "declared" || (swings.length === 0 && option.seasonShotSource === "estima-stock") || (swings.length === 0 && option.used !== "shots")) {
    body = `${hello}en ${option.title} no tengo güiros. El stock es de verano${option.summerCarry != null ? ` (${Math.round(option.summerCarry)} m)` : option.carry != null ? ` (${Math.round(option.carry)} m)` : ""}.`;
  } else if (swings.length === 0) {
    body = `${hello}este ${option.title} no tiene güiros guardados.`;
  } else {
    let spread = option.dispersion == null ? "" : option.quality === "sufficient" && option.dispersion <= 8 ? ` Te sale bastante junto (±${Math.round(option.dispersion)} m).` : option.dispersion >= 12 ? ` La distancia se te mueve (±${Math.round(option.dispersion)} m).` : ` Dispersión ±${Math.round(option.dispersion)} m.`;
    body = `${hello}este ${option.title} sale de tus güiros: ${swingBits.join(", ")}.${spread}`;
  }
  if (option.missNote) body += ` ${option.missNote}`;
  if (option.clubCategory === "driver" && option.dispersion != null) body += ` No hay calles (FIR) guardadas; la tendencia del driver es su dispersión, ±${Math.round(option.dispersion)} m.`;
  let latest = mine.map((s) => s.recordedAt).filter(Boolean).sort().at(-1);
  if (latest) {
    let day = latest.slice(0, 10);
    let count = mine.filter((s) => String(s.recordedAt).slice(0, 10) === day).length;
    let nice = formatDay(latest);
    if (nice) body += ` Última tanda con este palo: ${nice} (${count} ${count === 1 ? "güiro" : "güiros"}).`;
  }
  return body;
}

export function adviceFor(query, result, personal = {}) {
  let top = result.options?.[0] ?? null;
  let club = top?.title ?? null;
  let longTrouble = !!query.water || query.longHazard != null;
  let shortTrouble = !!query.bunker || query.shortHazard != null;
  let side = "centro";
  let sideLabel = "Al centro";
  let sideDetail = "Sin problema marcado. Apunta al centro del green, no al borde.";
  if (longTrouble && shortTrouble) {
    side = "centro";
    sideLabel = "Entre los dos problemas";
    sideDetail = "Hay problema corto y largo. Juega al número del palo y no persigas la bandera.";
  } else if (longTrouble) {
    side = "corto";
    sideLabel = "Fallo corto";
    sideDetail = query.water ? "Hay agua. Mejor quedarse corto que pasarse." : `El problema está largo (${query.longHazard} m). El fallo bueno es corto.`;
  } else if (shortTrouble) {
    side = "largo";
    sideLabel = "Fallo largo";
    sideDetail = query.bunker ? "El bunker está corto. Mejor volarlo que quedarse dentro." : `El obstáculo corto está a ${query.shortHazard} m. No te quedes delante.`;
  } else if (query.season === "invierno" && query.pin === "delante") {
    side = "largo";
    sideLabel = "Llevar el carry";
    sideDetail = "Invierno, green blando y bandera delante: el vuelo tiene que llegar (o pasarse 1–3 m). No busques un bote corto.";
  } else if (query.season === "verano" && query.pin === "fondo") {
    side = "corto";
    sideLabel = "Caída corta";
    sideDetail = "Verano, green firme y bandera al fondo: aterriza 5–12 m antes y deja que corra.";
  } else if (query.strategy === "safe") {
    side = "corto";
    sideLabel = "Fallo corto";
    sideDetail = "En conservador, sin problema marcado, el fallo bueno es quedarte un poco antes del fondo.";
  } else if (query.strategy === "aggressive") {
    side = "numero";
    sideLabel = "Al número";
    sideDetail = "En agresivo juegas la distancia del palo hacia la bandera. No hay un lado seguro extra.";
  }
  if (query.windDir === "cross") sideDetail += " El viento es lateral, pero tus golpes no guardan izquierda o derecha, así que no invento ese lado.";
  if (top && top.delta < -8 && query.strategy !== "aggressive") sideDetail += " Este palo se queda corto del número: para llegar hace falta más palo.";
  if (top && top.delta > 8 && (query.strategy === "safe" || longTrouble)) sideDetail += " Este palo pasa el número: apunta a la parte de delante.";
  let labels = { safe: "Conservador", normal: "Normal", aggressive: "Agresivo" };
  let seasonId = query.season === "invierno" ? "invierno" : "verano";
  let season = SEASONS[seasonId];
  let name = personal.playerName ?? query.playerName ?? "";
  let flight = top?.carry != null ? Math.round(top.carry) : null;
  let playing = top?.playing != null ? Math.round(top.playing) : flight;
  let seasonDetail = top?.seasonNote || season.note;
  if (seasonId === "invierno" && Number(query.distance) >= 140 && top?.family !== "wedge") seasonDetail += " De ~140 m para arriba, la guía rápida es un palo más; si el green tampoco corre, a veces son dos.";
  if (seasonId === "invierno" && top?.family === "wedge") seasonDetail += " En el wedge el palo a menudo es el mismo, pero el golpe sale más corto.";
  if (query.lie === "tee" && top?.clubCategory !== "driver") seasonDetail += " No hay dato de calles (FIR); no invento esa tendencia.";
  seasonDetail += " El viento, el lie y el desnivel van después de este ajuste.";
  return {
    club,
    carry: flight,
    playing,
    side,
    sideLabel,
    sideDetail,
    strategy: query.strategy ?? "normal",
    strategyLabel: labels[query.strategy] ?? "Normal",
    strategyDetail: strategyCopy(query.strategy, club, name, query, !!top?.swingEstimate),
    personalLine: personalLine(name, top, personal.shots || []),
    season: seasonId,
    seasonLabel: season.label,
    seasonSource: query.seasonSource === "manual" ? "manual" : "auto",
    seasonMeters: top?.summerCarry != null && flight != null ? Math.round(flight - top.summerCarry) : 0,
    estimated: !!top?.estimated,
    swingEstimate: !!top?.swingEstimate,
    seasonDetail,
    source: "reglas",
  };
}

function endpoint(config) {
  let base = (config.baseUrl || DEFAULT_BASE).trim().replace(/\/$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

export async function explainAdvice(config, advice, context) {
  let apiKey = String(config.apiKey ?? "").trim();
  if (!apiKey) throw Error("No hay clave. El consejo de reglas no necesita IA.");
  let payload = {
    consejo: advice,
    objetivoMetros: context?.distance ?? null,
    objetivoAjustado: context?.adjusted ?? null,
  };
  let res;
  try {
    res = await fetch(endpoint(config), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: String(config.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: "Eres el caddie de Golf Performance Lab. Responde en español, en un párrafo corto. No inventes distancias, palos ni lados del fallo. Solo reformula el consejo de reglas que recibes. Si faltan datos, dilo." },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
  } catch {
    throw Error("No se pudo contactar con el endpoint desde el navegador. El consejo de reglas sigue valiendo.");
  }
  let data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data?.error?.message || `HTTP ${res.status}`;
    throw Error(`La IA no respondió (${msg}). El consejo de reglas sigue valiendo.`);
  }
  let text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw Error("La IA no devolvió texto. El consejo de reglas sigue valiendo.");
  return text;
}
