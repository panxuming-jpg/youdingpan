/**
 * 大模型接口（OpenAI 兼容 /chat/completions）
 * 环境变量：LLM_API_BASE（默认 DeepSeek）、LLM_API_KEY、LLM_MODEL
 * 未配置 KEY 时 chat() 返回 null，调用方必须走规则兜底（演示模式全链路可用）。
 */
const BASE = process.env.LLM_API_BASE || 'https://api.deepseek.com/v1';
const KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'deepseek-chat';

export const llmEnabled = !!KEY;

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number,maxTokens?:number,jsonMode?:boolean,timeoutMs?:number}} opts
 * @returns {Promise<string|null>} 模型输出文本；失败/未启用返回 null
 */
export async function chat(messages, { temperature = 0.3, maxTokens = 1024, jsonMode = false, timeoutMs = 15000 } = {}) {
  if (!KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = { model: MODEL, messages, temperature, max_tokens: maxTokens };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const res = await fetch(`${BASE.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[llm] HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return null;
    }
    const j = await res.json();
    return j?.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn('[llm] 调用失败:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 解析模型输出的 JSON（容忍 ```json 包裹） */
export function parseLLMJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* 尝试截取首个 {} */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}
