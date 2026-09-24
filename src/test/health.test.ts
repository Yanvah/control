import { describe, expect, it, vi } from "vitest";
import { GET as live } from "@/app/api/health/live/route";
import { GET as ready } from "@/app/api/health/ready/route";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/db/client", () => ({
  getSqlite: () => ({ prepare: () => ({ get }) }),
}));

describe("minimal health endpoints", () => {
  it("reports liveness without touching the database", async () => {
    const response = live();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(get).not.toHaveBeenCalled();
  });

  it("accepts a working database before an owner is claimed", async () => {
    get.mockReturnValue(undefined);
    const response = ready();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a safe unavailable state on database failure", async () => {
    get.mockImplementation(() => {
      throw new Error("private database path and credentials");
    });
    const response = ready();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
