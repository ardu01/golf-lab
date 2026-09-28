const STORAGE_KEY = "golf-lab-caddie-ai";
const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

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

function strategyCopy(strategy, club) {
  if (!club) return "No hay un palo con distancia para este número. Declara un carry o registra golpes.";
  if (strategy === "safe") return `${club} es la opción holgada. Si dudas entre dos palos, coge el de más y acepta quedarte corto.`;
  if (strategy === "aggressive") return `${club} juega el número. El margen es justo: si el golpe no te sale, baja a conservador.`;
  return `${club} cubre el objetivo ajustado con tus distancias. Ni persigas la bandera ni dejes el palo corto a propósito.`;
}

export function adviceFor(query, result) {
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
  return {
    club,
    carry: top ? Math.round(top.carry) : null,
    side,
    sideLabel,
    sideDetail,
    strategy: query.strategy ?? "normal",
    strategyLabel: labels[query.strategy] ?? "Normal",
    strategyDetail: strategyCopy(query.strategy, club),
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
