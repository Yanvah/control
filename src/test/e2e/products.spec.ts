import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { test, expect } from "./fixtures";
import { serveTestProduct, type TestCredential } from "./sdk-product";

const generatedResult = z.object({
  product: z.object({ id: z.string() }),
  credentials: z.object({ keyId: z.string(), secret: z.string() }),
});

test.use({ allowLocalProducts: true });

test("registers independent SDK products, discovers capabilities and manages credentials safely", async ({
  page,
  application,
  request,
  context,
}) => {
  const productA = await serveTestProduct("product-a", "Atlas workspace", true);
  const productB = await serveTestProduct(
    "product-b",
    "Beacon workspace",
    false,
  );
  const origin = { Origin: application.url };
  const owner = {
    name: "Product owner",
    email: "owner@example.test",
    password: application.password,
  };
  const browserProductRequests: string[] = [];
  page.on("request", (outgoing) => {
    if (
      [
        new URL(productA.endpoint).origin,
        new URL(productB.endpoint).origin,
      ].includes(new URL(outgoing.url()).origin)
    ) {
      browserProductRequests.push(outgoing.url());
    }
  });
  let productAId = "";
  let productBId = "";
  let generatedCredential: TestCredential;

  try {
    await test.step("unauthenticated callers cannot add products", async () => {
      const denied = await request.post("/api/products", {
        headers: origin,
        data: {
          name: "Atlas",
          endpoint: productA.endpoint,
          credentials: { mode: "existing", ...productA.credentials },
        },
      });
      expect(denied.status()).toBe(401);
      const claim = await request.post("/api/setup", {
        headers: origin,
        data: { ...owner, setupToken: application.setupToken },
      });
      expect(claim.status()).toBe(201);
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(owner.email);
      await page.getByLabel("Password", { exact: true }).fill(owner.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/overview$/);
    });

    await test.step("the owner adds the first product with an existing independent credential", async () => {
      await page.goto("/products/new");
      await page.getByLabel("Product name", { exact: true }).fill("Atlas");
      await page
        .getByLabel("Endpoint URL", { exact: true })
        .fill(productA.endpoint);
      await page
        .getByRole("radio", { name: /^Use an existing credential/ })
        .check();
      await page
        .getByLabel("Key ID", { exact: true })
        .fill(productA.credentials.keyId);
      await page
        .getByLabel("Shared secret", { exact: true })
        .fill(productA.credentials.secret);
      const createdPromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/products" &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Add product", exact: true })
        .click();
      const created = await createdPromise;
      expect(created.status()).toBe(201);
      const body = await created.text();
      expect(body).not.toContain(productA.credentials.secret);
      productAId = z
        .object({ product: z.object({ id: z.string() }) })
        .parse(JSON.parse(body)).product.id;
      await expect(page).toHaveURL(new RegExp(`/products/${productAId}$`));
      await page
        .getByRole("button", { name: "Test connection", exact: true })
        .click();
      await expect(
        page.getByText("Online", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Atlas workspace", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Count active seats", { exact: true }),
      ).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain(
        productA.credentials.secret,
      );
    });

    await test.step("generated credentials appear only once and connect a second SDK product", async () => {
      await page.goto("/products/new");
      await page.getByLabel("Product name", { exact: true }).fill("Beacon");
      await page
        .getByLabel("Endpoint URL", { exact: true })
        .fill(productB.endpoint);
      const createdPromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/products" &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Add product", exact: true })
        .click();
      const created = await createdPromise;
      expect(created.status()).toBe(201);
      const data = generatedResult.parse(await created.json());
      generatedCredential = data.credentials;
      productBId = data.product.id;
      expect(generatedCredential.secret).not.toBe(productA.credentials.secret);
      productB.setCredentials(generatedCredential);
      await page
        .getByRole("checkbox", { name: /saved the credential safely/i })
        .check();
      await page
        .getByRole("button", { name: "Continue to product", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/products/${productBId}$`));
      await page
        .getByRole("button", { name: "Test connection", exact: true })
        .click();
      await expect(
        page.getByText("Online", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Beacon workspace", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Count active seats", { exact: true }),
      ).toHaveCount(0);
      await page.reload();
      const read = await context.request.get(`/api/products/${productBId}`, {
        headers: origin,
      });
      const body = await read.text();
      expect(body).not.toContain(generatedCredential.secret);
      expect(body).not.toMatch(
        /"(?:ciphertext|secretIv|secretAuthTag|encryptedSecret|secretFingerprint)"/,
      );
      expect(await page.locator("body").innerText()).not.toContain(
        generatedCredential.secret,
      );
    });

    await test.step("unsafe metadata endpoints and cross-origin changes are rejected", async () => {
      const blocked = await context.request.post("/api/products", {
        headers: origin,
        data: {
          name: "Unsafe",
          endpoint: "https://169.254.169.254/latest/meta-data",
          credentials: { mode: "generate" },
        },
      });
      expect(blocked.status()).toBeGreaterThanOrEqual(400);
      expect(blocked.status()).toBeLessThan(500);
      const forged = await context.request.patch(
        `/api/products/${productAId}`,
        {
          headers: { Origin: "https://attacker.example" },
          data: { enabled: false },
        },
      );
      expect(forged.status()).toBe(403);
    });

    await test.step("disabling a product prevents further connection attempts", async () => {
      await page.goto(`/products/${productBId}`);
      await page
        .getByRole("button", { name: "Disable product", exact: true })
        .click();
      const confirmation = page.getByRole("alertdialog");
      await confirmation
        .getByRole("button", { name: "Disable product", exact: true })
        .click();
      await expect(
        page.getByText("Disabled", { exact: true }).first(),
      ).toBeVisible();
      const before = productB.requestCount();
      const rejected = await context.request.post(
        `/api/products/${productBId}/test`,
        { headers: origin, data: {} },
      );
      expect(rejected.status()).toBe(409);
      expect(productB.requestCount()).toBe(before);
      await page
        .getByRole("button", { name: "Enable product", exact: true })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Enable product", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: /^(Test connection|Reconnect)$/ }),
      ).toBeEnabled();
    });

    await test.step("one offline product leaves another product usable", async () => {
      await productB.close();
      await page
        .getByRole("button", { name: /^(Test connection|Reconnect)$/ })
        .click();
      await expect(
        page.getByText("Offline", { exact: true }).first(),
      ).toBeVisible();
      await page.goto(`/products/${productAId}`);
      await page
        .getByRole("button", { name: /^(Test connection|Reconnect)$/ })
        .click();
      await expect(
        page.getByText("Online", { exact: true }).first(),
      ).toBeVisible();
    });

    await test.step("credential replacement requires confirmation and invalidates previous discovery", async () => {
      await page
        .getByRole("button", { name: "Replace credential", exact: true })
        .click();
      const confirmation = page.getByRole("alertdialog");
      await confirmation
        .getByLabel("Type the product name to confirm", { exact: true })
        .fill("Atlas");
      const replacedPromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
          `/api/products/${productAId}/credentials`,
      );
      await confirmation
        .getByRole("button", { name: "Replace credential", exact: true })
        .click();
      const replaced = generatedResult.parse(
        await (await replacedPromise).json(),
      );
      expect(replaced.credentials.secret).not.toBe(productA.credentials.secret);
      productA.setCredentials(replaced.credentials);
      await page
        .getByRole("checkbox", { name: /saved the credential safely/i })
        .check();
      await page
        .getByRole("button", { name: "Continue to product", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Test connection", exact: true })
        .click();
      await expect(
        page.getByText("Online", { exact: true }).first(),
      ).toBeVisible();
    });

    await test.step("the registry and encrypted credentials survive a real application restart", async () => {
      await page.goto("about:blank");
      await application.restart();
      await page.goto(`/products/${productAId}`);
      await expect(
        page.getByRole("heading", { name: "Atlas", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: /^(Test connection|Reconnect)$/ })
        .click();
      await expect(
        page.getByText("Online", { exact: true }).first(),
      ).toBeVisible();
      await page.goto("/products");
      await expect(
        page.getByRole("link", { name: "Open Atlas", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Open Beacon", exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          ),
        )
        .toBe(false);
      await mkdir(".test-data", { recursive: true });
      await page.screenshot({
        path: ".test-data/products-review.png",
        fullPage: true,
      });
    });

    await test.step("removal requires the named confirmation and prevents future tests", async () => {
      await page.goto(`/products/${productAId}`);
      await page
        .getByRole("button", { name: "Remove product", exact: true })
        .click();
      const confirmation = page.getByRole("alertdialog");
      await confirmation
        .getByLabel("Type the product name to confirm", { exact: true })
        .fill("Atlas");
      await confirmation
        .getByRole("button", { name: "Remove product", exact: true })
        .click();
      await expect(page).toHaveURL(/\/products$/);
      const before = productA.requestCount();
      const removed = await context.request.post(
        `/api/products/${productAId}/test`,
        { headers: origin, data: {} },
      );
      expect(removed.status()).toBe(404);
      expect(productA.requestCount()).toBe(before);
      expect(browserProductRequests).toEqual([]);
    });
  } finally {
    await productA.close();
    await productB.close();
  }
});
