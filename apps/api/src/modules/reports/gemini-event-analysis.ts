import type { EventReportAiAnalysis, EventReportPayload } from "@gcba/shared";
import { env } from "../../config/env";

export function buildGeminiEventReportPrompt(data: EventReportPayload): string {
  const metrics = {
    eventName: data.eventName,
    eventStatus: data.eventStatus,
    eventDateLabel: data.eventDateLabel,
    eventRangeLabel: data.eventRangeLabel,
    location: data.location ?? "No informada",
    expectedPeople: data.expectedPeople,
    totalPeople: data.totalPeople,
    accreditedPeople: data.accreditedPeople,
    absentPeople: data.absentPeople,
    manualRegistrations: data.manualRegistrations,
    manualAccredited: data.manualAccredited,
    invalidRegistrations: data.invalidRegistrations,
    attendanceRate: data.attendanceRate,
    absenteeRate: data.absenteeRate,
    accreditationByHour: data.accreditationByHour,
    statusDistribution: data.statusDistribution,
    operationalTable: data.operationalTable
  };

  return `Actuá como analista de gestión de eventos y acreditaciones. Con base exclusivamente en los datos JSON siguientes, generá un análisis ejecutivo breve, profesional y accionable sobre el desempeño del evento. No inventes datos ni cifras que no aparezcan en el JSON. Si falta información para un punto, indicá que no se encuentra disponible en los datos provistos.

El análisis debe cubrir: resumen general, hallazgos principales, alertas operativas, recomendaciones y conclusión. Tono institucional y claro.

IMPORTANTE: Respondé únicamente con un objeto JSON válido (sin markdown, sin texto fuera del JSON) con esta forma exacta:
{
  "executiveSummary": "string",
  "keyFindings": ["string", "..."],
  "operationalAlerts": ["string", "..."],
  "recommendations": ["string", "..."],
  "conclusion": "string"
}

Datos del evento (JSON):
${JSON.stringify(metrics, null, 2)}`;
}

function stripJsonFence(text: string): string {
  const t = text.trim();
  const block = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/im.exec(t);
  if (block) return block[1].trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/im, "").trim();
  }
  return t;
}

/**
 * Extrae el primer objeto JSON balanceado (ignora texto previo o markdown).
 * Tolera llaves dentro de strings con comillas dobles escapadas de forma básica.
 */
