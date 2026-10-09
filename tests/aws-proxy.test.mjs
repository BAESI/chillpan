import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

function load(file, require, extras = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require, URL, Request, Response, Headers, AbortSignal, TextEncoder, crypto: webcrypto, console: { error() {} }, ...extras });
  return exports;
}

function proxy(fetch) {
  const board = load("../lib/board.ts");
  return load("../app/api/board/route.ts", (name) => name === "cloudflare:workers"
    ? { env: { AWS_BOARD_ORIGIN: "https://example.cloudfront.net" } } : board, { fetch });
}

test("Sites proxy uses Workers-supported manual redirects and forwards no identity", async () => {
  const route = proxy(async (url, init) => {
    assert.equal(url, "https://example.cloudfront.net/api/board?room=1&after=5");
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.get("cookie"), null);
    assert.equal(init.headers.get("oai-sites-authorization"), null);
    return Response.json({ strokes: [], cursor: 5 });
  });
  const response = await route.GET(new Request("https://board.chatgpt.site/api/board?room=1&after=5", {
    headers: { cookie: "private-test", "OAI-Sites-Authorization": "Bearer private-test" },
  }));
  assert.equal(response.status, 200);
});

test("Sites proxy hashes POST bodies and refuses origin redirects", async () => {
  const stroke = { strokeId: "proxy-test", day: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), room: 1, color: "#f28eaa", size: 0.01, points: [[0.2, 0.4]] };
  const route = proxy(async (url, init) => {
    assert.match(init.headers.get("x-amz-content-sha256"), /^[a-f0-9]{64}$/);
    assert.equal(init.headers.get("origin"), null);
    assert.equal(JSON.parse(init.body).strokes[0].strokeId, "proxy-test");
    return new Response(null, { status: 302, headers: { location: "https://other.example" } });
  });
  const response = await route.POST(new Request("https://board.chatgpt.site/api/board", { method: "POST", headers: { origin: "https://board.chatgpt.site" }, body: JSON.stringify({ strokes: [stroke] }) }));
  assert.equal(response.status, 503);
});
