import * as core from '@actions/core';
import * as github from '@actions/github';
import { RequestError } from '@octokit/request-error';

// ─── Types ──────────────────────────────────────────────────────────────────

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface FactorScore {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

interface PrRiskResult {
  score: number;
  level: RiskLevel;
  factors: FactorScore[];
  repo: string;
  prNumber: number;
  sha: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const COMMENT_MARKER = '<!-- koalr-deploy-risk -->';

const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function riskLevelMeetsThreshold(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_LEVEL_ORDER[level] >= RISK_LEVEL_ORDER[threshold];
}

function buildComment(result: PrRiskResult): string {
  const factorRows = result.factors
    .map((f) => `| ${f.name} | ${f.score} | ${f.detail} |`)
    .join('\n');

  return [
    COMMENT_MARKER,
    '## Koalr Deploy Risk',
    '',
    `**${result.level}** — Score: **${result.score}/100**`,
    '',
    '| Factor | Risk | Detail |',
    '|--------|------|--------|',
    factorRows,
    '',
    '---',
    '[View full dashboard](https://app.koalr.com/deploy-risk) · [Koalr](https://koalr.com)',
  ].join('\n');
}

async function postOrUpdateComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  // Find existing Koalr comment
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    core.info(`Updated existing Koalr deploy risk comment (#${existing.id})`);
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    core.info('Created new Koalr deploy risk comment');
  }
}

async function createCheckRun(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  sha: string,
  result: PrRiskResult,
): Promise<void> {
  const conclusion: 'success' | 'neutral' | 'failure' =
    result.level === 'LOW' ? 'success' : result.level === 'MEDIUM' ? 'neutral' : 'failure';

  const summary = result.factors
    .map((f) => `**${f.name}**: ${f.score}/100 — ${f.detail}`)
    .join('\n');

  await octokit.rest.checks.create({
    owner,
    repo,
    name: 'Koalr Deploy Risk',
    head_sha: sha,
    status: 'completed',
    conclusion,
    output: {
      title: `${result.level} — Score: ${result.score}/100`,
      summary,
    },
  });

  core.info(`Created check run with conclusion: ${conclusion}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  try {
    // Inputs
    const koalrApiKey = core.getInput('koalr-api-key', { required: true });
    const koalrApiUrl = core.getInput('koalr-api-url') || 'https://api.koalr.com';
    const githubToken = core.getInput('github-token', { required: true });
    const failOnRiskLevel = (core.getInput('fail-on-risk-level') || 'CRITICAL') as RiskLevel;
    const postCheckRun = core.getInput('post-check-run') !== 'false';

    // PR context
    const ctx = github.context;
    const pr = ctx.payload.pull_request;

    if (!pr) {
      core.setFailed('This action must be triggered on a pull_request event.');
      return;
    }

    const { owner, repo } = ctx.repo;
    const prNumber = pr.number as number;
    const sha = (pr.head as { sha: string }).sha;
    const title = pr.title as string;
    const body = (pr.body as string | null) ?? null;
    const additions = pr.additions as number | undefined;
    const deletions = pr.deletions as number | undefined;
    const changedFiles = pr.changed_files as number | undefined;
    const authorLogin = (pr.user as { login: string } | null)?.login;

    const octokit = github.getOctokit(githubToken);

    // Fetch changed files (paginate up to 300)
    core.info('Fetching changed files...');
    const files = await octokit.paginate(
      octokit.rest.pulls.listFiles,
      { owner, repo, pull_number: prNumber, per_page: 100 },
      (response) => response.data.map((f) => f.filename),
    );
    const limitedFiles = files.slice(0, 300);

    // Fetch reviews
    core.info('Fetching reviews...');
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    const hasReview = reviews.length > 0;
    const hasApproval = reviews.some((r) => r.state === 'APPROVED');

    // Build request payload
    const payload = {
      repo: `${owner}/${repo}`,
      prNumber,
      sha,
      // The pull_request payload carries these; the fallbacks cover a trimmed payload.
      additions: additions ?? 0,
      deletions: deletions ?? 0,
      changedFiles: changedFiles ?? limitedFiles.length,
      files: limitedFiles,
      title,
      body,
      hasReview,
      hasApproval,
      authorLogin,
    };

    // Call Koalr API
    core.info(`Calling Koalr API at ${koalrApiUrl}/api/v1/pr-risk/score ...`);
    const response = await fetch(`${koalrApiUrl}/api/v1/pr-risk/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${koalrApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      core.setFailed(`Koalr API returned ${response.status}: ${text}`);
      return;
    }

    const result = (await response.json()) as PrRiskResult;
    core.info(`Risk score: ${result.score}/100 (${result.level})`);

    // Set outputs
    core.setOutput('score', String(result.score));
    core.setOutput('level', result.level);

    // Post/update PR comment
    const commentBody = buildComment(result);
    await postOrUpdateComment(octokit, owner, repo, prNumber, commentBody);

    // Optionally create check run
    if (postCheckRun) {
      try {
        await createCheckRun(octokit, owner, repo, sha, result);
      } catch (err) {
        // Check run creation is best-effort — don't fail the action
        core.warning(
          `Could not create check run: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Fail the action if risk level meets or exceeds threshold
    if (riskLevelMeetsThreshold(result.level, failOnRiskLevel)) {
      core.setFailed(
        `Deploy risk is ${result.level} (score ${result.score}/100), which meets or exceeds the configured fail threshold of ${failOnRiskLevel}.`,
      );
    }
  } catch (err) {
    if (err instanceof RequestError) {
      core.setFailed(`GitHub API error: ${err.message}`);
    } else {
      core.setFailed(err instanceof Error ? err.message : String(err));
    }
  }
}

void run();
