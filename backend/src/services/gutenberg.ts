import { fetchJson, fetchText } from './http.js';
import { cleanBookText, decodeEntities, htmlToText, looksLikeHtml } from './textProcessing.js';
import type { GutenbergBook } from '../../../shared/types.js';

interface GutendexBook {
  id: number;
  title: string;
  authors: { name: string }[];
  download_count: number;
  formats: Record<string, string>;
}

// Accepts any Project Gutenberg book page and returns its plain text URL.
export function resolveBookUrl(url: string): string {
  const trimmed = url.trim();
  const ebookPage = /^https?:\/\/(?:www\.)?gutenberg\.org\/ebooks\/(\d+)\/?(?:[?#].*)?$/i.exec(trimmed);
  if (ebookPage) return `https://www.gutenberg.org/cache/epub/${ebookPage[1]}/pg${ebookPage[1]}.txt`;
  return trimmed;
}

function pickTextFormat(formats: Record<string, string>): string | null {
  const entries = Object.entries(formats).filter(([, url]) => !url.endsWith('.zip'));
  const plain =
    entries.find(([type]) => type.startsWith('text/plain') && type.includes('utf-8')) ??
    entries.find(([type]) => type.startsWith('text/plain'));
  if (plain) return plain[1];
  const html = entries.find(([type]) => type.startsWith('text/html'));
  return html ? html[1] : null;
}

// Searches public-domain books in a language (via the Gutendex API), most
// downloaded first.
export async function searchGutenberg(
  code: string,
  query: string,
  page: number,
  importedUrls: Set<string>
): Promise<{ books: GutenbergBook[]; hasMore: boolean }> {
  const params = new URLSearchParams({ languages: code, sort: 'popular', copyright: 'false', page: String(page) });
  if (query.trim()) params.set('search', query.trim());
  const data = await fetchJson<{ next: string | null; results: GutendexBook[] }>(`https://gutendex.com/books?${params}`, {
    timeoutMs: 45_000,
  });
  const books = data.results.map((book) => {
    const textUrl = pickTextFormat(book.formats);
    return {
      id: book.id,
      title: book.title,
      authors: book.authors.map((author) => author.name),
      downloads: book.download_count,
      textUrl,
      imported: Boolean(textUrl && importedUrls.has(textUrl)) || importedUrls.has(resolveBookUrl(`https://www.gutenberg.org/ebooks/${book.id}`)),
    };
  });
  return { books, hasMore: Boolean(data.next) };
}

function guessTitle(raw: string, isHtml: boolean, url: string): string {
  const gutenbergTitle = /^Title:\s*(.+)$/m.exec(raw.slice(0, 5000));
  if (gutenbergTitle) return gutenbergTitle[1].trim();
  if (isHtml) {
    const htmlTitle = /<title[^>]*>([^<]+)<\/title>/i.exec(raw);
    if (htmlTitle) return decodeEntities(htmlTitle[1]).trim();
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch {
    return url;
  }
}

export async function downloadBook(url: string): Promise<{ title: string; text: string; url: string }> {
  const resolved = resolveBookUrl(url);
  const { text: raw, contentType } = await fetchText(resolved, { timeoutMs: 120_000 });
  const isHtml = looksLikeHtml(raw, contentType);
  const title = guessTitle(raw, isHtml, resolved);
  const text = cleanBookText(isHtml ? htmlToText(raw) : raw);
  return { title, text, url: resolved };
}
