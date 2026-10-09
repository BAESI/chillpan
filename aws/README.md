# AWS Hosting

The AWS version reuses `app/page.tsx` and `public/chillpan/`. Cloudflare Sites remains independently deployable. By default, AWS and Sites have separate databases. After copying the current drawings, set the Sites runtime variable `AWS_BOARD_ORIGIN` to the AWS HTTPS origin and deploy Sites: both URLs then share the AWS database. The old D1 data remains untouched for rollback. Do not enable forwarding until migration is complete. Old open tabs must refresh because database cursors can change.

`node aws/migrate.mjs` accepts `{sourceOrigin, sourceToken, targetOrigin}` through hidden stdin and copies today's three boards idempotently. Obtain a fresh service token from the Sites connector and keep it out of shell arguments, files, Git, and logs. Perform the cutover when nobody is drawing; writes accepted by D1 after the snapshot are not automatically mirrored. Never run the migration after Sites forwarding is enabled, as both endpoints would then address the same database.

## Deploy

Use an explicitly named personal profile, never a default/company profile:

```sh
aws login --profile chillpan-personal --region ap-northeast-2
node aws/deploy.mjs --profile chillpan-personal --account YOUR_12_DIGIT_ACCOUNT_ID
# After reviewing the validation and costs:
node aws/deploy.mjs --profile chillpan-personal --account YOUR_12_DIGIT_ACCOUNT_ID --deploy
```

The account is checked before any resource change. CloudFormation owns the infrastructure. `SiteUrl` is the initial public HTTPS URL; domain registration is separate. S3 and Lambda origins are private and accessible only through CloudFront. Existing AWS resources are not modified.

## Updates And Rollback

GitHub `BAESI/chillpan` is the source of truth. Pushing `main` does not deploy automatically. Keep AWS as the public production host and Sites as a private compatibility URL forwarding to the same board API.

For each release:

1. Make a focused change and inspect `git diff`.
2. Run `npm run test:unit`, `npx tsc --noEmit`, and `npm run build:aws`. Preview desktop/mobile before publishing UI changes.
3. Commit and push the verified revision to GitHub.
4. Deploy with the explicit personal profile/account command above. The deploy script checks the account, updates CloudFormation, uploads assets, then invalidates CloudFront.
5. Verify the public page, room switching, and shared API. Record the Git commit and deployment outcome. Publish matching Sites source when keeping that compatibility URL current.

Frontend releases do not clear DynamoDB drawings. The fixed board motto is an HTML overlay, not a stored stroke: daily reset, room switching, resize, and chalk replacement cannot erase it. Its self-hosted Nanum Pen Script font is subset to the motto; the accompanying OFL license is included in `public/chillpan/`.

For rollback, inspect the previous working commit in a separate worktree and deploy it with the same explicit account guard. Do not reset a working checkout or delete the table/bucket. Database schema changes need a separate backwards-compatible migration plan; reverting application code cannot undo a destructive migration.

The current deploy is not atomic: assets can briefly be mixed while S3 sync and cache invalidation propagate. Keep frontend/API changes compatible with already-open tabs. For larger releases, version asset filenames and retain the previous asset set before changing the HTML entrypoint.

Future CI/CD should use GitHub Actions OIDC with a narrowly scoped AWS role and a production environment approval, not long-lived AWS keys. No automatic deployment workflow or new IAM access is configured yet. Once custom domain aliases/certificates are added, manage them in CloudFormation so a later deployment preserves them.

## Budget

- DynamoDB Standard: fixed 10 read / 20 write capacity units, no automatic scaling. This fits the published 25 RCU / 25 WCU regional free allowance if other provisioned tables do not consume it. Excess demand is throttled, not scaled.
- Lambda: 128 MB ARM, 15-second timeout, three-day log retention. The initial personal account has a shared concurrency quota of 10; AWS does not permit reserving concurrency at that quota. No quota increase is requested.
- Browser synchronization: WebSocket room notifications trigger cursor-based HTTP catch-up. A 30-second reconciliation poll covers missed notifications; disconnected clients fall back to 3-second polling. Stroke chunks still flush every 600 ms or 64 points, including a held pointer's last segment. This release does not send ephemeral 100 ms previews or increase provisioned board capacity.
- API Gateway WebSocket, its notification Lambda and an on-demand connection registry add usage-based charges. Notifications are coalesced per room/stream batch; only a cursor is broadcast, not the full history. Connection routes are throttled, but this is not a global cost cap or a substitute for abuse protection.
- At most 20,000 stroke chunks per room/day. Retries are idempotent. Expired data is hidden at Korean midnight and physically removed later by DynamoDB TTL.
- CloudFront uses pay-as-you-go pricing with its applicable free allowance, not a fixed-price plan. Lambda, CDN, storage, logs, and taxes can still exceed $10 with enough traffic. This is NOT a hard spending cap. Configure AWS Budgets alerts before broad promotion; domain registration and DNS charges are separate.
- At 10,000 visitor-minutes/month, polling generates approximately 200,000 GETs, excluding drawing requests. A low-traffic launch targets under $10, not a guaranteed invoice.
- Deleting the stack retains the table and bucket to protect drawings; retained resources can continue to cost money. Remove only after review/backups.

