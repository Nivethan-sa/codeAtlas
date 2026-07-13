// Pulls the "living" GitHub-side structure of a repository that a local
// shallow clone can't give us: every branch, the real commit count and
// recent commit log, and open/closed/merged pull requests, plus a
// slightly richer metadata block than what server.js already grabbed
// from the initial /repos/{owner}/{repo} call.
//
// Everything here is best-effort: a rate-limited or slow GitHub API
// should never crash a scan, so every section fails independently and
// reports itself as unavailable rather than throwing.

const axios = require("axios");

const GITHUB_API = "https://api.github.com";

/** Pulls the page number out of the `rel="last"` entry of a GitHub
 * pagination Link header, e.g. `<...?page=42>; rel="last"`. Used to get
 * an exact total count (commits, branches, PRs) from a single request
 * with per_page=1, instead of paging through everything by hand. */
function lastPageFromLinkHeader(linkHeader) {
  if (!linkHeader) return 1;
  const match = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.endsWith('rel="last"'));
  if (!match) return 1;
  const pageMatch = match.match(/[?&]page=(\d+)/);
  return pageMatch ? parseInt(pageMatch[1], 10) : 1;
}

async function getBranches(owner, repo, headers) {
  try {
    const res = await axios.get(`${GITHUB_API}/repos/${owner}/${repo}/branches`, {
      headers,
      params: { per_page: 100 },
    });
    const totalBranches = lastPageFromLinkHeader(res.headers?.link) > 1
      ? (lastPageFromLinkHeader(res.headers.link) - 1) * 100 + 1 // lower-bound estimate
      : res.data.length;

    return {
      available: true,
      total_branches: res.data.length < 100 ? res.data.length : totalBranches,
      truncated: res.data.length >= 100,
      branches: res.data.map((b) => ({
        name: b.name,
        commit_sha: b.commit?.sha || null,
        protected: !!b.protected,
      })),
    };
  } catch (error) {
    return { available: false, reason: error.message, branches: [], total_branches: 0 };
  }
}

async function getCommits(owner, repo, headers, defaultBranch) {
  try {
    const [recentRes, countRes] = await Promise.all([
      axios.get(`${GITHUB_API}/repos/${owner}/${repo}/commits`, {
        headers,
        params: { sha: defaultBranch, per_page: 30 },
      }),
      axios.get(`${GITHUB_API}/repos/${owner}/${repo}/commits`, {
        headers,
        params: { sha: defaultBranch, per_page: 1 },
      }),
    ]);

    const totalCommits = lastPageFromLinkHeader(countRes.headers?.link);

    return {
      available: true,
      total_commits: totalCommits,
      recent: recentRes.data.map((c) => ({
        sha: c.sha?.slice(0, 7),
        message: (c.commit?.message || "").split("\n")[0],
        author: c.commit?.author?.name || c.author?.login || "unknown",
        date: c.commit?.author?.date || null,
        url: c.html_url,
      })),
    };
  } catch (error) {
    return { available: false, reason: error.message, total_commits: 0, recent: [] };
  }
}

async function getPullRequests(owner, repo, headers) {
  try {
    const res = await axios.get(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
      headers,
      params: { state: "all", per_page: 100, sort: "created", direction: "desc" },
    });

    const pulls = res.data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.merged_at ? "merged" : pr.state,
      author: pr.user?.login || "unknown",
      source_branch: pr.head?.ref || null,
      target_branch: pr.base?.ref || null,
      created_at: pr.created_at,
      merged_at: pr.merged_at,
      closed_at: pr.closed_at,
      url: pr.html_url,
    }));

    const counts = pulls.reduce(
      (acc, pr) => {
        acc[pr.state] = (acc[pr.state] || 0) + 1;
        return acc;
      },
      { open: 0, closed: 0, merged: 0 },
    );

    return {
      available: true,
      truncated: res.data.length >= 100,
      counts,
      pull_requests: pulls,
    };
  } catch (error) {
    return {
      available: false,
      reason: error.message,
      counts: { open: 0, closed: 0, merged: 0 },
      pull_requests: [],
    };
  }
}

/** Builds the extra metadata block from the /repos/{owner}/{repo} response
 * server.js already fetched, so this doesn't cost a second API call. */
function buildMetadata(repoApiData) {
  if (!repoApiData) return { available: false };
  return {
    available: true,
    full_name: repoApiData.full_name,
    default_branch: repoApiData.default_branch,
    stars: repoApiData.stargazers_count,
    forks: repoApiData.forks_count,
    watchers: repoApiData.subscribers_count ?? repoApiData.watchers_count,
    open_issues: repoApiData.open_issues_count,
    size_kb: repoApiData.size,
    license: repoApiData.license?.spdx_id || repoApiData.license?.name || null,
    topics: repoApiData.topics || [],
    is_fork: !!repoApiData.fork,
    is_archived: !!repoApiData.archived,
    created_at: repoApiData.created_at,
    updated_at: repoApiData.updated_at,
    pushed_at: repoApiData.pushed_at,
  };
}

/** Fetches branches, commits and pull requests concurrently and bundles
 * them with the metadata block. Never throws - each section degrades to
 * `available: false` independently on failure (rate limit, network, etc). */
async function getRepoInsights({ owner, repo, headers, defaultBranch, repoApiData }) {
  const [branches, commits, pullRequests] = await Promise.all([
    getBranches(owner, repo, headers),
    getCommits(owner, repo, headers, defaultBranch),
    getPullRequests(owner, repo, headers),
  ]);

  return {
    metadata: buildMetadata(repoApiData),
    branches,
    commits,
    pull_requests: pullRequests,
  };
}

module.exports = { getRepoInsights, getBranches, getCommits, getPullRequests, buildMetadata };
