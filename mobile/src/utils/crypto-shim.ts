/**
 * Polyfills crypto.subtle.digest and crypto.getRandomValues for Hermes engine
 * compatibility. Supabase JS SDK v2's PKCE flow (used for email confirmation
 * links, not just OAuth) needs both to generate a code verifier/challenge —
 * Hermes implements neither natively.
 *
 * Import BEFORE supabase client (in entry file — index.ts).
 */
import { getRandomValues as expoGetRandomValues } from 'expo-crypto';

// Pure-JS SHA-256 implementation (only handles the digest use case we need).
// Derived from the public-domain js-sha256 by Chen, Yi-Cyuan.

function sha256(message: Uint8Array): ArrayBuffer {
  // SHA-256 constants
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  // Initial hash values
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pre-processing: padding
  const msgLen = message.length;
  // 1 byte for 0x80, up to 8 bytes for length, plus alignment to 64 bytes
  const totalLen = ((msgLen + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(totalLen);
  padded.set(message);
  padded[msgLen] = 0x80;

  // Append length in bits as 64-bit big-endian
  const bitsHi = Math.floor(msgLen / 0x20000000);
  const bitsLo = msgLen << 3;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, bitsHi, false);
  view.setUint32(totalLen - 4, bitsLo, false);

  // Process 64-byte blocks
  const W = new Uint32Array(64);
  for (let i = 0; i < totalLen; i += 64) {
    // Prepare message schedule
    for (let t = 0; t < 16; t++) {
      W[t] = (padded[i + t * 4] << 24) |
             (padded[i + t * 4 + 1] << 16) |
             (padded[i + t * 4 + 2] << 8) |
             padded[i + t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = (rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3));
      const s1 = (rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10));
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }

    // Working variables
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];

    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  // Convert to ArrayBuffer
  const result = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    result[i * 4] = (H[i] >>> 24) & 0xff;
    result[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    result[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    result[i * 4 + 3] = H[i] & 0xff;
  }
  return result.buffer;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

// Install the polyfill
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {};
}

if (!globalThis.crypto.getRandomValues) {
  (globalThis.crypto as any).getRandomValues = expoGetRandomValues;
}

if (!(globalThis.crypto as any).subtle) {
  (globalThis.crypto as any).subtle = {
    digest: async (algorithm: string, data: BufferSource): Promise<ArrayBuffer> => {
      if (algorithm !== 'SHA-256') {
        throw new Error(`crypto-shim: unsupported algorithm "${algorithm}"`);
      }
      // Convert BufferSource to Uint8Array
      let bytes: Uint8Array;
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (ArrayBuffer.isView(data)) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else {
        throw new Error('crypto-shim: unsupported BufferSource type');
      }
      return sha256(bytes);
    },
  } as SubtleCrypto;
}
