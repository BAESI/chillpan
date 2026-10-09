import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = JSON.parse(readFileSync(new URL("../aws/template.json", import.meta.url)));
const certificate = JSON.parse(readFileSync(new URL("../aws/certificate.json", import.meta.url)));

test("custom domain uses a validated certificate, SNI and both IPv4/IPv6 aliases", () => {
  const config = template.Resources.Distribution.Properties.DistributionConfig;
  const [condition, custom, fallback] = config.ViewerCertificate["Fn::If"];
  assert.equal(condition, "HasCustomDomain");
  assert.equal(custom.SslSupportMethod, "sni-only");
  assert.equal(custom.MinimumProtocolVersion, "TLSv1.2_2021");
  assert.deepEqual(custom.AcmCertificateArn, { Ref: "CertificateArn" });
  assert.deepEqual(fallback, { CloudFrontDefaultCertificate: true });
  assert.equal(template.Resources.DomainRecords.Condition, "HasCustomDomain");
  const records = template.Resources.DomainRecords.Properties.RecordSets;
  assert.deepEqual(records.map(record => record.Type), ["A", "AAAA"]);
  for (const record of records) {
    assert.deepEqual(record.AliasTarget.DNSName, { "Fn::GetAtt": ["Distribution", "DomainName"] });
    assert.equal(record.AliasTarget.HostedZoneId, "Z2FDTNDATAQYW2");
  }
  assert.equal(template.Resources.BoardUrl.Properties.AuthType, "AWS_IAM");
  assert.equal(template.Resources.BoardTable.DeletionPolicy, "Retain");
});

test("certificate DNS validation reuses the registered hosted zone", () => {
  const props = certificate.Resources.Certificate.Properties;
  assert.equal(props.ValidationMethod, "DNS");
  assert.deepEqual(props.DomainValidationOptions, [{ DomainName: { Ref: "DomainName" }, HostedZoneId: { Ref: "HostedZoneId" } }]);
});
