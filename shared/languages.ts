// Known languages with sensible defaults. Any other language can still be
// added by hand: only a name, an ISO 639-1 code and a BCP-47 locale are needed.

export interface CatalogLanguage {
  name: string;
  code: string; // ISO 639-1, used by Gutenberg, Wiktionary, translation and STT APIs
  locale: string; // BCP-47, used by text-to-speech, speech recognition and Intl
  rtl?: boolean;
  // Languages that capitalise common nouns (German) must not auto-exclude
  // capitalised words as proper nouns.
  capitalizedNouns?: boolean;
}

export const LANGUAGE_CATALOG: CatalogLanguage[] = [
  { name: 'Afrikaans', code: 'af', locale: 'af-ZA' },
  { name: 'Arabic', code: 'ar', locale: 'ar-SA', rtl: true },
  { name: 'Bulgarian', code: 'bg', locale: 'bg-BG' },
  { name: 'Catalan', code: 'ca', locale: 'ca-ES' },
  { name: 'Chinese', code: 'zh', locale: 'zh-CN' },
  { name: 'Croatian', code: 'hr', locale: 'hr-HR' },
  { name: 'Czech', code: 'cs', locale: 'cs-CZ' },
  { name: 'Danish', code: 'da', locale: 'da-DK' },
  { name: 'Dutch', code: 'nl', locale: 'nl-NL' },
  { name: 'Esperanto', code: 'eo', locale: 'eo' },
  { name: 'Estonian', code: 'et', locale: 'et-EE' },
  { name: 'Finnish', code: 'fi', locale: 'fi-FI' },
  { name: 'French', code: 'fr', locale: 'fr-FR' },
  { name: 'German', code: 'de', locale: 'de-DE', capitalizedNouns: true },
  { name: 'Greek', code: 'el', locale: 'el-GR' },
  { name: 'Hebrew', code: 'he', locale: 'he-IL', rtl: true },
  { name: 'Hindi', code: 'hi', locale: 'hi-IN' },
  { name: 'Hungarian', code: 'hu', locale: 'hu-HU' },
  { name: 'Icelandic', code: 'is', locale: 'is-IS' },
  { name: 'Indonesian', code: 'id', locale: 'id-ID' },
  { name: 'Irish', code: 'ga', locale: 'ga-IE' },
  { name: 'Italian', code: 'it', locale: 'it-IT' },
  { name: 'Japanese', code: 'ja', locale: 'ja-JP' },
  { name: 'Korean', code: 'ko', locale: 'ko-KR' },
  { name: 'Latin', code: 'la', locale: 'la' },
  { name: 'Latvian', code: 'lv', locale: 'lv-LV' },
  { name: 'Lithuanian', code: 'lt', locale: 'lt-LT' },
  { name: 'Norwegian', code: 'no', locale: 'nb-NO' },
  { name: 'Persian', code: 'fa', locale: 'fa-IR', rtl: true },
  { name: 'Polish', code: 'pl', locale: 'pl-PL' },
  { name: 'Portuguese', code: 'pt', locale: 'pt-BR' },
  { name: 'Romanian', code: 'ro', locale: 'ro-RO' },
  { name: 'Russian', code: 'ru', locale: 'ru-RU' },
  { name: 'Serbian', code: 'sr', locale: 'sr-RS' },
  { name: 'Slovak', code: 'sk', locale: 'sk-SK' },
  { name: 'Slovenian', code: 'sl', locale: 'sl-SI' },
  { name: 'Spanish', code: 'es', locale: 'es-ES' },
  { name: 'Swahili', code: 'sw', locale: 'sw-KE' },
  { name: 'Swedish', code: 'sv', locale: 'sv-SE' },
  { name: 'Tagalog', code: 'tl', locale: 'fil-PH' },
  { name: 'Thai', code: 'th', locale: 'th-TH' },
  { name: 'Turkish', code: 'tr', locale: 'tr-TR' },
  { name: 'Ukrainian', code: 'uk', locale: 'uk-UA' },
  { name: 'Urdu', code: 'ur', locale: 'ur-PK', rtl: true },
  { name: 'Vietnamese', code: 'vi', locale: 'vi-VN' },
  { name: 'Welsh', code: 'cy', locale: 'cy-GB' },
];

export function findCatalogLanguage(nameOrCode: string): CatalogLanguage | undefined {
  const needle = nameOrCode.trim().toLowerCase();
  return LANGUAGE_CATALOG.find(
    (language) => language.name.toLowerCase() === needle || language.code === needle
  );
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
