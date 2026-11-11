//UI texts: one language pack per file in ./locales, English is the reference
//a new language = a new locales/<code>.ts with every key of en.ts, plus one line in each list below
import { en, type Texts } from './locales/en';
import { hr } from './locales/hr';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { es } from './locales/es';
import { pt } from './locales/pt';
import { nl } from './locales/nl';
import { pl } from './locales/pl';
import { tr } from './locales/tr';
import { id } from './locales/id';
import { fil } from './locales/fil';

//name of each language in itself, in the order the settings list shows them
export const languages = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fil: 'Filipino',
  fr: 'Français',
  hr: 'Hrvatski',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  tr: 'Türkçe',
} as const;
export type Lang = keyof typeof languages;
export type TextKey = keyof Texts;
export type { Texts };

const all: Record<Lang, Texts> = { en, hr, de, fr, it, es, pt, nl, pl, tr, id, fil };

export function texts(lang: Lang): Texts {
  return all[lang] ?? en;
}

//browser language when we have it (tl = Tagalog, the base of Filipino), else English
export function defaultLang(): Lang {
  const code = (navigator.language ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  const lang = code === 'tl' ? 'fil' : code;
  return lang in all ? (lang as Lang) : 'en';
}
