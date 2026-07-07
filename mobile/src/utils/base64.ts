const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode a base64 string to raw bytes without relying on atob/Buffer —
 * neither is reliably available in Hermes. Used to upload images picked
 * with `base64: true` directly to Supabase Storage, avoiding fetch().blob()
 * on local file URIs, which is known to be unreliable in React Native
 * (especially for content:// URIs on Android).
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  let buffer = 0;
  let bitsInBuffer = 0;

  for (let i = 0; i < clean.length; i++) {
    const value = CHARS.indexOf(clean[i]);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bitsInBuffer += 6;
    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      bytes[byteIndex++] = (buffer >> bitsInBuffer) & 0xff;
    }
  }

  return bytes;
}
