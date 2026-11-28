import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const openapi = JSON.parse(readFileSync("../../docs/openapi.json", "utf8")) as { paths: Record<string, unknown> };
const postman = JSON.parse(readFileSync("../../docs/marketsphere.postman_collection.json", "utf8")) as { item: Array<{ request?: { url?: string | { raw?: string } } }> };

function normalize(path: string) {
  return path.replace(/^\{\{(?:apiUrl|pythonUrl)\}\}/, "").replace(/\{[^}]+\}|<[^>]+>/g, "{param}");
}

describe("A13 OpenAPI/Postman contract parity", () => {
  it("covers every documented path in the Postman collection", () => {
    const urls = postman.item.map((item) => typeof item.request?.url === "string" ? item.request.url : item.request?.url?.raw ?? "").map(normalize);
    const missing = Object.keys(openapi.paths).filter((path) => !urls.includes(normalize(path)));
    expect(missing).toEqual([]);
  });
});
