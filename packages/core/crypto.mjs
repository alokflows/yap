// Ripple end-to-end crypto — the shared secret is the pairing code, nothing else.
//
// Design goals:
//   * The relay must stay a BLIND pipe. It never sees the raw code and never
//     sees plaintext. So clients route on a HASH of the code and send only
//     sealed (encrypted) blobs.
//   * Every peer that knows the code derives the same key and the same room id,
//     with no key exchange and no accounts.
//
// This module is plain ESM and uses only the Web Crypto API (`crypto.subtle`),
// which behaves identically in modern browsers and in Node >= 20. That's what
// lets us unit-test it here and run the exact same code in the web app.
//
// Threat model honesty: a pairing code has limited entropy, so security rests
// on three things working together — (1) the relay can't see the code (room is
// hashed), (2) deriving the key is deliberately slow (PBKDF2, many iterations),
// which throttles offline guessing, and (3) codes should be strong (long /
// QR-carried). Short human codes remain the weak link; see docs/security.md.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// Fixed, app-wide KDF salt. A per-code salt would add nothing here: the code is
// the only secret and both sides must derive the same key with no exchange. The
// real cost to an attacker is the iteration count below, not the salt.
const KDF_SALT = enc.encode('yap.kdf.v1');
const KDF_ITERATIONS = 210_000;
const IV_BYTES = 12; // AES-GCM standard nonce length

// --- base64url, portable across browser and Node --------------------------
function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Normalize a code the same way everywhere, so "k7qf9p" and "K7QF9P" agree.
export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The relay routes on this — a SHA-256 of the code, never the code itself.
export async function roomFromCode(code) {
  const digest = await subtle.digest('SHA-256', enc.encode(normalizeCode(code)));
  return bytesToB64url(new Uint8Array(digest));
}

// Derive the AES-GCM key from the code. Returns a CryptoKey (non-extractable).
export async function keyFromCode(code) {
  const material = await subtle.importKey(
    'raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: KDF_SALT, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Encrypt plaintext → a compact base64url blob of (iv || ciphertext).
export async function seal(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToB64url(out);
}

// Decrypt a blob from seal(). Returns the plaintext, or null if the key is wrong
// or the data was tampered with (AES-GCM authentication fails) — never throws.
export async function unseal(key, blob) {
  try {
    const bytes = b64urlToBytes(blob);
    const iv = bytes.subarray(0, IV_BYTES);
    const ct = bytes.subarray(IV_BYTES);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  } catch {
    return null;
  }
}
