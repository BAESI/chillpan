import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".aws-build");
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "web"), { recursive: true });
await build({ entryPoints: [path.join(root, "app/page.tsx")], outfile: path.join(out, "page.mjs"),
  bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic" });
const { default: Page } = await import(pathToFileURL(path.join(out, "page.mjs")));
const publisher = process.env.ADSENSE_CLIENT || "";
if (publisher && !/^ca-pub-\d{16}$/.test(publisher)) throw new Error("Invalid AdSense publisher ID");
const verification = publisher ? `<meta name="google-adsense-account" content="${publisher}">` : "";
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Chillpan</title><meta name="description" content="A shared daily chalkboard."><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/chillpan/styles.css">${verification}</head><body data-sync-ms="3000" data-stroke-ms="600">${renderToStaticMarkup(createElement(Page))}<script type="module" src="/chillpan/app.js"></script></body></html>`;
await writeFile(path.join(out, "web/index.html"), html);
await cp(path.join(root, "public/chillpan"), path.join(out, "web/chillpan"), { recursive: true });
await cp(path.join(root, "public/favicon.svg"), path.join(out, "web/favicon.svg"));
if (publisher) await writeFile(path.join(out, "web/ads.txt"), `google.com, ${publisher.slice(3)}, DIRECT, f08c47fec0942fa0\n`);
const template = JSON.parse(await readFile(path.join(root, "aws/template.json"), "utf8"));
template.Resources.BoardFunction.Properties.Code.ZipFile = await readFile(path.join(root, "aws/handler.cjs"), "utf8");
await writeFile(path.join(out, "template.json"), JSON.stringify(template, null, 2));
console.log("AWS static assets and CloudFormation template built in .aws-build");
