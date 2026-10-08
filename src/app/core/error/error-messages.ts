export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e.trim() || fallback;
  if (e instanceof Error) return e.message.trim() || fallback;
  if (e && typeof e === 'object' && 'message' in e) {
    const message = String((e as { message: unknown }).message).trim();
    if (message) return message;
  }
  if (e === null || e === undefined) return fallback;
  const text = String(e).trim();
  return text && text !== '[object Object]' ? text : fallback;
}
