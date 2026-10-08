import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';

// Outbound HTTP for book downloads and service APIs. Honours HTTP(S)_PROXY /
// NO_PROXY when they are set so the app also works behind corporate proxies.
const proxyConfigured = Boolean(
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
);
const dispatcher = proxyConfigured ? new EnvHttpProxyAgent() : undefined;

// fetch() that goes through the configured proxy (for libraries that accept a
// custom fetch, such as the Hugging Face client).
export const proxyFetch: typeof fetch = (input, init) =>
  dispatcher
    ? (undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>)
    : fetch(input, init);

export const USER_AGENT = 'lang-learning-app/2.0 (local desktop app; https://github.com/mabzgamesstudio/lang)';

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
}

export async function httpFetch(url: string, options: HttpOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const init = {
      method: options.method ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, ...options.headers },
      body: options.body,
      signal: controller.signal,
    };
    if (dispatcher) {
      return (await undiciFetch(url, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
    }
    return await fetch(url, init as RequestInit);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Request to ${new URL(url).host} timed out`);
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code || cause?.message || (error as Error).message;
    throw new Error(`Could not reach ${new URL(url).host} (${detail}). Check the internet connection or proxy.`);
  } finally {
    clearTimeout(timer);
  }
}

async function failure(response: Response): Promise<Error> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    detail = '';
  }
  return new Error(`${response.status} ${response.statusText} from ${new URL(response.url).host}${detail ? `: ${detail}` : ''}`);
}

export async function fetchJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const response = await httpFetch(url, options);
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export async function fetchText(url: string, options: HttpOptions = {}): Promise<{ text: string; contentType: string }> {
  const response = await httpFetch(url, options);
  if (!response.ok) throw await failure(response);
  const buffer = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? '';
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  let text: string;
  try {
    text = new TextDecoder(charset && charset !== 'utf8' ? charset : 'utf-8', { fatal: !charset }).decode(buffer);
  } catch {
    // Old Gutenberg files are sometimes Latin-1 without declaring it.
    text = new TextDecoder('latin1').decode(buffer);
  }
  return { text, contentType };
}

export async function fetchBytes(url: string, options: HttpOptions = {}): Promise<{ data: Buffer; contentType: string }> {
  const response = await httpFetch(url, options);
  if (!response.ok) throw await failure(response);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 180_000): Promise<T> {
  const response = await httpFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    timeoutMs,
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export async function postForBytes(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ data: Buffer; contentType: string }> {
  const response = await httpFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    timeoutMs: 120_000,
  });
  if (!response.ok) throw await failure(response);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
  };
}