export function extractBalancedJsonObject(text: string): string | null {
  const s = stripJsonFence(text).trim();
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"' && !escape) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Expuesto para tests: convierte texto del modelo en objeto de análisis. */
export function parseAnalysisPayload(raw: string): Record<string, unknown> {
  const cleaned = stripJsonFence(raw).trim();
  const attempts: string[] = [cleaned];
  const extracted = extractBalancedJsonObject(raw);
  if (extracted && extracted !== cleaned) attempts.push(extracted);

  let lastErr: unknown;
  for (const chunk of attempts) {
    try {
      const parsed = JSON.parse(chunk) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `No se pudo parsear JSON del análisis${lastErr instanceof Error ? `: ${lastErr.message}` : ""}`
  );
}

function collectCandidateText(body: {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}): { text: string; finishReason?: string } {
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  return { text, finishReason: candidate?.finishReason };
}

function buildAnalysisFromRecord(o: Record<string, unknown>): EventReportAiAnalysis {
  const executiveSummary = String(o.executiveSummary ?? "");
  const keyFindings = Array.isArray(o.keyFindings) ? o.keyFindings.map(String) : [];
  const operationalAlerts = Array.isArray(o.operationalAlerts) ? o.operationalAlerts.map(String) : [];
  const recommendations = Array.isArray(o.recommendations) ? o.recommendations.map(String) : [];
  const conclusion = String(o.conclusion ?? "");

  if (!executiveSummary && keyFindings.length === 0) {
    throw new Error("Análisis sin contenido útil");
  }

  return {
    executiveSummary,
    keyFindings,
    operationalAlerts,
    recommendations,
    conclusion
  };
}

async function geminiGenerateContent(
  url: string,
  model: string,
  prompt: string,
  useJsonMime: boolean
): Promise<{ text: string; finishReason?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 8192,
        ...(useJsonMime ? { responseMimeType: "application/json" as const } : {})
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(formatGeminiHttpError(res.status, errText, model));
  }

  const body = (await res.json()) as Parameters<typeof collectCandidateText>[0] & {
    promptFeedback?: { blockReason?: string };
  };

  if (!body.candidates?.length) {
    const br = body.promptFeedback?.blockReason;
    throw new Error(
      br
        ? `La solicitud fue bloqueada por políticas de la API (${br}).`
        : "Gemini no devolvió candidatos de texto. Revisá el modelo o el contenido del prompt."
    );
  }

  const { text, finishReason } = collectCandidateText(body);

  if (finishReason === "MAX_TOKENS") {
    throw new Error(
      "La respuesta del modelo se cortó por límite de tokens (MAX_TOKENS). Reintentá o reducí datos en el informe."
    );
  }
  if (finishReason && finishReason !== "STOP") {
    throw new Error(`Generación detenida (${finishReason}). Probá de nuevo o cambiá de modelo.`);
  }

  if (!text.trim()) {
    throw new Error("Respuesta vacía de Gemini (sin texto en candidates)");
  }

  return { text, finishReason };
}

/** Mensaje legible para el front; evita volcar JSON de Google. Incluye el modelo usado para depuración. */
export function formatGeminiHttpError(status: number, bodyText: string, model: string): string {
  const snippet = bodyText.slice(0, 1200);
  let googleMessage = "";
  try {
    const parsed = JSON.parse(snippet) as { error?: { message?: string; code?: number } };
    googleMessage = parsed.error?.message?.trim() ?? "";
  } catch {
    /* cuerpo no JSON */
  }

  if (status === 429) {
    return [
      "Se alcanzó el límite de cuota o de solicitudes de la API de Google (429).",
      `Modelo solicitado: «${model}».`,
      "En el plan gratuito los topes son bajos; a veces aparece «limit: 0» si la cuota diaria se agotó o el modelo exige facturación.",
      "Revisá límites y facturación: https://ai.google.dev/gemini-api/docs/rate-limits · Uso: https://ai.dev/rate-limit",
      googleMessage ? `Detalle: ${googleMessage.slice(0, 400)}` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (status === 400 || status === 404) {
    return `La API rechazó la solicitud (${status}) para el modelo «${model}». Verificá que el id del modelo exista en tu proyecto y región. ${googleMessage ? googleMessage.slice(0, 300) : ""}`;
  }

  if (status === 401 || status === 403) {
    return `Credenciales o permisos insuficientes (${status}) para la API de Gemini. Revisá GEMINI_API_KEY. ${googleMessage ? googleMessage.slice(0, 200) : ""}`;
  }

  if (googleMessage) {
    return `Gemini API (${status}): ${googleMessage.slice(0, 450)}`;
  }

  return `Gemini API respondió ${status}. Reintentá más tarde.`;
}

export async function runGeminiEventAnalysis(data: EventReportPayload): Promise<EventReportAiAnalysis> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("GEMINI_API_KEY no configurada");
  }

  const model = env.GEMINI_MODEL;
  const prompt = buildGeminiEventReportPrompt(data);
  const promptPlainJson = `${prompt}\n\nDevolvé únicamente un objeto JSON válido (sin markdown, sin texto antes ni después).`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const first = await geminiGenerateContent(url, model, prompt, true);

  try {
    return buildAnalysisFromRecord(parseAnalysisPayload(first.text));
  } catch (parseErr) {
    try {
      const second = await geminiGenerateContent(url, model, promptPlainJson, false);
      return buildAnalysisFromRecord(parseAnalysisPayload(second.text));
    } catch {
      const hint = parseErr instanceof Error ? parseErr.message : "parseo inválido";
      throw new Error(
        `No se pudo interpretar el JSON del modelo (Gemma a veces agrega texto extra). ${hint}. Reintentá con «Regenerar análisis IA».`
      );
    }
  }
}
