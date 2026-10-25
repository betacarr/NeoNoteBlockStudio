export function decodeMidiText(text: string): string {
  if ([...text].some(c => c.charCodeAt(0) > 255)) return text;
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { try { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); } catch { return text; } }
}
export const encodeMidiText = (text: string) => Array.from(new TextEncoder().encode(text), value => String.fromCharCode(value)).join('');
