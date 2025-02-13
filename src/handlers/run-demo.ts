import { Context } from "../types";

async function setLabels({ payload, octokit }: Context) {
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;
  const owner = payload.repository.owner.login;
  await octokit.rest.issues.removeAllLabels({
    owner,
    repo,
    issue_number: issueNumber,
  });
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: ["Priority: 1 (Normal)", "Time: <1 Hour"],
  });
}

async function openIssue({ octokit, payload }: Context): Promise<void> {
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;
  const owner = payload.repository.owner.login;
  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: "open",
  });
}

async function createPullRequest({ payload, logger, userOctokit }: Context) {
  const sourceRepo = payload.repository.name;
  const sourceIssueNumber = payload.issue.number;
  const sourceOwner = payload.repository.owner.login;

  const { data: user } = await userOctokit.rest.users.getAuthenticated();
  logger.info(`Creating fork for user: ${user.login}`);

  await userOctokit.rest.repos.createFork({
    owner: sourceOwner,
    repo: sourceRepo,
  });

  logger.debug("Waiting for the fork to be ready...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const { data: repoData } = await userOctokit.rest.repos.get({
    owner: sourceOwner,
    repo: sourceRepo,
  });
  const defaultBranch = repoData.default_branch;
  logger.debug("Repository data", { defaultBranch, repoUrl: repoData.html_url });
  const { data: refData } = await userOctokit.rest.git.getRef({
    owner: sourceOwner,
    repo: sourceRepo,
    ref: `heads/${defaultBranch}`,
  });
  const ref = `fix/${crypto.randomUUID()}`;

  await userOctokit.rest.git.createRef({
    owner: user.login,
    repo: sourceRepo,
    ref: `refs/heads/${ref}`,
    sha: refData.object.sha,
  });
  const { data: commit } = await userOctokit.rest.git.getCommit({
    owner: user.login,
    repo: sourceRepo,
    commit_sha: refData.object.sha,
  });
  const { data: newCommit } = await userOctokit.rest.git.createCommit({
    owner: user.login,
    repo: sourceRepo,
    message: "chore: empty commit",
    tree: commit.tree.sha,
    parents: [refData.object.sha],
  });
  await userOctokit.rest.git.updateRef({
    owner: user.login,
    repo: sourceRepo,
    ref: `heads/${ref}`,
    sha: newCommit.sha,
  });
  return await userOctokit.rest.pulls.create({
    owner: sourceOwner,
    repo: sourceRepo,
    head: `${user.login}:${ref}`,
    base: defaultBranch,
    body: `Resolves #${sourceIssueNumber}`,
    title: ref,
  });
}

export async function handleComment(context: Context<"issue_comment.created">) {
  const { payload, logger, octokit, config } = context;

  const body = payload.comment.body;
  const repo = payload.repository.name;
  const owner = payload.repository.owner.login;

  if (body.trim().startsWith("/demo")) {
    logger.info("Processing /demo command");
    await openIssue(context);
    await setLabels(context);
  } else if (body.includes("ubiquity-os-command-start-stop") && body.includes(config.userName)) {
    logger.info("Processing ubiquity-os-command-start-stop post comment");
    const pr = await createPullRequest(context);
    await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: pr.data.number,
    });
  }
}

export async function handleLabel(context: Context<"issues.labeled">) {
  const { payload, userOctokit, logger } = context;

  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;
  const owner = payload.repository.owner.login;
  const label = payload.label;

  if (label?.name.startsWith("Price")) {
    logger.info("Handle pricing label set", { label });
    await userOctokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: "/start",
    });
    await userOctokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: "/ask Can you help me solving this task by showing the code I should change?",
    });
  }
}
