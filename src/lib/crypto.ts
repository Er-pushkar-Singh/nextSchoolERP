import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/* AES-256-GCM for integration secrets. The key lives only in the app's environment:
   SETTINGS_ENCRYPTION_KEY = 32 random bytes, base64 (generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
   Stored format: v1.<iv>.<tag>.<ciphertext> (base64url). Losing the key means re-entering the secrets. */

function key(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) throw new Error("SETTINGS_ENCRYPTION_KEY is not set on the server — secrets can't be saved. Add it to the environment and redeploy.");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return k;
}

export const encryptionReady = () => {
  try { key(); return true; } catch { return false; }
};

export function encryptJson(value: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptJson(payload: string): Record<string, string> {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8"));
}

/** "••••a1b2" — enough to recognise a key, useless to anyone else. */
export const hint = (secret: string) => (secret.length <= 6 ? "••••" : `••••${secret.slice(-4)}`);
