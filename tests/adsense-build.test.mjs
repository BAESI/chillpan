import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const build = (publisher) => execFileSync(process.execPath, ["aws/build.mjs"], {
  cwd: root,
  env: { ...process.env, ADSENSE_CLIENT: publisher },
  stdio: "pipe",
});

test("AWS AdSense snippet is in head exactly once with matching ads.txt", () => {
  const { publisher } = JSON.parse(read("aws/adsense.json"));
  build(publisher);
  const html = read(".aws-build/web/index.html");
  const head = html.split("</head>")[0];
  assert.equal((html.match(/pagead\/js\/adsbygoogle\.js/g) || []).length, 1);
  assert.ok(head.includes(`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}" crossorigin="anonymous"></script>`));
  assert.ok(head.includes(`<meta name="google-adsense-account" content="${publisher}">`));
  assert.equal(read(".aws-build/web/ads.txt"), `google.com, ${publisher.slice(3)}, DIRECT, f08c47fec0942fa0\n`);
});

test("AWS AdSense can be disabled and invalid IDs are rejected", () => {
  build("");
  assert.ok(!read(".aws-build/web/index.html").includes("adsbygoogle"));
  assert.throws(() => read(".aws-build/web/ads.txt"), { code: "ENOENT" });
  assert.throws(() => build('bad"><script>'), /Invalid AdSense publisher ID/);
});
