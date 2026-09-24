import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { test, expect } from "./fixtures";
import { serveOperationalProduct } from "../fixtures/operational-product";
import {
  mutationRequestSchema,
  mutationResultSchema,
  userDetailPath,
} from "@/lib/users/models";

test.use({ allowLocalProducts: true });
test("searches two SaaS products and performs only confirmed, capability-supported operations", async ({
  page,
  context,
  application,
}) => {
  const first = await serveOperationalProduct("atlas", "Atlas SaaS", true);
  const second = await serveOperationalProduct("beacon", "Beacon SaaS", false);
  const origin = { Origin: application.url };
  const directRequests: string[] = [];
  page.on("request", (request) => {
    if (
      [
        new URL(first.endpoint).origin,
        new URL(second.endpoint).origin,
      ].includes(new URL(request.url()).origin)
    )
      directRequests.push(request.url());
  });
  try {
    const setup = await context.request.post("/api/setup", {
      headers: origin,
      data: {
        setupToken: application.setupToken,
        name: "Operations owner",
        email: "owner@example.com",
        password: application.password,
      },
    });
    expect(setup.status()).toBe(201);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill(application.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/overview$/);
    const created = z.object({ product: z.object({ id: z.uuid() }) });
    const a = created.parse(
      await (
        await context.request.post("/api/products", {
          headers: origin,
          data: {
            name: "Atlas",
            endpoint: first.endpoint,
            credentials: { mode: "existing", ...first.credentials },
          },
        })
      ).json(),
    ).product.id;
    const b = created.parse(
      await (
        await context.request.post("/api/products", {
          headers: origin,
          data: {
            name: "Beacon",
            endpoint: second.endpoint,
            credentials: { mode: "existing", ...second.credentials },
          },
        })
      ).json(),
    ).product.id;

    await test.step("creates users from a capable product only", async () => {
      await page.goto(`/products/${a}`);
      await page.getByRole("button", { name: "Test connection" }).click();
      await expect(
        page.getByRole("link", { name: "Create user" }),
      ).toBeVisible();
      await page.goto(`/products/${b}`);
      await page.getByRole("button", { name: "Test connection" }).click();
      await expect(page.getByRole("link", { name: "Create user" })).toHaveCount(
        0,
      );
      await page.goto(`/products/${a}`);
      await page.getByRole("link", { name: "Create user" }).click();
      await page
        .getByLabel("Email", { exact: true })
        .fill("created@example.com");
      await page.getByLabel("Name (optional)").fill("Created User");
      await page.getByRole("button", { name: "Review creation" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog.getByText("created@example.com")).toBeVisible();
      await dialog
        .getByRole("checkbox", { name: /I understand this creates/ })
        .check();
      await dialog.getByRole("button", { name: "Create user" }).click();
      await expect(
        page.getByRole("heading", { name: "User created" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "View user" })).toBeVisible();
      expect(first.created("created@example.com")).toMatchObject({
        name: "Created User",
      });
      expect(second.created("created@example.com")).toBeUndefined();

      await page.goto(`/products/${a}/users/new`);
      await page
        .getByLabel("Email", { exact: true })
        .fill("created@example.com");
      await page.getByRole("button", { name: "Review creation" }).click();
      const duplicateDialog = page.getByRole("alertdialog");
      await duplicateDialog
        .getByRole("checkbox", { name: /I understand this creates/ })
        .check();
      await duplicateDialog
        .getByRole("button", { name: "Create user" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Creation failed" }),
      ).toBeVisible();
      await expect(
        page.getByText(/already exists in the product/),
      ).toBeVisible();

      first.setMode("lost-mutation");
      await page.goto(`/products/${a}/users/new`);
      await page
        .getByLabel("Email", { exact: true })
        .fill("lost-created@example.com");
      await page.getByRole("button", { name: "Review creation" }).click();
      const lostDialog = page.getByRole("alertdialog");
      await lostDialog
        .getByRole("checkbox", { name: /I understand this creates/ })
        .check();
      await lostDialog.getByRole("button", { name: "Create user" }).click();
      await expect(
        page.getByRole("heading", { name: "Outcome unknown" }),
      ).toBeVisible();
      expect(first.created("lost-created@example.com")).toBeDefined();
      await page
        .getByRole("button", { name: "Check recorded outcome" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Outcome unknown" }),
      ).toBeVisible();
      first.setMode("online");
    });

    await test.step("search and inspect products with different capabilities and fields", async () => {
      await page.goto("/users");
      await page.getByLabel("Email, name, or user ID").fill("john@example.com");
      await page
        .getByRole("button", { name: "Search users", exact: true })
        .click();
      await expect(
        page.getByText("2 matching users across 2 enabled products", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Atlas search results" })
          .getByText("John Atlas"),
      ).toBeVisible();
      await page
        .getByRole("region", { name: "Beacon search results" })
        .getByRole("link", { name: "View user" })
        .click();
      await expect(
        page
          .getByRole("region", { name: "Subscription", exact: true })
          .getByText("team", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Ban user", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Change plan", exact: true }),
      ).toHaveCount(0);
      await page.goto(userDetailPath(a, "user_123"));
      await expect(
        page
          .getByRole("region", { name: "Subscription", exact: true })
          .getByText("basic", { exact: true }),
      ).toBeVisible();
    });

    await test.step("typed confirmation bans Atlas only and refreshes confirmed success", async () => {
      await page.getByRole("button", { name: "Ban user", exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog.getByText("Atlas", { exact: true })).toBeVisible();
      await dialog
        .getByRole("checkbox", { name: /I reviewed the product/ })
        .check();
      await dialog
        .getByLabel("Type user_123 to confirm", { exact: true })
        .fill("wrong");
      await expect(
        dialog.getByRole("button", { name: "Confirm operation" }),
      ).toBeDisabled();
      await dialog
        .getByLabel("Type user_123 to confirm", { exact: true })
        .fill("user_123");
      await dialog.getByRole("button", { name: "Confirm operation" }).click();
      await expect(
        page.getByRole("heading", { name: "Operation succeeded", exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "User record", exact: true })
          .getByText("Banned", { exact: true }),
      ).toBeVisible();
      expect(first.user().banned).toBe(true);
      expect(second.user().banned).toBeUndefined();
    });

    await test.step("plan changes and product-defined actions use the SDK's real parameters", async () => {
      await page
        .getByRole("button", { name: "Change plan", exact: true })
        .click();
      let dialog = page.getByRole("alertdialog");
      await dialog.getByLabel("New plan ID", { exact: true }).fill("pro");
      await dialog
        .getByRole("checkbox", { name: /I reviewed the product/ })
        .check();
      await dialog.getByRole("button", { name: "Confirm operation" }).click();
      await expect(
        page
          .getByRole("region", { name: "Subscription", exact: true })
          .getByText("pro", { exact: true }),
      ).toBeVisible();
      expect(second.subscription().planId).toBe("team");
      await page
        .getByRole("button", { name: "Run Grant credit", exact: true })
        .click();
      dialog = page.getByRole("alertdialog");
      await dialog
        .getByLabel("Action parameters (JSON)", { exact: true })
        .fill(JSON.stringify({ userId: "user_123", credits: 3 }));
      await dialog
        .getByLabel("Type Atlas to confirm", { exact: true })
        .fill("Atlas");
      await dialog
        .getByRole("checkbox", { name: /I reviewed the product/ })
        .check();
      await dialog.getByRole("button", { name: "Confirm operation" }).click();
      await expect(
        page.getByText('"granted": 3', { exact: false }),
      ).toBeVisible();
      first.addAction();
      await page
        .getByRole("button", { name: "Refresh record", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Run New action", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Run New action", exact: true })
        .click();
      dialog = page.getByRole("alertdialog");
      await dialog
        .getByRole("checkbox", { name: /I reviewed the product/ })
        .check();
      await dialog.getByRole("button", { name: "Confirm operation" }).click();
      await expect(
        page.getByText('"added": true', { exact: false }),
      ).toBeVisible();
    });

    first.setMode("lost-mutation");
    await page.getByRole("button", { name: "Unban user", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog
      .getByRole("checkbox", { name: /I reviewed the product/ })
      .check();
    const requestPromise = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === `/api/products/${a}/operations`,
    );
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/products/${a}/operations`,
    );
    await dialog.getByRole("button", { name: "Confirm operation" }).click();
    const lostRequest = mutationRequestSchema.parse(
      (await requestPromise).postDataJSON(),
    );
    const lostResponse = await responsePromise;
    const controlRequestId = lostResponse.headers()["x-request-id"];
    expect(controlRequestId).toMatch(/^[a-f0-9-]{36}$/);
    const lostResult = mutationResultSchema.parse(await lostResponse.json());
    expect(lostResult.state).toBe("unknown");
    await expect(
      page.getByRole("heading", { name: "Outcome unknown", exact: true }),
    ).toBeVisible();
    expect(first.user().banned).toBe(false);
    await expect(
      page
        .getByRole("region", { name: "User record", exact: true })
        .getByText("Banned", { exact: true }),
    ).toBeVisible();
    expect(first.requests.at(-1)?.operation).toBe("users.unban");
    await expect(
      page.getByRole("button", { name: "Ban user", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Check recorded outcome", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Outcome unknown", exact: true }),
    ).toBeVisible();
    first.setMode("online");
    await page
      .getByRole("button", { name: "Refresh remote record", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "User record", exact: true })
        .getByText("Not banned", { exact: true }),
    ).toBeVisible();

    await test.step("one offline SaaS leaves other results usable and the tablet page contained", async () => {
      second.setMode("offline");
      await page.goto("/users");
      await page.getByLabel("Email, name, or user ID").fill("john@example.com");
      await page
        .getByRole("button", { name: "Search users", exact: true })
        .click();
      await expect(
        page
          .getByRole("region", { name: "Beacon search results" })
          .getByText("Offline", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Atlas search results" })
          .getByRole("link", { name: "View user" }),
      ).toBeVisible();
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
        )
        .toBe(false);
      await mkdir(".test-data", { recursive: true });
      await page.screenshot({
        path: ".test-data/users-review.png",
        fullPage: true,
      });
    });

    await test.step("an application restart preserves the receipt and does not replay the lost operation", async () => {
      await page.goto("about:blank");
      await application.restart();
      const before = first.mutationCount();
      const repeated = await context.request.post(
        `/api/products/${a}/operations`,
        { headers: origin, data: lostRequest },
      );
      expect(repeated.status()).toBe(200);
      expect(await repeated.json()).toMatchObject({
        state: "unknown",
        attemptId: lostRequest.attemptId,
      });
      expect(first.mutationCount()).toBe(before);
      const status = await context.request.get(
        `/api/operations/${lostRequest.attemptId}`,
        { headers: origin },
      );
      expect(status.status()).toBe(200);
      expect(await status.json()).toMatchObject({ state: "unknown" });
      const anonymous = await context.browser()?.newContext();
      expect(anonymous).toBeDefined();
      try {
        expect(
          (
            await anonymous!.request.post(
              `${application.url}/api/products/${b}/operations`,
              {
                headers: origin,
                data: { ...lostRequest, attemptId: randomUUID() },
              },
            )
          ).status(),
        ).toBe(401);
      } finally {
        await anonymous?.close();
      }
      expect(directRequests).toEqual([]);
    });

    await test.step("audit history filters, redacts, correlates outcomes, and survives restart", async () => {
      const history = await context.request.get(
        `/api/audit?outcome=all&action=users.unban&productId=${a}`,
        { headers: origin },
      );
      expect(history.status()).toBe(200);
      const payload = await history.json();
      expect(
        payload.events.map((event: { eventType: string }) => event.eventType),
      ).toEqual(["unknown", "requested"]);
      expect(payload.events[0].attemptId).toBe(lostRequest.attemptId);
      expect(payload.events[0].requestId).toBe(controlRequestId);
      expect(payload.events[1].requestId).toBe(controlRequestId);
      expect(payload.events[0].metadata.sdkRequestId).toBe(
        lostResult.requestId,
      );
      expect(payload.events[0].targetId).toMatch(/^[a-f0-9]{64}$/);
      for (const secret of [
        first.credentials.secret,
        second.credentials.secret,
        application.setupToken,
        application.password,
        "john@example.com",
        "user_123",
      ]) {
        expect(JSON.stringify(payload)).not.toContain(secret);
      }
      await page.goto("/audit");
      await expect(
        page.getByRole("heading", { name: "Audit Log", exact: true }),
      ).toBeVisible();
      await page.getByLabel("Outcome", { exact: true }).selectOption("unknown");
      await page
        .getByLabel("Action", { exact: true })
        .selectOption("users.unban");
      await page.getByLabel("Product ID", { exact: true }).fill(a);
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(page.getByRole("row")).toHaveCount(2);
      await page
        .getByRole("link", { name: "users.unban", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "users.unban", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("The operation may have completed.", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText(lostRequest.attemptId, { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("list", { name: "Event sequence" })
          .getByRole("listitem"),
      ).toHaveCount(2);
      await page.goto("/audit");
      await page.getByRole("button", { name: "Verify integrity" }).click();
      await expect(page.getByRole("status")).toContainText("Chain head:");
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
        )
        .toBe(false);
      await page.screenshot({
        path: ".test-data/audit-review.png",
        fullPage: true,
      });
    });
  } finally {
    await first.close();
    await second.close();
  }
});
