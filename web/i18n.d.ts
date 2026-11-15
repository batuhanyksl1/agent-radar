export const MESSAGES: Record<string, Record<string, string>>
export const LANGUAGE_NAMES: Record<string, string>
export function pickLang(tag: string | undefined | null): string
export function tr(lang: string, key: string, params?: Record<string, string | number>): string