Official pricing: [DynamoDB](https://aws.amazon.com/dynamodb/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [CloudFront](https://aws.amazon.com/cloudfront/pricing/).

## Custom Domain

Choose and register the domain separately. Create an ACM certificate in `us-east-1`, validate ownership via DNS, then add the domain alias/certificate to CloudFront and point the domain to the distribution. Never make the S3 bucket public. Domain registration renews annually; check the renewal price, not just the first-year offer.

Production domain: `chillpan.day`. Reuse the registrar-created public hosted zone `Z08700191SEVNREB4C6PA`; do not create a second zone. The `chillpan-certificate` stack in `us-east-1` manages the DNS-validated certificate using `aws/certificate.json`. Keep its validation CNAME for automatic renewal.

Initial domain attachment (certificate must be issued first):

```sh
aws cloudformation deploy --stack-name chillpan-certificate --template-file aws/certificate.json \
  --parameter-overrides DomainName=chillpan.day HostedZoneId=Z08700191SEVNREB4C6PA \
  --profile chillpan-personal --region us-east-1

node aws/deploy.mjs --profile chillpan-personal --account 862292240027 --deploy \
  --domain chillpan.day --hosted-zone Z08700191SEVNREB4C6PA \
  --certificate ISSUED_CERTIFICATE_ARN_FROM_CERTIFICATE_STACK
```

The main stack manages the CloudFront alias, SNI HTTPS certificate, and Route 53 A/AAAA alias records. Subsequent normal deploys omit these flags: CloudFormation deploy preserves the existing parameter values. The original CloudFront URL remains usable and shares the same Lambda/table. A new hostname has separate browser-local chalk/session state, but not separate shared drawings. Do not delete the certificate stack while the distribution uses it.

## Hidden Tools

Classroom share links are `/1`, `/2`, and `/3`. The path takes precedence over the last room in local storage; the selector updates browser history and back/forward switches rooms. CloudFront rewrites only those known room paths (including trailing slashes) to the static app; API and asset routing are unchanged. The private Sites mirror uses the matching dynamic page route.

New chalk rolls: normal 92%, rainbow 3%, giant 2%, eraser 2%, gold 1%. Rainbow changes palette at existing stroke chunk boundaries; gold adds one accepted ink color; giant changes cursor dimensions only. All ink keeps the fixed 5 CSS-pixel width. Discovery messages are transient and respect reduced-motion preferences.

Erasers have a separate 9,600-unit device-local budget, a shrinking rectangular cursor, and a fixed 32 CSS-pixel brush. Each pass blurs existing pigment and lifts 38% of its opacity; repeated passes clean the same area. The fixed motto is outside the drawing canvas and cannot be erased. Budgets/rolls are client-side game mechanics, not server-enforced abuse protection.

Erase actions use the optional `tool: "eraser"` stroke field and are persisted with ink in the same canonical sequence. Clients replay confirmed actions before pending local actions to reconcile concurrent drawing/erasing. AWS remains the shared source of truth; the old D1 fallback refuses erasing rather than silently saving it as ink. Already-open old clients must refresh to understand erase actions. Deploy the compatible backend before the frontend.

Canonical reconciliation maintains a persistent confirmed canvas and applies each server-ordered action once in animation-frame slices (4 ms target, at most 64 steps; erasers yield per segment). It does not pause during input or restart history when another action arrives. Changed regions are composited with optimistic local edits, preserving ink/eraser order. Room/resize changes invalidate the old layer. An acknowledged local action remains optimistic until rendered into the confirmed layer. Pointer samples are coalesced once per animation frame and flushed on pointer-up. Eraser blur operates on a separate cropped patch rather than reading and filtering its own full destination canvas.

## Realtime And Recovery

The existing HTTP POST transaction remains the durable source of truth. DynamoDB Streams triggers a notification Lambda, which sends `{day, room, cursor}` through API Gateway WebSocket to that room's active connections. Browsers do not advance their cursor from notifications: they read the ordered HTTP delta. Duplicate/out-of-order notifications are therefore harmless, and reconnect first fetches missed actions. Streams retries transient broadcast failures; periodic reconciliation also covers exhausted retries or missed connection notifications. A WebSocket message is a wake-up hint, not a durable delivery acknowledgment.

Connections validate the browser Origin and classroom, expire through TTL, and are removed on disconnect or HTTP 410 callbacks. Reconnection uses bounded exponential backoff and jitter. Heartbeats run every minute; the service's finite connection lifetime is handled by automatic reconnect. Already-open old clients keep using the compatible HTTP API.

Pending chunks use an IndexedDB outbox, written before POST and deleted after the server confirms the batch. Refreshing/closing a tab and reopening the same browser profile can resume those chunks idempotently. Legacy sessionStorage entries are migrated; unavailable IndexedDB falls back to sessionStorage with a reconnect notice. Private-mode storage restrictions, cleared browser data, an abrupt process exit before the transaction commits, and the daily board reset limit recovery guarantees. No end-to-end latency SLA is promised; the existing 600 ms chunk cadence, network latency, initial history load and fixed DynamoDB capacity still apply.

Browser QA uses `tests/browser-board-server.mjs` (localhost only, synthetic data; no writes to production) and the exported `verify(page)` in `tests/browser-checks.mjs`. It compares the previous renderer at commit `94dd8fe` with the current renderer, measures frame/long-task timing with 4x CPU slowdown, verifies no historical ink is redrawn after synchronization, and checks two-browser updates during input, reconnect, room isolation, IndexedDB recovery and mobile touch. Build AWS assets before starting the fixture. Screenshots go to `output/playwright/`.

The 2026-10-10 local run used 1,500 seeded chunks with 32 points each, including 125 erasers, at 1280x900 / 2x DPR / 4x CPU slowdown. During the drawing/reconciliation scenario, historical ink redraws fell from 2,750 to zero and eraser calls from 8,017 to 180. Both versions recorded zero >50 ms long tasks and ~16.7-16.8 ms P95 frame intervals, so this environment did not reproduce the reported intermittent stall. Initial replay took 1.85 s on the baseline and 2.65 s on the new renderer; this release improves repeated reconciliation work, not initial-history loading. Two-client notification/display measured 65 ms on localhost only, not AWS latency. Reconnect, room isolation, idempotent closed-tab outbox recovery and mobile touch passed. Device-specific performance and higher production concurrency remain unproven.

Production smoke check: `node tests/aws-live-smoke.mjs --profile YOUR_PERSONAL_PROFILE --account YOUR_ACCOUNT --run`. It checks the AWS account, connects two sockets to room 3 and one to room 2, invokes the notification Lambda with an inert cursor=0 hint, and verifies room-specific delivery without writing/erasing board data. It does not exercise an actual new DynamoDB write or measure end-to-end commit latency. The 2026-10-10 deployment passed this check; the stream mapping is enabled, CloudFront invalidation completed, and the public browser loaded the new version with an open WebSocket and no application JS errors.

## AdSense Setup

The public AWS build includes the supplied AdSense publisher ID from `aws/adsense.json`, the asynchronous AdSense script in `<head>`, a verification meta tag, and root-level `ads.txt`. The publisher ID is public, not a credential. No manual ad placements are added. The owner-private Sites preview does not load AdSense.

Normal deployments retain the configured publisher automatically. To override it for a build/deploy:

```sh
ADSENSE_CLIENT=ca-pub-YOUR_16_DIGIT_ID node aws/deploy.mjs --profile chillpan-personal --account YOUR_12_DIGIT_ACCOUNT_ID --deploy
```

Set `ADSENSE_CLIENT=""` to omit all AdSense tags and `ads.txt` from a build. Auto ads are controlled in the AdSense dashboard and may display after approval if enabled; keep them off during review and until consent/moderation and placement have been checked. After deployment, verify `https://chillpan.day/ads.txt`, then verify ownership and request review in AdSense. Generated build files are ignored by Git.

Before activation: publish accurate privacy/contact information, implement applicable consent requirements, provide reporting and moderation for user-generated drawings, and obtain AdSense approval. Unmoderated live drawings can contain policy violations; approval/revenue is not guaranteed. Ad placement must not overlap the drawing surface or encourage accidental clicks.

References: [Site verification](https://support.google.com/adsense/answer/12169212), [AdSense code](https://support.google.com/adsense/answer/9274516), [User-generated content policy](https://support.google.com/adsense/answer/1355699).
