import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import type { ActionInputs, SyncSummary } from './sources/types';
import { generatePrBody, generateCommitMessage } from './report';

/**
 * Result of PR creation
 */
export interface PrResult {
  created: boolean;
  number?: number;
  url?: string;
  isDraft: boolean;
}

/**
 * Run a git command
 */
async function git(...args: string[]): Promise<string> {
  let output = '';
  
  await exec.exec('git', args, {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  
  return output.trim();
}

/**
 * Check if there are any uncommitted changes
 * Currently unused but kept for potential future use
 */
// async function hasUncommittedChanges(): Promise<boolean> {
//   const status = await git('status', '--porcelain');
//   return status.length > 0;
// }

/**
 * Configure git user for commits
 */
async function configureGit(): Promise<void> {
  await git('config', 'user.name', 'github-actions[bot]');
  await git('config', 'user.email', 'github-actions[bot]@users.noreply.github.com');
}

/**
 * Create an empty commit (for when all files failed)
 */
async function createEmptyCommit(message: string): Promise<void> {
  await git('commit', '--allow-empty', '-m', message);
}

/**
 * Create and push a branch with changes
 */
async function createBranch(
  branchName: string,
  commitMessage: string,
  summary: SyncSummary
): Promise<void> {
  await configureGit();

  // Create and checkout branch
  await git('checkout', '-b', branchName);

  if (summary.hasChanges) {
    // Stage all changes
    await git('add', '-A');
    await git('commit', '-m', commitMessage);
  } else if (summary.allFailed) {
    // Create empty commit for failed sync
    await createEmptyCommit(commitMessage);
  }

  // Push the branch
  await git('push', '-u', 'origin', branchName, '--force');
}

/**
 * Create a pull request using the GitHub API
 */
async function createPullRequest(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body: string,
  labels: string[],
  isDraft: boolean
): Promise<{ number: number; url: string }> {
  // Create the PR
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: branchName,
    base: baseBranch,
    draft: isDraft,
  });

  // Add labels if any
  if (labels.length > 0) {
    try {
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: pr.number,
        labels,
      });
    } catch (error) {
      // Labels might not exist, log warning but don't fail
      core.warning(
        `Failed to add labels: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    number: pr.number,
    url: pr.html_url,
  };
}

/**
 * Get the default branch of the repository
 */
async function getDefaultBranch(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string
): Promise<string> {
  const { data: repository } = await octokit.rest.repos.get({
    owner,
    repo,
  });
  return repository.default_branch;
}

/**
 * Check if a PR already exists for the branch
 */
async function findExistingPr(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  branchName: string
): Promise<{ number: number; url: string } | null> {
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branchName}`,
    state: 'open',
  });

  if (prs.length > 0) {
    return {
      number: prs[0].number,
      url: prs[0].html_url,
    };
  }

  return null;
}

/**
 * Update an existing PR
 */
async function updatePullRequest(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
  body: string
): Promise<void> {
  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    title,
    body,
  });
}

/**
 * Create or update a PR with the sync results
 */
export async function createOrUpdatePr(
  inputs: ActionInputs,
  summary: SyncSummary
): Promise<PrResult> {
  const { githubToken, prTitle, prLabels, prBranch, commitMessage } = inputs;
  
  const context = github.context;
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const runId = context.runId;

  // Generate branch name with run ID for uniqueness
  const branchName = `${prBranch}/${runId}`;
  
  // Determine if this should be a draft PR
  const isDraft = summary.allFailed;

  // Generate PR body and commit message
  const prBody = generatePrBody(summary);
  const finalCommitMessage = generateCommitMessage(summary, commitMessage);

  const octokit = github.getOctokit(githubToken);

  // Get default branch for PR base
  const baseBranch = await getDefaultBranch(octokit, owner, repo);
  
  core.info(`Creating branch: ${branchName}`);
  core.info(`Base branch: ${baseBranch}`);
  core.info(`Draft PR: ${isDraft}`);

  // Create branch and push
  await createBranch(branchName, finalCommitMessage, summary);

  // Check for existing PR
  const existingPr = await findExistingPr(octokit, owner, repo, branchName);
  
  if (existingPr) {
    core.info(`Updating existing PR #${existingPr.number}`);
    await updatePullRequest(octokit, owner, repo, existingPr.number, prTitle, prBody);
    
    return {
      created: false,
      number: existingPr.number,
      url: existingPr.url,
      isDraft,
    };
  }

  // Create new PR
  core.info(`Creating new PR`);
  const pr = await createPullRequest(
    octokit,
    owner,
    repo,
    branchName,
    baseBranch,
    prTitle,
    prBody,
    prLabels,
    isDraft
  );

  core.info(`Created PR #${pr.number}: ${pr.url}`);

  return {
    created: true,
    number: pr.number,
    url: pr.url,
    isDraft,
  };
}

/**
 * Determine if a PR should be created based on summary
 */
export function shouldCreatePr(summary: SyncSummary): boolean {
  // Create PR if there are changes OR if all files failed (draft PR)
  return summary.hasChanges || summary.allFailed;
}
