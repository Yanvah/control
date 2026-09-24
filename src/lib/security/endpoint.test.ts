import { afterEach, describe, expect, test, vi } from "vitest";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import {
  EndpointError,
  resolveEndpoint,
  validateEndpoint,
  validateProductEndpoint,
  type EndpointPolicy,
} from "./endpoint";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const lookupAll: (
  hostname: string,
  options: LookupAllOptions,
) => Promise<LookupAddress[]> = lookup;

const production: EndpointPolicy = {
  NODE_ENV: "production",
  CONTROL_ALLOW_HTTP_ENDPOINTS: false,
  CONTROL_ALLOW_PRIVATE_ENDPOINTS: false,
};
const privateNetwork: EndpointPolicy = {
  ...production,
  CONTROL_ALLOW_PRIVATE_ENDPOINTS: true,
};
const local: EndpointPolicy = {
  NODE_ENV: "test",
  CONTROL_ALLOW_HTTP_ENDPOINTS: true,
  CONTROL_ALLOW_PRIVATE_ENDPOINTS: true,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("endpoint policy", () => {
  test("canonicalizes supported URLs and preserves encoded signed path bytes", () => {
    expect(
      validateEndpoint(
        "HTTPS://Product.EXAMPLE:443/api/encoded%2Fpath",
        production,
      ),
    ).toBe("https://product.example/api/encoded%2Fpath");
    expect(validateEndpoint("https://8.8.8.8/control", production)).toBe(
      "https://8.8.8.8/control",
    );
    expect(
      validateEndpoint("https://[2606:4700:4700::1111]/control", production),
    ).toContain("2606:4700");
  });

  test.each([
    "ftp://product.example/control",
    "https://owner:secret@product.example/control",
    "https://owner@product.example/control",
    "https://product.example/control?token=secret",
    "https://product.example/control?",
    "https://product.example/control#fragment",
    "https://product.example/control#",
    "https://product.example./control",
    "https://product.example\\@127.0.0.1/",
    " https://product.example/control",
    "https://product.example/\ncontrol",
    "product.example/control",
  ])("rejects ambiguous, credential-bearing or unsupported URL %s", (url) => {
    expect(() => validateEndpoint(url, local)).toThrow(EndpointError);
  });

  test.each([
    "0.0.0.0",
    "0.1.2.3",
    "169.254.169.254",
    "169.254.1.1",
    "100.100.100.200",
    "168.63.129.16",
    "192.0.0.192",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "198.18.0.1",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "[::]",
    "[::ffff:127.0.0.1]",
    "[::ffff:169.254.169.254]",
    "[::ffff:a9fe:a9fe]",
    "[::7f00:1]",
    "[64:ff9b::a9fe:a9fe]",
    "[fe80::1]",
    "[febf::1]",
    "[ff02::1]",
    "[fd00:ec2::254]",
    "[fd20:ce::254]",
    "[FD20:00CE:0000:0000:0000:0000:0000:0254]",
    "[2001:db8::1]",
    "[2002:7f00:1::]",
    "[2001::1]",
    "[3fff::1]",
    "metadata.google.internal",
    "metadata",
    "metadata.goog",
    "instance-data.ec2.internal",
  ])(
    "always blocks metadata, reserved, or non-unicast destination %s",
    (host) => {
      expect(() => validateEndpoint(`https://${host}/control`, local)).toThrow(
        expect.objectContaining({ code: "UNSAFE_ENDPOINT" }),
      );
    },
  );

  test.each([
    "10.1.2.3",
    "172.16.1.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "100.127.255.254",
    "[fd7a:115c:a1e0::1]",
    "[fc00::1]",
  ])("private destination %s needs explicit opt-in", (host) => {
    expect(() => validateEndpoint(`https://${host}/`, production)).toThrow(
      expect.objectContaining({ code: "UNSAFE_ENDPOINT" }),
    );
    expect(validateEndpoint(`https://${host}/`, privateNetwork)).toContain(
      host,
    );
  });

  test.each(["fd20:ce::254", "FD20:00CE:0000:0000:0000:0000:0000:0254"])(
    "Google metadata %s stays blocked with production private-network opt-in",
    (address) => {
      expect(() =>
        validateEndpoint(
          `https://[${address}]/computeMetadata/v1`,
          privateNetwork,
        ),
      ).toThrow(expect.objectContaining({ code: "UNSAFE_ENDPOINT" }));
    },
  );

  test.each([
    "localhost",
    "127.0.0.1",
    "127.5.4.3",
    "[::1]",
    "2130706433",
    "0x7f000001",
    "0177.0.0.1",
  ])(
    "loopback form %s remains blocked in production and by default",
    (host) => {
      expect(() =>
        validateEndpoint(`https://${host}/`, privateNetwork),
      ).toThrow(expect.objectContaining({ code: "UNSAFE_ENDPOINT" }));
      expect(() =>
        validateEndpoint(`https://${host}/`, {
          ...local,
          CONTROL_ALLOW_PRIVATE_ENDPOINTS: false,
        }),
      ).toThrow();
      expect(validateEndpoint(`https://${host}/`, local)).toMatch(/^https:/);
    },
  );

  test("HTTP matches the SDK's exact loopback hosts and requires both local flags", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(
        validateEndpoint(`http://${host}:3001/api/control`, local),
      ).toContain(":3001/api/control");
      expect(() => validateEndpoint(`http://${host}/`, production)).toThrow();
      expect(() =>
        validateEndpoint(`http://${host}/`, {
          ...local,
          CONTROL_ALLOW_HTTP_ENDPOINTS: false,
        }),
      ).toThrow();
      expect(() =>
        validateEndpoint(`http://${host}/`, {
          ...local,
          CONTROL_ALLOW_PRIVATE_ENDPOINTS: false,
        }),
      ).toThrow();
    }
    for (const host of ["127.0.0.2", "192.168.1.1", "product.example"])
      expect(() => validateEndpoint(`http://${host}/`, local)).toThrow();
  });
});

