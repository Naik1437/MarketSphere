import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("frontend core routes and API client exist", () => {
  const required = [
    "src/app/page.tsx",
    "src/app/login/page.tsx",
    "src/app/cart/page.tsx",
    "src/app/orders/page.tsx",
    "src/app/seller/page.tsx",
    "src/app/warehouse/page.tsx",
    "src/app/support/page.tsx",
    "src/app/admin/page.tsx",
    "src/lib/api.ts",
  ];
  for (const rel of required) {
    assert.equal(
      fs.existsSync(path.join(process.cwd(), rel)),
      true,
      `Missing ${rel}`
    );
  }
});

test("role workflows expose their required functional actions", () => {
  const expectations = {
    "src/app/seller/page.tsx": ["create product", "settlements"],
    "src/app/warehouse/page.tsx": ["shipments", "inventory/adjust"],
    "src/app/support/page.tsx": ["dispute", "return"],
    "src/app/admin/page.tsx": ["overview", "settlement"],
    "src/app/cart/page.tsx": ["checkout", "remove"],
  };
  for (const [rel, markers] of Object.entries(expectations)) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8").toLowerCase();
    for (const marker of markers) assert.match(source, new RegExp(marker.toLowerCase()), `${rel} missing ${marker}`);
  }
});
