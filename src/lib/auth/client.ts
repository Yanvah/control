"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

// Relative requests keep the browser on this instance's origin.
export const authClient = createAuthClient({
  plugins: [passkeyClient()],
});
