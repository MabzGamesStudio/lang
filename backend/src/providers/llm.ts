import { HttpError } from '../db/connection.js';
import { getSettings } from '../services/settings.js';
import { postJson } from '../services/http.js';
import type { AppSettings } from '../../../shared/types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function colabBaseUrl(settings: AppSettings): string {
  const url = settings.colab.url.trim().replace(/\/+$/, '');
  if (!url) throw new HttpError(400, 'Paste the URL printed by the Google Colab notebook in Configuration → Services first.');
  return url.endsWith('/v1') ? url : `${url}/v1`;
}

export function llmAvailable(settings = getSettings()): boolean {
  switch (settings.llm.provider) {
    case 'colab':
      return Boolean(settings.colab.url.trim());
    case 'openai':
      return Boolean(settings.llm.openai.baseUrl.trim() && settings.llm.openai.model.trim());
    case 'anthropic':
      return Boolean(settings.llm.anthropic.apiKey.trim());
    default:
      return false;
  }
}

export function llmLabel(settings = getSettings()): string {
  switch (settings.llm.provider) {
    case 'colab':
      return `llm:colab:${settings.colab.model}`;
    case 'openai':
      return `llm:${settings.llm.openai.model}`;
    case 'anthropic':
      return `llm:${settings.llm.anthropic.model}`;
    default:
      return 'llm';
  }
}

interface OpenAiResponse {
  choices: { message: { content: string | null } }[];
}

interface AnthropicResponse {
  content: { type: string; text?: string }[];
}

export async function chat(messages: ChatMessage[], options: { temperature?: number } = {}): Promise<string> {
  const settings = getSettings();
  const provider = settings.llm.provider;
  if (provider === 'none' || !llmAvailable(settings)) {
    throw new HttpError(400, 'No LLM is configured. Choose Google Colab, an OpenAI-compatible API or Anthropic in Configuration → Services.');
  }
  if (provider === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const response = await postJson<AnthropicResponse>(
      'https://api.anthropic.com/v1/messages',
      {
        model: settings.llm.anthropic.model,
        max_tokens: 8192,
        ...(system ? { system } : {}),
        messages: messages.filter((m) => m.role !== 'system'),
      },
      { 'x-api-key': settings.llm.anthropic.apiKey, 'anthropic-version': '2023-06-01' }
    );
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
  }
  const base = provider === 'colab' ? colabBaseUrl(settings) : settings.llm.openai.baseUrl.trim().replace(/\/+$/, '');
  const model = provider === 'colab' ? settings.colab.model : settings.llm.openai.model;
  const headers: Record<string, string> = {};
  if (provider === 'openai' && settings.llm.openai.apiKey) headers.Authorization = `Bearer ${settings.llm.openai.apiKey}`;
  const body: Record<string, unknown> = { model, messages };
  if (provider === 'colab') body.temperature = options.temperature ?? 0.2;
  const response = await postJson<OpenAiResponse>(`${base}/chat/completions`, body, headers, 300_000);
  return response.choices[0]?.message?.content ?? '';
}

// Extracts the JSON payload from a model answer (tolerates ```json fences,
// leading prose and trailing commas).
export function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('The model did not return JSON');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error('The model returned incomplete JSON');
  const candidate = body.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')) as T;
  }
}

// Accepts {"items": [...]}, a bare array, or any object holding one array.
export function extractItems<T>(text: string): T[] {
  const parsed = extractJson<unknown>(text);
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as T[];
    const firstArray = Object.values(record).find(Array.isArray);
    if (firstArray) return firstArray as T[];
  }
  throw new Error('The model returned JSON without a list of items');
}

export async function judgeTranslation(input: {
  languageName: string;
  direction: 'toEnglish' | 'toForeign';
  source: string;
  reference: string;
  answer: string;
}): Promise<{ correct: boolean; feedback: string }> {
  const from = input.direction === 'toEnglish' ? input.languageName : 'English';
  const to = input.direction === 'toEnglish' ? 'English' : input.languageName;
  const reply = await chat(
    [
      {
        role: 'system',
        content: 'You grade language learners. Be fair: accept any translation that keeps the full meaning, even if worded differently. Small typos are fine. Reject missing or wrong meaning.',
      },
      {
        role: 'user',
        content: `Source (${from}): ${input.source}\nReference translation (${to}): ${input.reference}\nLearner's translation (${to}): ${input.answer}\n\nIs the learner's translation acceptable? Reply only with JSON: {"correct": true|false, "feedback": "one short sentence"}`,
      },
    ],
    { temperature: 0 }
  );
  const parsed = extractJson<{ correct?: unknown; feedback?: unknown }>(reply);
  return { correct: parsed.correct === true, feedback: String(parsed.feedback ?? '') };
}
