const STORAGE_KEY = "golf-lab-caddie-ai";
const SEASON_KEY = "golf-lab-caddie-season";
const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

export const seasonRule = "Sobre el número que pides, en Madrid: invierno +8% (frío y blando, menos vuelo y rodada), primavera +3%, otoño 0 (tus medias, tal cual), verano −5% (cálido y firme, más rodada). Es una regla de campo, no una medición.";

export const SEASONS = {
  invierno: { label: "Invierno", factor: 0.08, note: "Aire frío y suelo blando: menos vuelo y menos rodada. El hoyo juega más largo, así que subo el número." },
  primavera: { label: "Primavera", factor: 0.03, note: "Aún fresco. Un poco más de palo que en tus medias." },
  verano: { label: "Verano", factor: -0.05, note: "Aire cálido y suelo firme: más rodada. El hoyo juega más corto, así que bajo el número." },
  otoño: { label: "Otoño", factor: 0, note: "Referencia. El número es el que pides, con tus distancias tal cual." },
};

export function seasonOfMadrid(date = new Date()) {
  let month = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", month: "numeric" }).format(date));
  if (month === 12 || month <= 2) return "invierno";
  if (month <= 5) return "primavera";
  if (month <= 8) return "verano";
  return "otoño";
}

export function readSeasonChoice() {
  try {
    let value = localStorage.getItem(SEASON_KEY);
    if (value === "auto" || SEASONS[value]) return value;
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

export function seasonAdjust(distance, seasonId) {
  let meta = SEASONS[seasonId] || SEASONS.otoño;
  let meters = Math.round((Number(distance) || 0) * meta.factor);
  return { id: seasonId in SEASONS ? seasonId : "otoño", label: meta.label, meters, note: meta.note, factor: meta.factor };
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

function strategyCopy(strategy, club, name) {
  let n = who(name);
  let you = n ? `${n}, ` : "";
  if (!club) return `${you}no tienes un palo con distancia para este número. Declara un carry o registra golpes.`;
  if (strategy === "safe") return `${you}${club} es la opción holgada con las distancias que tienes guardadas. Si dudas entre dos palos, coge el de más y acepta quedarte corto.`;
  if (strategy === "aggressive") return `${you}${club} juega tu número. El margen es justo: si el golpe no te sale, baja a conservador.`;
  return `${you}${club} cubre el objetivo con tus propias distancias. Ni persigas la bandera ni dejes el palo corto a propósito.`;
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
  let mine = (shots || []).filter((s) => s.clubId === option.clubId);
  let swings = swingStats(mine);
  let swingBits = swings.map((s) => `${s.n} ${s.n === 1 ? "golpe" : "golpes"} de ${SWING[s.id]} (media ${s.mean} m)`);
  let body;
  if (option.used === "declared" || swings.length === 0) {
    body = `${hello}en ${option.title} no tengo golpes tuyos. Uso el carry habitual que declaraste${option.carry != null ? ` (${Math.round(option.carry)} m)` : ""}, no una media medida.`;
  } else {
    let spread = option.dispersion == null ? "" : option.quality === "sufficient" && option.dispersion <= 8 ? ` Te sale bastante junto (±${Math.round(option.dispersion)} m).` : option.dispersion >= 12 ? ` La distancia se te mueve (±${Math.round(option.dispersion)} m).` : ` Dispersión ±${Math.round(option.dispersion)} m.`;
    let sample = option.n != null && option.n < 5 ? " Es tu número, pero aún son pocos golpes." : "";
    body = `${hello}este ${option.title} sale de tus golpes: ${swingBits.join(", ")}.${spread}${sample}`;
  }
  let latest = mine.map((s) => s.recordedAt).filter(Boolean).sort().at(-1);
  if (latest) {
    let day = latest.slice(0, 10);
    let count = mine.filter((s) => String(s.recordedAt).slice(0, 10) === day).length;
    let nice = formatDay(latest);
    if (nice) body += ` Última tanda con este palo: ${nice} (${count} ${count === 1 ? "golpe" : "golpes"}).`;
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
  let season = seasonAdjust(query.distance, query.season || "otoño");
  let name = personal.playerName ?? query.playerName ?? "";
  let signed = season.meters > 0 ? `+${season.meters}` : String(season.meters);
  let seasonDetail = `${season.note} Regla: ${Math.round(season.factor * 100)}% (${signed} m sobre ${Math.round(Number(query.distance) || 0)} m).`;
  return {
    club,
    carry: top ? Math.round(top.carry) : null,
    side,
    sideLabel,
    sideDetail,
    strategy: query.strategy ?? "normal",
    strategyLabel: labels[query.strategy] ?? "Normal",
    strategyDetail: strategyCopy(query.strategy, club, name),
    personalLine: personalLine(name, top, personal.shots || []),
    season: season.id,
    seasonLabel: season.label,
    seasonSource: query.seasonSource === "manual" ? "manual" : "auto",
    seasonMeters: season.meters,
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
