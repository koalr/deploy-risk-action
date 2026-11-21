# Koalr Deploy Risk Action

Scores your pull request for deployment risk and posts the results as a PR comment (and optional GitHub Check Run). Powered by the Koalr risk model — the same engine behind the Koalr deploy risk dashboard.

## Quick Start

Add the following to `.github/workflows/koalr-deploy-risk.yml` in your repository:

```yaml
name: Koalr Deploy Risk

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  checks: write

jobs:
  deploy-risk:
    runs-on: ubuntu-latest
    steps:
      - uses: koalr/deploy-risk-action@v1
        with:
          koalr-api-key: ${{ secrets.KOALR_API_KEY }}
```

## Inputs

| Input                | Required | Default                 | Description                                                                                                                             |
| -------------------- | -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `koalr-api-key`      | Yes      | —                       | Koalr API key (starts with `koalr_`). Generate one in Koalr → Settings → API Keys. Grant the `read:deploy-risk` scope.                  |
| `koalr-api-url`      | No       | `https://api.koalr.com` | Override for self-hosted or staging environments.                                                                                       |
| `github-token`       | No       | `${{ github.token }}`   | GitHub token used to post PR comments and create check runs. The default workflow token works for most repos.                           |
| `fail-on-risk-level` | No       | `CRITICAL`              | Fail the workflow step if risk reaches this level. Valid values: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. Set to `HIGH` for stricter gates. |
| `post-check-run`     | No       | `true`                  | Create a GitHub Check Run (visible in the PR Checks tab) in addition to the PR comment.                                                 |

## Outputs

| Output  | Description                                        |
| ------- | -------------------------------------------------- |
| `score` | Numeric risk score, 0–100                          |
| `level` | Risk level: `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL` |

## Required Permissions

```yaml
permissions:
  pull-requests: write # post/update the risk comment
  checks: write # create the check run (if post-check-run: true)
```

## What It Scores

The action evaluates six risk factors:

- **Change Size** — lines added + deleted (research-backed thresholds)
- **File Count** — number of files changed
- **Review Coverage** — approved / reviewed / no review
- **Change Entropy** — how many subsystems are touched (Vista research: 5+ subsystems = 90%+ defect rate)
- **DB Migration** — detects SQL migrations, Prisma migrations, Alembic, Flyway, Liquibase, etc.
- **Description Risk** — risky language patterns (hotfix, yolo, bypass, untested, etc.)

Each factor is weighted and combined into a 0–100 composite score:

| Score  | Level    |
| ------ | -------- |
| 0–39   | LOW      |
| 40–69  | MEDIUM   |
| 70–84  | HIGH     |
| 85–100 | CRITICAL |

DB migrations are a hard gate: any detected migration file raises the score to at least 80 (HIGH).

## Example PR Comment

```
## Koalr Deploy Risk

**MEDIUM** — Score: **67/100**

| Factor | Risk | Detail |
|--------|------|--------|
| Change Size | 45 | 320 lines changed (290+ 30-) |
| File Count | 25 | 12 files changed |
| Review Coverage | 30 | Review pending |
| Change Entropy | 80 | 5 subsystems (apps/api, apps/web, packages/db, ...) |
| DB Migration | 0 | No migration |
| Description Risk | 0 | No risk keywords |

---
[View full dashboard](https://app.koalr.com/deploy-risk) · [Koalr](https://koalr.com)
```

## More

- Dashboard: [app.koalr.com/deploy-risk](https://app.koalr.com/deploy-risk)
- Website: [koalr.com](https://koalr.com)
