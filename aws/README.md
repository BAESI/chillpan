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
- Browser synchronization: every 3 seconds while foregrounded; slower in background. Stroke chunks flush every 600 ms or 64 points.
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

## AdSense Preparation

Advertising is disabled. No fake publisher ID, tracking script, or ad placement is shipped.

Once an AdSense account exists, build/deploy with the real publisher ID:

```sh
ADSENSE_CLIENT=ca-pub-YOUR_16_DIGIT_ID node aws/deploy.mjs --profile chillpan-personal --account YOUR_12_DIGIT_ACCOUNT_ID --deploy
```

This adds only the `google-adsense-account` verification meta tag and `ads.txt`. It does NOT activate advertisements. Keep the environment variable set on subsequent deployments; generated files are ignored by Git.

Before activation: publish accurate privacy/contact information, implement applicable consent requirements, provide reporting and moderation for user-generated drawings, and obtain AdSense approval. Unmoderated live drawings can contain policy violations; approval/revenue is not guaranteed. Ad placement must not overlap the drawing surface or encourage accidental clicks.

References: [Site verification](https://support.google.com/adsense/answer/12169212), [AdSense code](https://support.google.com/adsense/answer/9274516), [User-generated content policy](https://support.google.com/adsense/answer/1355699).
