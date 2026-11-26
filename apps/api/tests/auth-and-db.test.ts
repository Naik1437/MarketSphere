import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || "DemoPass!2026";

async function loginAs(email: string, password = DEMO_PASSWORD) {
  return request(app).post("/api/v1/auth/login").send({ email, password });
}

describe("MarketSphere Auth, RBAC, Ownership & DB Constraints", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it("authenticates all five roles with valid credentials", async () => {
    const accounts = [
      { email: "customer1@marketsphere.local", role: "CUSTOMER" },
      { email: "seller1@marketsphere.local", role: "SELLER" },
      { email: "warehouse@marketsphere.local", role: "WAREHOUSE_OPERATOR" },
      { email: "support@marketsphere.local", role: "SUPPORT_AGENT" },
      { email: "admin@marketsphere.local", role: "ADMIN" },
    ];

    for (const acc of accounts) {
      const res = await loginAs(acc.email);
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTypeOf("string");
      expect(res.body.refreshToken).toBeTypeOf("string");
      expect(res.body.user.role).toBe(acc.role);

      const me = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${res.body.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(acc.email);
    }
  });

  it("rejects invalid credentials and malformed payloads", async () => {
    const badPass = await loginAs("customer1@marketsphere.local", "WrongPass!99");
    expect(badPass.status).toBe(401);

    const unknownUser = await loginAs("nobody@marketsphere.local");
    expect(unknownUser.status).toBe(401);

    const badPayload = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "123" });
    expect(badPayload.status).toBe(400);
  });

  it("enforces server-side RBAC", async () => {
    const customer = await loginAs("customer1@marketsphere.local");
    const admin = await loginAs("admin@marketsphere.local");

    const custAdmin = await request(app)
      .get("/api/v1/auth/admin-check")
      .set("Authorization", `Bearer ${customer.body.accessToken}`);
    expect(custAdmin.status).toBe(403);

    const custWh = await request(app)
      .get("/api/v1/auth/warehouse-check")
      .set("Authorization", `Bearer ${customer.body.accessToken}`);
    expect(custWh.status).toBe(403);

    const adminOk = await request(app)
      .get("/api/v1/auth/admin-check")
      .set("Authorization", `Bearer ${admin.body.accessToken}`);
    expect(adminOk.status).toBe(200);
  });

  it("enforces cross-account ownership isolation for sellers and customers", async () => {
    const s1 = await loginAs("seller1@marketsphere.local");
    const s2 = await loginAs("seller2@marketsphere.local");
    const c1 = await loginAs("customer1@marketsphere.local");
    const c2 = await loginAs("customer2@marketsphere.local");
    const admin = await loginAs("admin@marketsphere.local");

    const s1Own = await request(app)
      .get(`/api/v1/auth/sellers/${s1.body.user.sellerId}/scope`)
      .set("Authorization", `Bearer ${s1.body.accessToken}`);
    expect(s1Own.status).toBe(200);

    const s1Cross = await request(app)
      .get(`/api/v1/auth/sellers/${s2.body.user.sellerId}/scope`)
      .set("Authorization", `Bearer ${s1.body.accessToken}`);
    expect(s1Cross.status).toBe(403);

    const c1Own = await request(app)
      .get(`/api/v1/auth/customers/${c1.body.user.id}/scope`)
      .set("Authorization", `Bearer ${c1.body.accessToken}`);
    expect(c1Own.status).toBe(200);

    const c1Cross = await request(app)
      .get(`/api/v1/auth/customers/${c2.body.user.id}/scope`)
      .set("Authorization", `Bearer ${c1.body.accessToken}`);
    expect(c1Cross.status).toBe(403);

    const adminSeller = await request(app)
      .get(`/api/v1/auth/sellers/${s2.body.user.sellerId}/scope`)
      .set("Authorization", `Bearer ${admin.body.accessToken}`);
    expect(adminSeller.status).toBe(200);
  });

  it("rotates refresh tokens, detects reuse, and revokes on logout", async () => {
    const login = await loginAs("customer2@marketsphere.local");
    const firstRefresh = login.body.refreshToken as string;

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefresh });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTypeOf("string");
    expect(refreshed.body.refreshToken).not.toBe(firstRefresh);

    // Reusing rotated token must fail
    const reuse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefresh });
    expect(reuse.status).toBe(401);

    // Logout revokes a fresh token
    const login2 = await loginAs("customer2@marketsphere.local");
    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: login2.body.refreshToken });
    expect(logout.status).toBe(200);

    const afterLogout = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: login2.body.refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  it("enforces database unique constraints", async () => {
    await expect(
      prisma.user.create({
        data: {
          email: "customer1@marketsphere.local",
          passwordHash: "hash",
          fullName: "Duplicate",
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.sku.create({
        data: {
          productId: "non-existent",
          skuCode: "KIRAN-MOUSE-001",
          title: "Dup",
          price: "100.00",
        },
      })
    ).rejects.toThrow();
  });
});
