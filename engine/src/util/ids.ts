const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Random, URL-safe identifier with a readable prefix, e.g. `run_k3j9x0a1bz`. Works in Node and browsers. */
export function randomId(prefix: string, length = 10): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function randomHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
