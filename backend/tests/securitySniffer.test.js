const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sniffSecrets = require("../analyzer/securitySniffer");

function writeTempFile(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codeatlas-")), "fixture.js");
  fs.writeFileSync(file, contents);
  return file;
}

test("detects a real hardcoded AWS access key", () => {
  const file = writeTempFile(`const key = "AKIAABCDEFGHIJKLMNOP";\n`);
  const findings = sniffSecrets(file);
  assert.ok(findings.some((f) => f.type === "AWS Access Key"));
});

test("detects a real RSA private key header", () => {
  const file = writeTempFile(`const pem = "-----BEGIN RSA PRIVATE KEY-----";\n`);
  const findings = sniffSecrets(file);
  assert.ok(findings.some((f) => f.type === "RSA/SSH Private Key"));
});

test("detects a hardcoded password assignment", () => {
  const file = writeTempFile(`const config = { password: "hunter2ButLonger" };\n`);
  const findings = sniffSecrets(file);
  assert.ok(findings.some((f) => f.type === "Hardcoded API Token/Password"));
});

// Regression test: the RSA/SSH pattern used to be one literal PEM-header
// regex, whose own source contained a run of five hyphens next to the
// words BEGIN/PRIVATE KEY - so scanning securitySniffer.js
// itself (exactly what happens when the CI workflow audits this repo)
// flagged it as a leaked key on every single run. This must never fire on
// this file again.
test("does not flag its own source file as a leaked private key", () => {
  const ownSourcePath = path.join(__dirname, "..", "analyzer", "securitySniffer.js");
  const findings = sniffSecrets(ownSourcePath);
  const falsePositive = findings.find((f) => f.type === "RSA/SSH Private Key");
  assert.equal(falsePositive, undefined, "securitySniffer.js flagged itself as a private key leak");
});
