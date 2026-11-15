use crate::error::{MimirError, Result};
use argon2::Argon2;
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEntry {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub fields: BTreeMap<String, String>,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaskedVaultEntry {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub masked_fields: BTreeMap<String, String>,
    pub updated_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedVaultFile {
    version: u8,
    cipher: String,
    salt_hex: String,
    nonce_hex: String,
    ciphertext_hex: String,
}

pub fn mask_secret(value: &str) -> String {
    let len = value.chars().count();
    if len <= 4 {
        return "*".repeat(len.max(4));
    }
    let tail: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("••••{tail}")
}

fn derive_key(passphrase: &str, salt: &[u8; 32]) -> Result<Zeroizing<[u8; 32]>> {
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|e| MimirError::Vault(format!("key derivation failed: {e}")))?;
    Ok(key)
}

pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in ab.iter().zip(bb.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn redact_tokens_and_secrets(text: &str, known_secrets: &[String]) -> String {
    let mut out = text.to_string();
    for secret in known_secrets {
        if secret.len() >= 6 && out.contains(secret) {
            let mut hasher = Sha256::new();
            hasher.update(secret.as_bytes());
            let tag = hex::encode(hasher.finalize());
            let short_tag = &tag[..8];
            out = out.replace(secret, &format!("[REDACTED:vault:{short_tag}]"));
        }
    }

    for prefix in [
        "sk-ant-",
        "sk-proj-",
        "sk-",
        "AIza",
        "ghp_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
    ] {
        out = mask_prefixed_token(&out, prefix);
    }

    out = mask_bearer_headers(&out);
    out
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.'
}

fn mask_prefixed_token(input: &str, prefix: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(pos) = input[cursor..].find(prefix) {
        let abs = cursor + pos;
        result.push_str(&input[cursor..abs]);
        let after_prefix = abs + prefix.len();
        let tail_len: usize = input[after_prefix..]
            .chars()
            .take_while(|&c| is_token_char(c))
            .map(char::len_utf8)
            .sum();
        if tail_len >= 8 {
            result.push_str(prefix);
            result.push_str("[REDACTED]");
            cursor = after_prefix + tail_len;
        } else {
            result.push_str(prefix);
            cursor = after_prefix;
        }
    }
    result.push_str(&input[cursor..]);
    result
}

fn mask_bearer_headers(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let needle = "bearer ";
    let mut cursor = 0;
    while let Some(pos) = lower[cursor..].find(needle) {
        let abs = cursor + pos;
        result.push_str(&input[cursor..abs]);
        result.push_str(&input[abs..abs + needle.len()]);
        let after = abs + needle.len();
        let tok_len: usize = input[after..]
            .chars()
            .take_while(|&c| is_token_char(c))
            .map(char::len_utf8)
            .sum();
        if tok_len >= 8 {
            result.push_str("[REDACTED]");
            cursor = after + tok_len;
        } else {
            cursor = after;
        }
    }
    result.push_str(&input[cursor..]);
    result
}

pub struct RustVault {
    file_path: PathBuf,
    passphrase: Zeroizing<String>,
    entries: Vec<VaultEntry>,
}

impl RustVault {
    pub fn open(file_path: impl AsRef<Path>, passphrase: impl Into<String>) -> Result<Self> {
        let path = file_path.as_ref().to_path_buf();
        let pass = Zeroizing::new(passphrase.into());
        if pass.is_empty() {
            return Err(MimirError::Vault(
                "vault passphrase must not be empty".to_string(),
            ));
        }

        let mut vault = Self {
            file_path: path,
            passphrase: pass,
            entries: Vec::new(),
        };
        if vault.file_path.exists() {
            vault.load()?;
        } else {
            vault.save()?;
        }
        Ok(vault)
    }

    fn load(&mut self) -> Result<()> {
        let raw = fs::read_to_string(&self.file_path)?;
        let file: EncryptedVaultFile = serde_json::from_str(&raw)
            .map_err(|e| MimirError::Vault(format!("corrupt vault envelope: {e}")))?;

        let salt_bytes = hex::decode(&file.salt_hex)
            .map_err(|e| MimirError::Vault(format!("invalid salt hex: {e}")))?;
        let salt: [u8; 32] = salt_bytes
            .try_into()
            .map_err(|_| MimirError::Vault("salt must be 32 bytes".to_string()))?;

        let nonce_bytes = hex::decode(&file.nonce_hex)
            .map_err(|e| MimirError::Vault(format!("invalid nonce hex: {e}")))?;
        let nonce_arr: [u8; 12] = nonce_bytes
            .try_into()
            .map_err(|_| MimirError::Vault("nonce must be 12 bytes".to_string()))?;

        let ciphertext = hex::decode(&file.ciphertext_hex)
            .map_err(|e| MimirError::Vault(format!("invalid ciphertext hex: {e}")))?;

        let key = derive_key(&self.passphrase, &salt)?;
        let cipher = ChaCha20Poly1305::new_from_slice(key.as_ref())
            .map_err(|e| MimirError::Vault(format!("cipher init error: {e}")))?;
        let plaintext = cipher
            .decrypt(Nonce::from_slice(&nonce_arr), ciphertext.as_slice())
            .map_err(|_| MimirError::Vault("vault decryption failed (wrong passphrase or tampered data)".to_string()))?;

        let decoded: Vec<VaultEntry> = serde_json::from_slice(&plaintext)
            .map_err(|e| MimirError::Vault(format!("invalid vault payload JSON: {e}")))?;
        self.entries = decoded;
        Ok(())
    }

    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut salt = [0u8; 32];
        let mut nonce_arr = [0u8; 12];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce_arr);

        let key = derive_key(&self.passphrase, &salt)?;
        let cipher = ChaCha20Poly1305::new_from_slice(key.as_ref())
            .map_err(|e| MimirError::Vault(format!("cipher init error: {e}")))?;

        let plaintext = Zeroizing::new(
            serde_json::to_vec(&self.entries)
                .map_err(|e| MimirError::Vault(format!("serialize failed: {e}")))?,
        );
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce_arr), plaintext.as_slice())
            .map_err(|e| MimirError::Vault(format!("encrypt failed: {e}")))?;

        let envelope = EncryptedVaultFile {
            version: 1,
            cipher: "chacha20-poly1305+argon2id".to_string(),
            salt_hex: hex::encode(salt),
            nonce_hex: hex::encode(nonce_arr),
            ciphertext_hex: hex::encode(ciphertext),
        };
        let encoded = serde_json::to_string_pretty(&envelope)
            .map_err(|e| MimirError::Vault(format!("envelope encode failed: {e}")))?;

        let tmp = self.file_path.with_extension("enc.tmp");
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(encoded.as_bytes())?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &self.file_path)?;
        Ok(())
    }

    pub fn set_entry(&mut self, entry: VaultEntry) -> Result<MaskedVaultEntry> {
        let masked = MaskedVaultEntry {
            id: entry.id.clone(),
            label: entry.label.clone(),
            kind: entry.kind.clone(),
            masked_fields: entry
                .fields
                .iter()
                .map(|(k, v)| (k.clone(), mask_secret(v)))
                .collect(),
            updated_at: entry.updated_at,
        };
        if let Some(slot) = self.entries.iter_mut().find(|e| e.id == entry.id) {
            *slot = entry;
        } else {
            self.entries.push(entry);
        }
        self.save()?;
        Ok(masked)
    }

    pub fn delete_entry(&mut self, id: &str) -> Result<bool> {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        let removed = self.entries.len() != before;
        if removed {
            self.save()?;
        }
        Ok(removed)
    }

    pub fn list_masked(&self) -> Vec<MaskedVaultEntry> {
        self.entries
            .iter()
            .map(|entry| MaskedVaultEntry {
                id: entry.id.clone(),
                label: entry.label.clone(),
                kind: entry.kind.clone(),
                masked_fields: entry
                    .fields
                    .iter()
                    .map(|(k, v)| (k.clone(), mask_secret(v)))
                    .collect(),
                updated_at: entry.updated_at,
            })
            .collect()
    }

    pub fn all_secret_values(&self) -> Vec<String> {
        let mut vals = Vec::new();
        for entry in &self.entries {
            for (k, v) in &entry.fields {
                if k != "username" && k != "email" && v.len() >= 6 {
                    vals.push(v.clone());
                }
            }
        }
        vals
    }

    pub fn resolve(&self, label_or_id: &str) -> Option<&VaultEntry> {
        self.entries
            .iter()
            .find(|e| e.id == label_or_id || e.label.eq_ignore_ascii_case(label_or_id))
    }

    pub fn redact_text(&self, text: &str) -> String {
        let secrets = self.all_secret_values();
        redact_tokens_and_secrets(text, &secrets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_roundtrip_and_tamper_detection() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("vault.enc");
        {
            let mut v = RustVault::open(&path, "strong-test-pass")?;
            let mut fields = BTreeMap::new();
            fields.insert("apiKey".to_string(), "sk-secret-value-123456".to_string());
            let masked = v.set_entry(VaultEntry {
                id: "k1".to_string(),
                label: "OpenAI".to_string(),
                kind: "api_key".to_string(),
                fields,
                updated_at: 100,
            })?;
            assert!(masked.masked_fields.get("apiKey").is_some_and(|s| s.ends_with("3456") && !s.contains("secret")));
        }

        let reopened = RustVault::open(&path, "strong-test-pass")?;
        let scrubbed = reopened.redact_text("leak check sk-secret-value-123456 and Bearer abcdef123456");
        assert!(!scrubbed.contains("sk-secret-value-123456"));
        assert!(!scrubbed.contains("abcdef123456"));
        assert!(reopened.resolve("OpenAI").is_some());

        let wrong_pass = RustVault::open(&path, "wrong-pass");
        assert!(wrong_pass.is_err());
        Ok(())
    }

    #[test]
    fn constant_time_check_works() {
        assert!(constant_time_eq("abc123", "abc123"));
        assert!(!constant_time_eq("abc123", "abc124"));
        assert!(!constant_time_eq("abc", "abcd"));
    }
}
