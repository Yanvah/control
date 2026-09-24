import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./schema";

function validEnv(): Record<string, string> {
  return {
    NODE_ENV: "production",
    CONTROL_URL: "https://control.example.com",
    CONTROL_AUTH_SECRET: randomBytes(32).toString("base64"),
    CONTROL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    CONTROL_SETUP_TOKEN: randomBytes(32).toString("base64"),
    DATABASE_PATH: "/data/control.db",
  };
}

describe("startup configuration", () => {
  it("accepts explicit production configuration and normalizes a bare origin", () => {
    const input = validEnv();
    input.CONTROL_URL += "/";
    expect(parseEnv(input)).toMatchObject({
      CONTROL_URL: "https://control.example.com",
      CONTROL_ALLOW_HTTP_ENDPOINTS: false,
      CONTROL_ALLOW_PRIVATE_ENDPOINTS: false,
    });
  });

  it.each(["CONTROL_URL", "CONTROL_AUTH_SECRET", "CONTROL_ENCRYPTION_KEY"])(
    "fails closed without %s",
    (field) => {
      const input = validEnv();
      delete input[field];
      expect(() => parseEnv(input)).toThrow(field);
    },
  );

  it.each([
    ["CONTROL_URL", "http://control.example.com"],
    ["CONTROL_URL", "https://owner:password@control.example.com"],
    ["CONTROL_URL", "https://control.example.com/subpath"],
    ["CONTROL_URL", "https://control.example.com/?token=secret"],
    ["CONTROL_URL", "https://control.example.com/#fragment"],
    ["CONTROL_ENCRYPTION_KEY", "invalid-encryption-key"],
    ["CONTROL_AUTH_SECRET", "short"],
    ["CONTROL_SETUP_TOKEN", "short"],
    ["DATABASE_PATH", "/tmp/control.db"],
    ["DATABASE_PATH", "/data/../tmp/control.db"],
    ["DATABASE_PATH", "./data/control.db"],
    ["CONTROL_ALLOW_HTTP_ENDPOINTS", "true"],
    ["CONTROL_ALLOW_PRIVATE_ENDPOINTS", "yes"],
  ])("rejects unsafe %s", (field, value) => {
    expect(() => parseEnv({ ...validEnv(), [field]: value })).toThrow(field);
  });

  it("allows removal of the setup token after claiming, leaving state validation to startup", () => {
    const input = validEnv();
    delete input.CONTROL_SETUP_TOKEN;
    expect(parseEnv(input).CONTROL_SETUP_TOKEN).toBeUndefined();
  });

  it("limits development HTTP to loopback", () => {
    expect(
      parseEnv({
        ...validEnv(),
        NODE_ENV: "development",
        CONTROL_URL: "http://localhost:3000",
        DATABASE_PATH: "./.data/control.db",
      }).CONTROL_URL,
    ).toBe("http://localhost:3000");
    expect(() =>
      parseEnv({
        ...validEnv(),
        NODE_ENV: "development",
        CONTROL_URL: "http://192.168.1.2:3000",
      }),
    ).toThrow("CONTROL_URL");
  });

  it("never includes input secrets in errors", () => {
    const secret = "sensitive value that should never be reported";
    expect(() =>
      parseEnv({ ...validEnv(), CONTROL_AUTH_SECRET: secret }),
    ).toThrow("CONTROL_AUTH_SECRET");
    try {
      parseEnv({ ...validEnv(), CONTROL_AUTH_SECRET: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("rejects reusing one secret for different purposes", () => {
    const input = validEnv();
    input.CONTROL_SETUP_TOKEN = input.CONTROL_AUTH_SECRET;
    expect(() => parseEnv(input)).toThrow("CONTROL_AUTH_SECRET");
  });
});
