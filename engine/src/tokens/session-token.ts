import { base64UrlToBytes, base64UrlToString, bytesToBase64Url, stringToBase64Url, utf8ToBytes } from '../util/encoding.ts';
import type { DeviceProfile } from '../domain/types.ts';

/**
 * Synthetic session token carried by synthetic customers into the instrumented website.
 *
 * It is minted and signed (HMAC-SHA256) by the engine, read by the website SDK and verified
 * by the event collector. It binds every website event to a project, run, scenario,
 * synthetic customer and session — and tells the SDK where to route events — without the
 * website ever learning the signing secret.
 */
export interface SessionTokenPayload {
  v: 1;
  /** project id */
  p: string;
  /** run id */
  r: string;
  /** scenario id */
  s: string;
  /** synthetic customer id */
  c: string;
  /** session id */
  sid: string;
  /** expiry, unix ms */
  exp: number;
  /** collector endpoint: absolute URL, or "postmessage" for the browser-hosted engine */
  col: string;
  /** virtual clock offset in ms applied by the SDK to event timestamps */
  off: number;
  /** harness flags consumed by the SDK (test-only behaviours) */
  sdk?: { dedupe?: boolean; identify?: boolean; guard?: boolean };
  /** declared device characteristics (used when the host cannot emulate a real UA) */
  dev?: { kind: DeviceProfile['kind']; os: string; browser: string; ua: string; vw: number; vh: number };
}

export class SessionTokenService {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(
    private readonly secret: string,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
  ) {}

  private key(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = globalThis.crypto.subtle.importKey(
        'raw',
        utf8ToBytes(this.secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      );
    }
    return this.keyPromise;
  }

  async mint(payload: Omit<SessionTokenPayload, 'v' | 'exp'> & { exp?: number }): Promise<string> {
    const full: SessionTokenPayload = { v: 1, exp: payload.exp ?? Date.now() + this.ttlMs, ...payload };
    const body = stringToBase64Url(JSON.stringify(full));
    const sig = await globalThis.crypto.subtle.sign('HMAC', await this.key(), utf8ToBytes(body));
    return `${body}.${bytesToBase64Url(new Uint8Array(sig))}`;
  }

  async verify(token: string): Promise<SessionTokenPayload> {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) throw new TokenError('malformed_token', 'Token is not in body.signature form');
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      await this.key(),
      base64UrlToBytes(sig),
      utf8ToBytes(body),
    );
    if (!valid) throw new TokenError('invalid_signature', 'Token signature does not verify');
    let payload: SessionTokenPayload;
    try {
      payload = JSON.parse(base64UrlToString(body)) as SessionTokenPayload;
    } catch {
      throw new TokenError('malformed_token', 'Token body is not valid JSON');
    }
    if (payload.v !== 1) throw new TokenError('unsupported_version', `Unsupported token version ${payload.v}`);
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) throw new TokenError('expired', 'Token has expired');
    return payload;
  }

  /** Decode without verifying — for display/debugging only. */
  static peek(token: string): SessionTokenPayload | null {
    try {
      const body = token.slice(0, token.lastIndexOf('.'));
      return JSON.parse(base64UrlToString(body)) as SessionTokenPayload;
    } catch {
      return null;
    }
  }
}

export class TokenError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
