export type ChatRole = "user" | "assistant"
export interface ChatTurn { role:ChatRole; content:string }

const env = import.meta.env
const API_KEY = (env.VITE_GEMINI_API_KEY ?? "").trim()
const MODEL   = (env.VITE_GEMINI_MODEL ?? "gemini-2.5-flash").trim()
const PROXY   = (env.VITE_LLM_PROXY_URL ?? "").trim()
const MAX_TOKENS  = Number(env.VITE_LLM_MAX_TOKENS ?? 500)
const TEMPERATURE = Number(env.VITE_LLM_TEMPERATURE ?? 0.4)

/** True when the assistant can actually reach the model. */
export const llmConfigured = (): boolean => !!PROXY || !!API_KEY

export class LlmError extends Error {}

const sleep = (ms:number) => new Promise(r=>setTimeout(r, ms))

/**
 * Sends `system` as Gemini's systemInstruction and `turns` as the conversation,
 * newest message last. The system prompt is never mixed into the user turns.
 * Retries twice on 429 — the free tier allows only a handful of requests/minute.
 */
export async function askAcsend(system:string, turns:ChatTurn[], signal?:AbortSignal): Promise<string> {
  if (!llmConfigured()) {
    throw new LlmError("No Gemini API key set. Add VITE_GEMINI_API_KEY to .env and restart the dev server.")
  }
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return PROXY ? await viaProxy(system, turns, signal) : await viaGemini(system, turns, signal)
    } catch (e:any) {
      if (e?.name === "AbortError") throw e
      lastErr = e
      if (e instanceof LlmError && e.message.startsWith("Rate limited") && attempt < 2) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      throw e
    }
  }
  throw lastErr
}

async function viaProxy(system:string, turns:ChatTurn[], signal?:AbortSignal) {
  const r = await fetch(PROXY, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ system, messages:turns, max_tokens:MAX_TOKENS, temperature:TEMPERATURE }),
    signal,
  })
  if (!r.ok) throw new LlmError(`Proxy returned ${r.status}.`)
  const d = await r.json()
  const text = d.text ?? d.content ?? d.reply
  if (!text) throw new LlmError("Proxy response had no text field.")
  return String(text).trim()
}

async function viaGemini(system:string, turns:ChatTurn[], signal?:AbortSignal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
  const r = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-goog-api-key":API_KEY },
    body: JSON.stringify({
      systemInstruction:{ parts:[{ text:system }] },   // system prompt, its own field
      contents: turns.map(t=>({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }],
      })),
      generationConfig:{ maxOutputTokens:MAX_TOKENS, temperature:TEMPERATURE },
    }),
    signal,
  })

  if (!r.ok) throw new LlmError(await describe(r))

  const d = await r.json()
  const cand = d.candidates?.[0]
  if (cand?.finishReason === "SAFETY") {
    throw new LlmError("Gemini blocked that response. Try rephrasing the question.")
  }
  const text = (cand?.content?.parts ?? []).map((p:any)=>p.text ?? "").join("").trim()
  if (!text) throw new LlmError("Gemini returned an empty response.")
  return text
}

async function describe(r:Response) {
  let detail = ""
  try {
    const j = await r.json()
    detail = j?.error?.message ?? JSON.stringify(j).slice(0,200)
  } catch { /* body was not JSON */ }

  if (r.status === 429) return `Rate limited — the free tier allows only a few requests per minute. ${detail}`
  if (r.status === 400 && /API key/i.test(detail)) return `Invalid API key. Check VITE_GEMINI_API_KEY in .env. ${detail}`
  if (r.status === 400) return `Bad request — usually a wrong model name. Current: "${MODEL}". ${detail}`
  if (r.status === 403) return `Access denied (403) — the key may not be enabled for the Gemini API. ${detail}`
  if (r.status === 404) return `Model "${MODEL}" not found. Check VITE_GEMINI_MODEL. ${detail}`
  return `Request failed (${r.status}). ${detail}`
}
