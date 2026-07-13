const test = require("node:test");
const assert = require("node:assert/strict");
const generateHealthScore = require("../analyzer/healthScorer");

function baseScanData(overrides = {}) {
  return {
    description: "A well documented project",
    totalFiles: 10,
    classes: ["Foo"],
    functions: ["bar", "baz"],
    database_models: [],
    technologies: [],
    security_leaks: [],
    ...overrides,
  };
}

test("a clean, documented, small project scores well", () => {
  const report = generateHealthScore(baseScanData());
  assert.equal(report.grade, "A");
  assert.ok(report.score >= 90);
});

test("missing description is penalized", () => {
  const report = generateHealthScore(
    baseScanData({ description: "Description not found" }),
  );
  assert.ok(report.warnings.some((w) => w.includes("description")));
});

test("a database without an auth library is flagged as critical", () => {
  const report = generateHealthScore(
    baseScanData({ database_models: [{ database_type: "Mongoose (NoSQL)", table_name: "User" }] }),
  );
  assert.ok(report.warnings.some((w) => w.includes("CRITICAL")));
});

test("leaked secrets tank the score", () => {
  const report = generateHealthScore(
    baseScanData({
      security_leaks: [
        { type: "AWS Access Key", severity: "CRITICAL", file: "config.js", line: 4 },
      ],
    }),
  );
  assert.equal(report.grade, "F");
});
