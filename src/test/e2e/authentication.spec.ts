import { test, expect } from "./fixtures";
import { z } from "zod";

test("the owner can securely claim, authenticate, manage sessions and persist passkeys across restart", async ({
  page,
  context,
  browser,
  request,
  application,
}) => {
  const owner = {
    name: "Test owner",
    email: "owner@example.test",
    password: application.password,
  };
  const origin = { Origin: application.url };

  await test.step("fresh instances reject untrusted claims and unauthenticated requests", async () => {
    await page.goto("/setup");
    await expect(
      page.getByRole("button", { name: "Create owner account" }),
    ).toBeVisible();

    const noToken = await request.post("/api/setup", {
      headers: origin,
      data: owner,
    });
    expect(noToken.status()).toBeGreaterThanOrEqual(400);
    expect(noToken.status()).toBeLessThan(500);

    const wrongToken = await request.post("/api/setup", {
      headers: origin,
      data: { ...owner, setupToken: "x".repeat(64) },
    });
    expect(wrongToken.status()).toBe(403);

    const sessions = await request.get("/api/sessions");
    expect(sessions.status()).toBe(401);
    const mutation = await request.post("/api/sessions/revoke", {
      headers: origin,
      data: { sessionId: "untrusted-session" },
    });
    expect(mutation.status()).toBe(401);

    for (const route of ["/overview", "/settings"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/(?:setup|login)(?:\?|$)/);
    }
  });

  await test.step("health checks are minimal and responses enforce browser security headers", async () => {
    for (const endpoint of ["/api/health/live", "/api/health/ready"]) {
      const health = await request.get(endpoint);
      expect(health.status()).toBe(200);
      const body = await health.json();
      expect(Object.keys(body)).toEqual(["status"]);
      expect(health.headers()["x-content-type-options"]).toBe("nosniff");
      expect(health.headers()["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
    }
  });

  await test.step("setup creates the sole owner and permanently disables registration", async () => {
    await page.goto("/setup");
    await page.getByLabel("Name", { exact: true }).fill(owner.name);
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Password", { exact: true }).fill(owner.password);
    await page
      .getByLabel("Setup token", { exact: true })
      .fill(application.setupToken);
    const signedIn = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-in/email"),
    );
    await page.getByRole("button", { name: "Create owner account" }).click();
    const authenticationResponse = await signedIn;
    expect(authenticationResponse.status()).toBe(200);
    await expect(page).toHaveURL(/\/settings(?:\?|$)/);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();

    const repeatedSetup = await request.post("/api/setup", {
      headers: origin,
      data: {
        ...owner,
        email: "another@example.test",
        setupToken: application.setupToken,
      },
    });
    expect(repeatedSetup.status()).toBe(409);
    const registration = await request.post("/api/auth/sign-up/email", {
      headers: origin,
      data: { ...owner, email: "another@example.test" },
    });
    expect(registration.status()).toBeGreaterThanOrEqual(400);
    expect(registration.status()).toBeLessThan(500);

    const sessionCookie = (await context.cookies()).find((cookie) =>
      cookie.name.includes("session_token"),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(["Lax", "Strict"]).toContain(sessionCookie?.sameSite);
  });

  const authenticator = await context.newCDPSession(page);
  await authenticator.send("WebAuthn.enable");
  await authenticator.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await test.step("the owner enrolls a real WebAuthn passkey", async () => {
    await page.getByLabel("Passkey name", { exact: true }).fill("Owner device");
    await page
      .getByRole("button", { name: "Add passkey", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Remove Owner device", exact: true }),
    ).toBeVisible();
  });

  await test.step("session management revokes another browser without revoking the current one", async () => {
    const secondaryContext = await browser.newContext({
      baseURL: application.url,
    });
    try {
      const secondaryPage = await secondaryContext.newPage();
      await secondaryPage.goto("/login");
      await secondaryPage
        .getByLabel("Email", { exact: true })
        .fill(owner.email);
      await secondaryPage
        .getByLabel("Password", { exact: true })
        .fill(`${owner.password}-incorrect`);
      await secondaryPage
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(
        secondaryPage.getByRole("alert").filter({ hasText: "Sign-in failed" }),
      ).toBeVisible();
      expect(
        (await secondaryContext.request.get("/api/sessions")).status(),
      ).toBe(401);
      await secondaryPage
        .getByLabel("Password", { exact: true })
        .fill(owner.password);
      await secondaryPage
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(secondaryPage).toHaveURL(/\/overview(?:\?|$)/);

      await page.reload();
      await expect(
        page.getByText("This session", { exact: true }),
      ).toBeVisible();
      const sessionResponse = await context.request.get("/api/sessions");
      expect(sessionResponse.status()).toBe(200);
      const sessionText = await sessionResponse.text();
      expect(sessionText).not.toMatch(/"(?:token|password|secret)"/i);
      const authSession = await context.request.get("/api/auth/get-session");
      expect(authSession.status()).toBe(200);
      expect(await authSession.text()).not.toMatch(
        /"(?:token|password|secret)"/i,
      );

      const forbidden = await context.request.post("/api/sessions/revoke", {
        headers: { Origin: "https://untrusted.example" },
        data: { sessionId: "untrusted-session" },
      });
      expect(forbidden.status()).toBe(403);

      await page
        .getByRole("button", { name: "Revoke session", exact: true })
        .click();
      const confirmation = page.getByRole("alertdialog");
      await expect(confirmation).toBeVisible();
      await confirmation
        .getByRole("button", { name: "Revoke session", exact: true })
        .click();
      const revokedNotice = page
        .getByRole("status")
        .filter({ hasText: "Session revoked" });
      await expect(revokedNotice).toBeVisible();
      const placement = await revokedNotice.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const container = element.parentElement!;
        return {
          top: bounds.top,
          right: window.innerWidth - bounds.right,
          containerPosition: getComputedStyle(container).position,
          containerTop: Number.parseFloat(getComputedStyle(container).top),
        };
      });
      expect(placement.containerPosition).toBe("fixed");
      expect(placement.containerTop).toBeLessThanOrEqual(24);
      expect(placement.top).toBeGreaterThanOrEqual(placement.containerTop);
      expect(placement.right).toBeLessThanOrEqual(24);
      await expect(
        page.getByRole("button", { name: "Revoke session", exact: true }),
      ).toHaveCount(0);
      await secondaryPage.goto("/overview");
      await expect(secondaryPage).toHaveURL(/\/login(?:\?|$)/);
      await page.goto("/overview");
      await expect(page).toHaveURL(/\/overview(?:\?|$)/);
    } finally {
      await secondaryContext.close();
    }
  });

  await test.step("logout invalidates access and the enrolled passkey authenticates", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    const signedOut = await context.request.get("/api/sessions");
    expect(signedOut.status()).toBe(401);
    const passkeySignIn = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/passkey/verify-authentication"),
    );
    await page
      .getByRole("button", { name: "Sign in with a passkey", exact: true })
      .click();
    const authenticationResponse = await passkeySignIn;
    expect(authenticationResponse.status()).toBe(200);
    await expect(page).toHaveURL(/\/overview(?:\?|$)/);
  });

  await test.step("owner, sessions, passkeys and the setup closure survive a process restart", async () => {
    // Disconnect development hot reload before restarting the process so it
    // cannot race the explicit navigation used to verify persisted state.
    await page.goto("about:blank");
    await application.restart();
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove Owner device", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("This session", { exact: true })).toBeVisible();

    const repeatedSetup = await request.post("/api/setup", {
      headers: origin,
      data: {
        ...owner,
        email: "another@example.test",
        setupToken: application.setupToken,
      },
    });
    expect(repeatedSetup.status()).toBe(409);
    await page.goto("/setup");
    await expect(page).not.toHaveURL(/\/setup(?:\?|$)/);

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await page
      .getByRole("button", { name: "Sign in with a passkey", exact: true })
      .click();
    await expect(page).toHaveURL(/\/overview(?:\?|$)/);
  });

  await test.step("the tablet shell fits its viewport and supports keyboard page navigation", async () => {
    await page.screenshot({
      path: ".test-data/ui-overview-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/overview");
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: ".test-data/ui-overview-tablet.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await page.keyboard.press("ControlOrMeta+k");
    const commandMenu = page.getByRole("dialog", { name: "Go to a page" });
    await expect(commandMenu).toBeVisible();
    await expect(commandMenu.getByLabel("Find a page")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(commandMenu).toBeHidden();

    await page.keyboard.press("ControlOrMeta+k");
    await commandMenu.getByLabel("Find a page").fill("Settings");
    await page.keyboard.press("Tab");
    await expect(
      commandMenu.getByRole("link", { name: /^Settings/ }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings(?:\?|$)/);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: ".test-data/ui-review.png", fullPage: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: ".test-data/ui-settings-desktop.png",
      fullPage: true,
    });
  });

  await test.step("authentication and session changes retain complete redacted audit sequences", async () => {
    const resultSchema = z.object({
      events: z.array(
        z.object({
          requestId: z.uuid(),
          actorId: z.uuid().nullable(),
          eventType: z.enum(["requested", "succeeded", "failed", "unknown"]),
        }),
      ),
    });
    const cookies = await context.cookies();
    for (const action of [
      "setup.claim",
      "auth.login.password",
      "auth.login.passkey",
      "auth.passkey.register",
      "session.revoke",
      "auth.signout",
    ]) {
      const response = await context.request.get(
        `/api/audit?outcome=all&action=${action}`,
        { headers: origin },
      );
      expect(response.status()).toBe(200);
      const raw = await response.text();
      for (const secret of [
        owner.password,
        owner.email,
        application.setupToken,
        ...cookies.map((cookie) => cookie.value),
      ]) {
        expect(raw).not.toContain(secret);
      }
      const { events } = resultSchema.parse(JSON.parse(raw));
      const completed = events.filter(
        (event) => event.eventType === "succeeded",
      );
      expect(completed.length).toBeGreaterThan(0);
      for (const event of completed) {
        expect(event.actorId).not.toBeNull();
        expect(
          events
            .filter((candidate) => candidate.requestId === event.requestId)
            .map((candidate) => candidate.eventType),
        ).toEqual(["succeeded", "requested"]);
      }
    }
  });
});
