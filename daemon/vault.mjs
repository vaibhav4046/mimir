import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Local AES-256-GCM encrypted Vault supporting Secrets, Logins, and Payment Cards.
 * Values remain masked on list queries and are automatically scrubbed if echoed in transcripts.
 */
export class VaultManager {
  constructor(dataDir, passphrase = null) {
    this.vaultPath = path.join(dataDir, 'vault.enc.json');
    this.key = this.#deriveKey(dataDir, passphrase);
    this.entries = this.#load();
  }

  #deriveKey(dataDir, passphrase) {
    // The 'grokbot-vault-v1' salt is part of the key: changing it would make existing vaults unreadable.
    const secretMaterial = passphrase || `${os.hostname()}|${os.userInfo().username}|${path.resolve(dataDir)}|grokbot-vault-v1`;
    const salt = crypto.createHash('sha256').update(path.resolve(dataDir)).digest();
    return crypto.scryptSync(secretMaterial, salt, 32);
  }

  #encrypt(obj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const pt = Buffer.from(JSON.stringify(obj), 'utf8');
    const enc = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: enc.toString('base64'),
    };
  }

  #decrypt(envelope) {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(envelope.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(dec.toString('utf8'));
  }

  #load() {
    if (!fs.existsSync(this.vaultPath)) {
      const initial = [];
      this.#save(initial);
      return initial;
    }
    try {
      const env = JSON.parse(fs.readFileSync(this.vaultPath, 'utf8'));
      const data = this.#decrypt(env);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  #save(entries = this.entries) {
    const tmp = `${this.vaultPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.#encrypt(entries), null, 2), 'utf8');
    fs.renameSync(tmp, this.vaultPath);
  }

  #maskEntry(entry) {
    if (entry.kind === 'card') {
      const num = String(entry.fields?.number || '').replace(/\s+/g, '');
      const last4 = num.slice(-4) || '••••';
      return {
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        preview: `${entry.fields?.brand || 'Card'} •••• ${last4} (exp ${entry.fields?.exp || '--/--'})`,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    }
    if (entry.kind === 'login') {
      return {
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        preview: `${entry.fields?.username || 'user'} @ ${entry.fields?.url || 'site'}`,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    }
    const val = String(entry.fields?.value || '');
    return {
      id: entry.id,
      kind: 'secret',
      label: entry.label,
      preview: val.length > 4 ? `${'•'.repeat(Math.min(10, val.length - 4))}${val.slice(-4)}` : '••••',
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  listMasked() {
    return this.entries.map(e => this.#maskEntry(e));
  }

  addEntry({ kind = 'secret', label, fields = {} }) {
    if (!label || !String(label).trim()) {
      throw new Error('Vault label is required');
    }
    const now = new Date().toISOString();
    const entry = {
      id: `vlt-${crypto.randomBytes(5).toString('hex')}`,
      kind: ['secret', 'login', 'card'].includes(kind) ? kind : 'secret',
      label: String(label).trim(),
      fields,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.push(entry);
    this.#save();
    return this.#maskEntry(entry);
  }

  deleteEntry(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => e.id !== id);
    if (this.entries.length !== before) {
      this.#save();
      return true;
    }
    return false;
  }

  resolveSecret(labelOrId) {
    const q = String(labelOrId || '').trim().toLowerCase();
    const found = this.entries.find(e => e.id.toLowerCase() === q || e.label.toLowerCase() === q);
    if (!found) return null;
    return found;
  }

  /** Scrub any stored raw secret values before logging or returning text to UI/chat. */
  redactText(text) {
    if (typeof text !== 'string' || !text) return text;
    let out = text;
    for (const entry of this.entries) {
      const candidates = Object.values(entry.fields || {})
        .filter(v => typeof v === 'string' && v.trim().length >= 5);
      for (const secret of candidates) {
        if (out.includes(secret)) {
          out = out.split(secret).join(`[REDACTED:vault:${entry.label}]`);
        }
      }
    }
    return out;
  }
}
