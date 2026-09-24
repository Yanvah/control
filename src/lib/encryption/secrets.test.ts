import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

let key = randomBytes(32).toString("base64");
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ CONTROL_ENCRYPTION_KEY: key }),
}));

import {
  decryptProductSecret,
  encryptProductSecret,
  productSecretFingerprint,
} from "./secrets";

describe("authenticated product credential encryption", () => {
  it("round-trips literal UTF-8 with unique IVs and no plaintext fields", () => {
    const secret = `${randomBytes(32).toString("hex")} 日本語\n`;
    const first = encryptProductSecret(secret, "product-one", "credential-one");
    const second = encryptProductSecret(
      secret,
      "product-one",
      "credential-one",
    );
    expect(first.secretIv).not.toBe(second.secretIv);
    expect(first.encryptedSecret).not.toBe(second.encryptedSecret);
    expect(JSON.stringify(first)).not.toContain(secret);
    expect(decryptProductSecret(first, "product-one", "credential-one")).toBe(
      secret,
    );
    expect(first.encryptionKeyVersion).toBe(1);
    expect(Buffer.from(first.secretAuthTag, "base64")).toHaveLength(16);
  });

  it("rejects tampering, a moved credential, key-ID changes, unsupported versions, and wrong keys", () => {
    const secret = randomBytes(32).toString("hex");
    const record = encryptProductSecret(
      secret,
      "product-one",
      "credential-one",
    );
    const tampered = Buffer.from(record.encryptedSecret, "base64");
    tampered[0] ^= 1;
    for (const invalid of [
      { ...record, encryptedSecret: tampered.toString("base64") },
      { ...record, secretIv: randomBytes(12).toString("base64") },
      { ...record, secretAuthTag: randomBytes(16).toString("base64") },
      { ...record, encryptionKeyVersion: 2 },
    ])
      expect(() =>
        decryptProductSecret(invalid, "product-one", "credential-one"),
      ).toThrow("Product credential is unavailable.");
    expect(() =>
      decryptProductSecret(record, "product-two", "credential-one"),
    ).toThrow();
    expect(() =>
      decryptProductSecret(record, "product-one", "credential-two"),
    ).toThrow();
    const original = key;
    key = randomBytes(32).toString("base64");
    expect(() =>
      decryptProductSecret(record, "product-one", "credential-one"),
    ).toThrow();
    key = original;
  });

  it("uses a stable keyed credential fingerprint rather than a public hash", () => {
    const secret = randomBytes(32).toString("hex");
    const fingerprint = productSecretFingerprint(secret);
    expect(productSecretFingerprint(secret)).toBe(fingerprint);
    const original = key;
    key = randomBytes(32).toString("base64");
    expect(productSecretFingerprint(secret)).not.toBe(fingerprint);
    key = original;
  });
});
