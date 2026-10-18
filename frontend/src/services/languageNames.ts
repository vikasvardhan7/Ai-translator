function nameIn(locale: string, code: string): string | null {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

export function languageName(code: string): string {
  return nameIn('en', code) ?? code;
}

export function languageLabel(code: string): string {
  const english = languageName(code);
  const native = nameIn(code, code);
  return native && native.toLocaleLowerCase() !== english.toLocaleLowerCase()
    ? `${english} · ${native}`
    : english;
}
