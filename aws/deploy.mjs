import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";

const { values } = parseArgs({ options: {
  profile: { type: "string" }, account: { type: "string" },
  region: { type: "string", default: "ap-northeast-2" },
  stack: { type: "string", default: "chillpan" }, deploy: { type: "boolean", default: false },
  domain: { type: "string" }, certificate: { type: "string" }, "hosted-zone": { type: "string" },
} });
if (!values.profile || !/^\d{12}$/.test(values.account || "")) throw new Error("Explicit --profile and --account are required. Never use a company/default profile.");
const root = path.resolve(import.meta.dirname, "..");
const base = ["--profile", values.profile, "--region", values.region, "--no-cli-pager"];
const aws = (args, json = false) => {
  const output = execFileSync("aws", [...args, ...base], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return json ? JSON.parse(output) : output;
};
const identity = aws(["sts", "get-caller-identity"], true);
if (identity.Account !== values.account) throw new Error("AWS account mismatch; nothing deployed.");
const domainOptions = [values.domain, values.certificate, values["hosted-zone"]];
if (domainOptions.some(Boolean) && !domainOptions.every(Boolean)) throw new Error("Provide --domain, --certificate and --hosted-zone together.");
if (values.certificate && !values.certificate.startsWith(`arn:aws:acm:us-east-1:${values.account}:certificate/`)) throw new Error("CloudFront requires a certificate in us-east-1 in the selected account.");
const parameters = values.domain ? ["--parameter-overrides", `DomainName=${values.domain}`, `CertificateArn=${values.certificate}`, `HostedZoneId=${values["hosted-zone"]}`] : [];
execFileSync(process.execPath, ["aws/build.mjs"], { cwd: root, stdio: "inherit" });
console.log(aws(["cloudformation", "validate-template", "--template-body", "file://.aws-build/template.json"]));
if (!values.deploy) {
  console.log("Validated only. Add --deploy to create/update AWS resources (usage charges can apply).");
} else {
  console.log(aws(["cloudformation", "deploy", "--stack-name", values.stack, "--template-file", ".aws-build/template.json", "--capabilities", "CAPABILITY_IAM", "--no-fail-on-empty-changeset", ...parameters, "--tags", "Project=Chillpan"]));
  const result = aws(["cloudformation", "describe-stacks", "--stack-name", values.stack], true);
  const outputs = Object.fromEntries(result.Stacks[0].Outputs.map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
  execFileSync(process.execPath, ["aws/build.mjs"], { cwd: root, stdio: "inherit", env: { ...process.env, CHILLPAN_LIVE_URL: outputs.LiveUrl } });
  console.log(aws(["s3", "sync", ".aws-build/web", `s3://${outputs.Bucket}`, "--cache-control", "public,max-age=60", "--only-show-errors"]));
  console.log(aws(["s3", "cp", ".aws-build/web/index.html", `s3://${outputs.Bucket}/index.html`, "--content-type", "text/html; charset=utf-8", "--cache-control", "no-cache", "--only-show-errors"]));
  console.log(aws(["cloudfront", "create-invalidation", "--distribution-id", outputs.DistributionId, "--paths", "/*"]));
  console.log(JSON.stringify(outputs, null, 2));
}
