import { describe, expect, it } from "vitest";
import { securityHeaders } from "./headers";

describe("browser security policy", () => {
  it("requires a script nonce in production and prevents framing", () => {
    const headers = securityHeaders("test-nonce", false, true);
    const scriptPolicy = headers["Content-Security-Policy"]
      .split(";")
      .find((rule) => rule.trim().startsWith("script-src"));
    expect(scriptPolicy).toContain("'nonce-test-nonce'");
    expect(scriptPolicy).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(headers["Cache-Control"]).toBe("no-store");
  });

  it("does not force HTTPS on loopback development", () => {
    const headers = securityHeaders("test-nonce", true, false);
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).not.toContain(
      "upgrade-insecure-requests",
    );
    expect(headers["Content-Security-Policy"]).toContain("'unsafe-eval'");
  });
});
