//! Sync Encryption
//!
//! Provides Argon2id-based key derivation and AES-256-GCM encryption for sync bundles.

use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::rngs::OsRng;
use ring::aead::{Aad, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM};
use ring::error::Unspecified;
use serde::{Deserialize, Serialize};

const NONCE_LEN: usize = 12;

/// Error type for encryption operations
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Key derivation failed: {0}")]
    KeyDerivation(String),
    #[error("Encryption failed")]
    Encryption,
    #[error("Decryption failed - wrong passphrase or corrupted data")]
    Decryption,
    #[error("Invalid data format")]
    InvalidFormat,
}

/// Encrypted bundle structure
#[derive(Serialize, Deserialize)]
pub struct EncryptedBundle {
    /// Salt used for key derivation (base64)
    pub salt: String,
    /// Nonce/IV used for encryption (base64)
    pub nonce: String,
    /// Encrypted data (base64)
    pub ciphertext: String,
}

/// Simple nonce sequence that uses a fixed nonce (for single-use encryption)
struct SingleNonce {
    nonce: Option<[u8; NONCE_LEN]>,
}

impl SingleNonce {
    fn new(nonce: [u8; NONCE_LEN]) -> Self {
        Self { nonce: Some(nonce) }
    }
}

impl NonceSequence for SingleNonce {
    fn advance(&mut self) -> Result<Nonce, Unspecified> {
        self.nonce
            .take()
            .map(|n| Nonce::assume_unique_for_key(n))
            .ok_or(Unspecified)
    }
}

/// Derive a 256-bit key from a passphrase using Argon2id
fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], CryptoError> {
    let argon2 = Argon2::default();

    // Create a salt string from the raw bytes
    let salt_string = SaltString::encode_b64(salt)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;

    // Hash the password
    let hash = argon2
        .hash_password(passphrase.as_bytes(), &salt_string)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;

    // Extract the hash output (32 bytes for AES-256)
    let hash_bytes = hash.hash.ok_or_else(|| {
        CryptoError::KeyDerivation("No hash output".to_string())
    })?;

    let mut key = [0u8; 32];
    let hash_slice = hash_bytes.as_bytes();
    let len = std::cmp::min(hash_slice.len(), 32);
    key[..len].copy_from_slice(&hash_slice[..len]);

    Ok(key)
}

/// Encrypt data with a passphrase
pub fn encrypt(data: &[u8], passphrase: &str) -> Result<EncryptedBundle, CryptoError> {
    // Generate random salt and nonce
    let salt = SaltString::generate(&mut OsRng);
    let salt_bytes = salt.as_str().as_bytes();

    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce_bytes).map_err(|_| CryptoError::Encryption)?;

    // Derive key
    let key_bytes = derive_key(passphrase, salt_bytes)?;

    // Create encryption key
    let unbound_key = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| CryptoError::Encryption)?;
    let mut sealing_key = SealingKey::new(unbound_key, SingleNonce::new(nonce_bytes));

    // Encrypt (in-place)
    let mut in_out = data.to_vec();
    sealing_key
        .seal_in_place_append_tag(Aad::empty(), &mut in_out)
        .map_err(|_| CryptoError::Encryption)?;

    Ok(EncryptedBundle {
        salt: BASE64.encode(salt_bytes),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(&in_out),
    })
}

/// Decrypt data with a passphrase
pub fn decrypt(bundle: &EncryptedBundle, passphrase: &str) -> Result<Vec<u8>, CryptoError> {
    // Decode base64
    let salt = BASE64.decode(&bundle.salt).map_err(|_| CryptoError::InvalidFormat)?;
    let nonce_bytes: [u8; NONCE_LEN] = BASE64
        .decode(&bundle.nonce)
        .map_err(|_| CryptoError::InvalidFormat)?
        .try_into()
        .map_err(|_| CryptoError::InvalidFormat)?;
    let mut ciphertext = BASE64.decode(&bundle.ciphertext).map_err(|_| CryptoError::InvalidFormat)?;

    // Derive key
    let key_bytes = derive_key(passphrase, &salt)?;

    // Create decryption key
    let unbound_key = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| CryptoError::Decryption)?;
    let mut opening_key = OpeningKey::new(unbound_key, SingleNonce::new(nonce_bytes));

    // Decrypt (in-place)
    let plaintext = opening_key
        .open_in_place(Aad::empty(), &mut ciphertext)
        .map_err(|_| CryptoError::Decryption)?;

    Ok(plaintext.to_vec())
}

// Re-export getrandom for nonce generation
mod getrandom {
    use rand::RngCore;

    pub fn fill(dest: &mut [u8]) -> Result<(), ()> {
        rand::rngs::OsRng.fill_bytes(dest);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let data = b"Hello, world! This is a test of the encryption system.";
        let passphrase = "test-passphrase-123";

        let encrypted = encrypt(data, passphrase).expect("Encryption failed");
        let decrypted = decrypt(&encrypted, passphrase).expect("Decryption failed");

        assert_eq!(data.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_wrong_passphrase_fails() {
        let data = b"Secret data";
        let passphrase = "correct-passphrase";
        let wrong_passphrase = "wrong-passphrase";

        let encrypted = encrypt(data, passphrase).expect("Encryption failed");
        let result = decrypt(&encrypted, wrong_passphrase);

        assert!(result.is_err());
    }
}
