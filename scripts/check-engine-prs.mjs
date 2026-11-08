// A pre-existing Dependabot PR may still include Electron after its config changes.
// Read lockfiles only; never check out or execute code from those branches.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkEnginePrs({ repo = process.env.GH_REPO, token = process.env.GH_TOKEN, fetchImpl = fetch } = {}) {
  if (!repo || !token) throw new Error('GH_REPO and GH_TOKEN are required');
  async function github(endpoint) {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub ${endpoint}: HTTP ${response.status}`);
    return response.json();
  }
  async function engineAt(sha) {
    const file = await github(`contents/package-lock.json?ref=${sha}`);
    const lock = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    const version = lock.packages?.['node_modules/electron']?.version;
    if (!version) throw new Error(`Cannot read the Electron version at ${sha}`);
    return version;
  }
  for (let page = 1; ; page++) {
    const prs = await github(`pulls?state=open&base=main&per_page=100&page=${page}`);
    for (const pr of prs) {
      if (pr.user.login !== 'dependabot[bot]') continue;
      // Compare the PR's own base, not current main; stale unrelated PRs are not engine upgrades.
      const [before, after] = await Promise.all([engineAt(pr.base.sha), engineAt(pr.head.sha)]);
      if (before !== after) {
        throw new Error(`An existing Dependabot PR also changes Electron: ${pr.html_url}. Merge or close it, then rerun Update engine.`);
      }
    }
    if (prs.length < 100) break;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkEnginePrs();
}
