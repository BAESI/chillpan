# Chillpan

AWS hosting, personal-account deployment, custom domains, cost limits, and AdSense verification are documented in [aws/README.md](aws/README.md). Run `npm run build:aws` to build the AWS version and `npm run test:unit` for browser-rendering and AWS-store regression tests.

A shared daily chalkboard with three classrooms. Strokes are appended to Cloudflare D1 and synchronized between visitors by polling. Every room resets at midnight in Asia/Seoul. Chalk color and remaining length are device preferences; drawings are server data.

The canvas UI is in `public/chillpan/`. `app/api/board/route.ts` serves shared strokes. Falling dust uses a separate transient canvas; Web Audio synthesizes chalk friction after a user gesture.

## Local Development

Install with the Sites dependency helper, then build with the Sites build helper (or `npm run build`). Apply the generated migration once:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_lethal_bedlam.sql
npm start -- --port 4173
```

With the local server running, run `node --test tests/shared-board.test.mjs`. These tests write only to the loopback preview database. `npx tsc --noEmit` checks TypeScript.

Pending writes survive reloads within a browser tab and retry on connection failure. POST requests use unique stroke IDs so retries cannot duplicate strokes. Each board is isolated by day and room. The API returns only the current day's strokes; bounded cleanup removes expired strokes during later writes.

Sites preserves the existing access policy. Sharing board data does not itself change who can open the Site.
