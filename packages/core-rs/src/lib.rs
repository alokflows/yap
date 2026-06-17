//! Ripple end-to-end crypto — the Rust mirror of `packages/core/crypto.mjs`.
//!
//! The shared secret is the pairing code, nothing else. The relay stays a BLIND
//! pipe: clients route on a HASH of the code and exchange only sealed blobs, so
//! the relay never sees the raw code or any plaintext. Every peer that knows the
//! code derives the same key and the same room id — no key exchange, no accounts.
//!
//! This must stay byte-for-byte compatible with the JS module. The tests assert
//! the exact cross-language vectors from HANDOFF.md §4.

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

// App-wide KDF parameters — must match crypto.mjs exactly.
const KDF_SALT: &[u8] = b"yap.kdf.v1";
const KDF_ITERATIONS: u32 = 210_000;
const IV_BYTES: usize = 12; // AES-GCM standard nonce length

/// Normalize a code the same way everywhere: upper-case, strip non-alphanumerics.
pub fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// The relay routes on this — base64url(SHA-256(code)), never the code itself.
pub fn room_from_code(code: &str) -> String {
    let mut h = Sha256::new();
    h.update(normalize_code(code).as_bytes());
    URL_SAFE_NO_PAD.encode(h.finalize())
}

/// Derive the AES-256-GCM key from the code via PBKDF2-HMAC-SHA256.
pub fn key_from_code(code: &str) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(
        normalize_code(code).as_bytes(),
        KDF_SALT,
        KDF_ITERATIONS,
        &mut key,
    );
    key
}

fn cipher(key: &[u8; 32]) -> Aes256Gcm {
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key))
}

/// Encrypt plaintext → a compact base64url blob of (iv(12) || ciphertext+tag).
/// Uses a fresh random nonce every call (the production path).
pub fn seal(key: &[u8; 32], plaintext: &str) -> String {
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    seal_with_nonce(key, nonce.as_slice(), plaintext)
}

/// Seal with a caller-supplied nonce. Used by the cross-language test vector
/// (forced all-zero IV); production always uses [`seal`] with a random nonce.
pub fn seal_with_nonce(key: &[u8; 32], iv: &[u8], plaintext: &str) -> String {
    let ct = cipher(key)
        .encrypt(Nonce::from_slice(iv), plaintext.as_bytes())
        .expect("AES-GCM encryption never fails for valid inputs");
    let mut out = Vec::with_capacity(iv.len() + ct.len());
    out.extend_from_slice(iv);
    out.extend_from_slice(&ct);
    URL_SAFE_NO_PAD.encode(out)
}

/// Decrypt a blob from [`seal`]. Returns the plaintext, or `None` if the key is
/// wrong or the data was tampered with (GCM auth fails) — never panics.
pub fn unseal(key: &[u8; 32], blob: &str) -> Option<String> {
    let bytes = URL_SAFE_NO_PAD.decode(blob).ok()?;
    if bytes.len() < IV_BYTES {
        return None;
    }
    let (iv, ct) = bytes.split_at(IV_BYTES);
    let pt = cipher(key).decrypt(Nonce::from_slice(iv), ct).ok()?;
    String::from_utf8(pt).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_noise_and_upper_cases() {
        assert_eq!(normalize_code(" k7-qf 9p "), "K7QF9P");
    }

    // HANDOFF §4 vector: roomFromCode("K7QF9P").
    #[test]
    fn room_matches_js_vector() {
        assert_eq!(
            room_from_code("K7QF9P"),
            "m5y7nOTrj9TE1Pbh9LSBNGFqitACsWIlLsKk8cfTqjg"
        );
    }

    #[test]
    fn room_is_deterministic_and_normalized() {
        assert_eq!(room_from_code("k7qf9p"), room_from_code("K7QF9P"));
        assert_ne!(room_from_code("AAAAAA"), room_from_code("BBBBBB"));
    }

    // HANDOFF §4 vector: seal of "hello, cursor" with code K7QF9P and a forced
    // all-zero 12-byte IV. This is THE cross-language compatibility check.
    #[test]
    fn seal_matches_js_vector_with_zero_iv() {
        let key = key_from_code("K7QF9P");
        let blob = seal_with_nonce(&key, &[0u8; 12], "hello, cursor");
        assert_eq!(
            blob,
            "AAAAAAAAAAAAAAAAA8gVxDfIR9jOqUCwRBdsU7oecTFk-DiEAtrwkOY"
        );
    }

    #[test]
    fn round_trips_with_the_same_code() {
        let key = key_from_code("K7QF9P");
        let blob = seal(&key, "hello, cursor 👋");
        assert_eq!(unseal(&key, &blob).as_deref(), Some("hello, cursor 👋"));
    }

    #[test]
    fn wrong_code_cannot_decrypt() {
        let blob = seal(&key_from_code("K7QF9P"), "secret");
        assert_eq!(unseal(&key_from_code("WRONG1"), &blob), None);
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = key_from_code("K7QF9P");
        let mut blob = seal(&key, "do not change me");
        blob.pop();
        blob.push(if blob.ends_with('A') { 'B' } else { 'A' });
        assert_eq!(unseal(&key, &blob), None);
    }

    #[test]
    fn each_seal_uses_a_fresh_nonce() {
        let key = key_from_code("K7QF9P");
        assert_ne!(seal(&key, "same"), seal(&key, "same"));
    }
}
