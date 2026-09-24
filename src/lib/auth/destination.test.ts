import { describe, expect, it } from "vitest";
import { safeLoginDestination } from "./destination";

describe("login return destinations", () => {
  it.each([
    "/settings",
    "/users",
    "/users/0583dfee-3774-48a4-855f-8eb2ff6d28dc?userId=opaque%2Fid%3Fx%3D1",
    "/products/0583dfee-3774-48a4-855f-8eb2ff6d28dc/actions",
    "/products/0583dfee-3774-48a4-855f-8eb2ff6d28dc/users/new",
    "/products",
    "/products/new",
    "/products/0583dfee-3774-48a4-855f-8eb2ff6d28dc",
  ])("returns to known local destination %s", (destination) => {
    expect(safeLoginDestination(destination)).toBe(destination);
  });
  it.each([
    "https://evil.example",
    "/users/0583dfee-3774-48a4-855f-8eb2ff6d28dc?userId=ok&next=https://evil.example",
    "/users/0583dfee-3774-48a4-855f-8eb2ff6d28dc?userId=one&userId=two",
    "/users/0583dfee-3774-48a4-855f-8eb2ff6d28dc?userId=ok#evil",
    "/users/0583dfee-3774-48a4-855f-8eb2ff6d28dc?userId=",
    "/products/0583dfee-3774-48a4-855f-8eb2ff6d28dc/actions/evil",
    "/products/0583dfee-3774-48a4-855f-8eb2ff6d28dc/users/new?next=//evil.example",
    "/products/0583dfee-3774-48a4-855f-8eb2ff6d28dc/users/new/evil",
    "//evil.example",
    "javascript:alert(1)",
    "/products/../../api/auth/sign-out",
    "/products/%2e%2e",
    "/products/new?next=//evil.example",
    "/products/new#fragment",
    "/products\\evil.example",
    ["/products"],
    undefined,
    "/products/0583dfee-3774-48a4-855f-8eb2ff6d28dc/evil",
  ])("rejects unsupported or malicious destination %#", (destination) => {
    expect(safeLoginDestination(destination)).toBe("/overview");
  });
});
