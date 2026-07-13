const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGithubRepoInput, isSafeGithubUsername } = require("../utils/validate");

test("accepts a full GitHub URL", () => {
  const result = parseGithubRepoInput("https://github.com/facebook/react");
  assert.deepEqual(result, { owner: "facebook", repo: "react" });
});

test("accepts a GitHub URL with a trailing .git", () => {
  const result = parseGithubRepoInput("https://github.com/facebook/react.git");
  assert.deepEqual(result, { owner: "facebook", repo: "react" });
});

test("accepts bare owner/repo shorthand", () => {
  const result = parseGithubRepoInput("facebook/react");
  assert.deepEqual(result, { owner: "facebook", repo: "react" });
});

test("rejects a single segment (no repo)", () => {
  assert.equal(parseGithubRepoInput("facebook"), null);
});

test("rejects shell-injection payloads riding along in the repo name", () => {
  // This exact shape is what used to reach execSync(`git clone ... ${tempFolder}`)
  // unescaped - it must now be rejected before we ever touch the filesystem.
  assert.equal(parseGithubRepoInput("owner/repo; rm -rf /"), null);
  assert.equal(parseGithubRepoInput("owner/$(whoami)"), null);
  assert.equal(parseGithubRepoInput("owner/repo`id`"), null);
});

test("rejects path traversal attempts", () => {
  assert.equal(parseGithubRepoInput("../../etc/passwd"), null);
  assert.equal(parseGithubRepoInput("owner/.."), null);
});

test("isSafeGithubUsername accepts normal usernames", () => {
  assert.equal(isSafeGithubUsername("torvalds"), true);
  assert.equal(isSafeGithubUsername("my-org-2"), true);
});

test("isSafeGithubUsername rejects unsafe input", () => {
  assert.equal(isSafeGithubUsername("../etc"), false);
  assert.equal(isSafeGithubUsername("name; rm -rf /"), false);
  assert.equal(isSafeGithubUsername(""), false);
});
