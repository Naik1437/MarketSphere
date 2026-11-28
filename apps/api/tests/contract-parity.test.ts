import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const openapi = JSON.parse(readFileSync("../../docs/openapi.json", "utf8")) as { paths: Record<string, unknown> };
const postman = JSON.parse(readFileSync("../../docs/marketsphere.postman_collection.json", "utf8")) as { item: Array<{ request?: { method?: string; url?: string | { raw?: string } } }> };

function normalize(path: string) {
  return path.replace(/^\{\{(?:apiUrl|pythonUrl)\}\}/, "").replace(/\{[^}]+\}|<[^>]+>/g, "{param}");
}

describe("A13 OpenAPI/Postman contract parity", () => {
  it("covers every documented path in the Postman collection", () => {
    const requests = postman.item.map((item) => ({ method: item.request?.method ?? "GET", path: normalize(typeof item.request?.url === "string" ? item.request.url : item.request?.url?.raw ?? "") }));
    const missing = Object.entries(openapi.paths).flatMap(([path, operations]) => Object.keys(operations).filter((method) => !requests.some((request) => request.method.toLowerCase() === method.toLowerCase() && request.path === normalize(path))).map((method) => `${method.toUpperCase()} ${path}`));
    expect(missing).toEqual([]);
  });
});
