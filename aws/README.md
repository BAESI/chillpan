# AWS Hosting

The AWS version reuses `app/page.tsx` and `public/chillpan/`. Cloudflare Sites remains independently deployable. AWS and Sites have separate board databases; they do not automatically synchronize.

## Deploy

Use an explicitly named personal profile, never a default/company profile:

```sh
aws login --profile chillpan-personal --region ap-northeast-2
node aws/deploy.mjs --profile chillpan-personal --account YOUR_12_DIGIT_ACCOUNT_ID
# After reviewing the validation and costs:
node aws/deploy.mjs --profile chillpan-personal --account YOUR_12_DIGIT_ACCOUNT_ID --deploy
```

The account is checked before any resource change. CloudFormation owns the infrastructure. `SiteUrl` is the initial public HTTPS URL; domain registration is separate. S3 and Lambda origins are private and accessible only through CloudFront. Existing AWS resources are not modified.

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

## AdSense Preparation

Advertising is disabled. No fake publisher ID, tracking script, or ad placement is shipped.

Once an AdSense account exists, build/deploy with the real publisher ID:

```sh
ADSENSE_CLIENT=ca-pub-YOUR_16_DIGIT_ID node aws/deploy.mjs --profile chillpan-personal --account YOUR_12_DIGIT_ACCOUNT_ID --deploy
```

This adds only the `google-adsense-account` verification meta tag and `ads.txt`. It does NOT activate advertisements. Keep the environment variable set on subsequent deployments; generated files are ignored by Git.

Before activation: publish accurate privacy/contact information, implement applicable consent requirements, provide reporting and moderation for user-generated drawings, and obtain AdSense approval. Unmoderated live drawings can contain policy violations; approval/revenue is not guaranteed. Ad placement must not overlap the drawing surface or encourage accidental clicks.

References: [Site verification](https://support.google.com/adsense/answer/12169212), [AdSense code](https://support.google.com/adsense/answer/9274516), [User-generated content policy](https://support.google.com/adsense/answer/1355699).
