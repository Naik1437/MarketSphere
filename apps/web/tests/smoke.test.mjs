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
