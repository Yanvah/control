import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { getEnv } from "@/lib/env";

const KEY_VERSION = 1;

export type EncryptedSecret = {
  encryptedSecret: string;
  secretIv: string;
  secretAuthTag: string;
  encryptionKeyVersion: number;
};

function encryptionKey(): Buffer {
  return Buffer.from(getEnv().CONTROL_ENCRYPTION_KEY, "base64");
}

function associatedData(
  productId: string,
  keyId: string,
  version: number,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "yanvah-control-product-secret",
      productId,
      keyId,
      version,
    ]),
    "utf8",
  );
}

export function encryptProductSecret(
  secret: string,
  productId: string,
  keyId: string,
): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(associatedData(productId, keyId, KEY_VERSION));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    encryptedSecret: ciphertext.toString("base64"),
    secretIv: iv.toString("base64"),
    secretAuthTag: cipher.getAuthTag().toString("base64"),
    encryptionKeyVersion: KEY_VERSION,
  };
}

export function decryptProductSecret(
  record: EncryptedSecret,
  productId: string,
  keyId: string,
): string {
  try {
    if (record.encryptionKeyVersion !== KEY_VERSION) throw new Error();
    const iv = Buffer.from(record.secretIv, "base64");
    const tag = Buffer.from(record.secretAuthTag, "base64");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAAD(
      associatedData(productId, keyId, record.encryptionKeyVersion),
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(record.encryptedSecret, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Product credential is unavailable.");
  }
}

export function productSecretFingerprint(secret: string): string {
  // A keyed fingerprint enforces independent credentials without storing a public
  // hash that permits offline guessing independently of the encryption key.
  return createHmac("sha256", encryptionKey())
    .update("yanvah-control-credential-fingerprint\0")
    .update(secret, "utf8")
    .digest("hex");
}