describe("DNS validation", () => {
  test("validates every returned address and normalizes the saved endpoint", async () => {
    vi.mocked(lookupAll).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    await expect(
      validateProductEndpoint(
        "https://PRODUCT.example:443/control",
        production,
      ),
    ).resolves.toBe("https://product.example/control");
    expect(lookup).toHaveBeenCalledWith("product.example", {
      all: true,
      verbatim: true,
    });
  });

  test.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::ffff:127.0.0.1"])(
    "rejects mixed DNS answers containing %s",
    async (address) => {
      vi.mocked(lookupAll).mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address, family: address.includes(":") ? 6 : 4 },
      ]);
      await expect(
        resolveEndpoint(
          "https://product.example/control",
          undefined,
          production,
        ),
      ).rejects.toMatchObject({ code: "UNSAFE_ENDPOINT" });
    },
  );

  test("revalidates later resolutions and continues blocking metadata with private opt-in", async () => {
    vi.mocked(lookupAll)
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(
      resolveEndpoint(
        "https://product.example/control",
        undefined,
        privateNetwork,
      ),
    ).resolves.toMatchObject({ address: "8.8.8.8" });
    await expect(
      resolveEndpoint(
        "https://product.example/control",
        undefined,
        privateNetwork,
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_ENDPOINT" });
  });

  test.each(["fd20:ce::254", "FD20:00CE:0000:0000:0000:0000:0000:0254"])(
    "DNS cannot route a private endpoint to Google metadata %s",
    async (address) => {
      vi.mocked(lookupAll).mockResolvedValue([{ address, family: 6 }]);
      for (const policy of [local, privateNetwork]) {
        await expect(
          resolveEndpoint("https://product.example/control", undefined, policy),
        ).rejects.toMatchObject({ code: "UNSAFE_ENDPOINT" });
      }
    },
  );

  test.each(["8.8.8.8", "10.0.0.1", "fd00::1"])(
    "HTTP localhost resolution cannot send plaintext credentials to %s",
    async (address) => {
      vi.mocked(lookupAll).mockResolvedValue([
        { address, family: address.includes(":") ? 6 : 4 },
      ]);
      await expect(
        resolveEndpoint("http://localhost/control", undefined, local),
      ).rejects.toMatchObject({ code: "UNSAFE_ENDPOINT" });
    },
  );

  test("bounds slow DNS and sanitizes resolver failures", async () => {
    vi.mocked(lookupAll).mockRejectedValueOnce(
      new Error("sensitive resolver details"),
    );
    await expect(
      resolveEndpoint("https://product.example/control", undefined, production),
    ).rejects.toMatchObject({
      code: "ENDPOINT_UNAVAILABLE",
      message: "The product endpoint could not be reached.",
    });
    vi.useFakeTimers();
    vi.mocked(lookupAll).mockImplementation(() => new Promise(() => undefined));
    const pending = expect(
      resolveEndpoint("https://product.example/control", undefined, production),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(3_001);
    await pending;
  });

  test("cancels DNS work without allowing late answers to create a connection", async () => {
    vi.mocked(lookupAll).mockImplementation(() => new Promise(() => undefined));
    const abort = new AbortController();
    const pending = expect(
      resolveEndpoint(
        "https://product.example/control",
        abort.signal,
        production,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    abort.abort();
    await pending;
  });
});
