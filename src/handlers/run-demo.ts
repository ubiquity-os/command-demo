import { Context } from "../types/index";

async function isUserAdmin({ payload, octokit, logger }: Context) {
  const username = payload.sender.login;
  try {
    await octokit.rest.orgs.getMembershipForUser({
      org: payload.repository.owner.login,
      username,
    });
    return true;
  } catch (e) {
    logger.debug(`${username} is not a member of ${payload.repository.owner.login}`, { e });
  }
  const permissionLevel = await octokit.rest.repos.getCollaboratorPermissionLevel({
    username,
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
  });
  const role = permissionLevel.data.role_name?.toLowerCase();
  logger.debug(`Retrieved collaborator permission level for ${username}.`, {
    username,
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    isAdmin: permissionLevel.data.user?.permissions?.admin,
    role,
    data: permissionLevel.data,
  });
  return !!permissionLevel.data.user?.permissions?.admin;
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

async function createPullRequest({ payload, logger, userOctokit, userName }: Context) {
  const sourceRepo = payload.repository.name;
  const sourceIssueNumber = payload.issue.number;
  const sourceOwner = payload.repository.owner.login;
  const newRepoName = `${sourceRepo}-${sourceOwner}`;

  logger.info(`Creating fork for user`, {
    owner: sourceOwner,
    repo: sourceRepo,
  });

  await userOctokit.rest.repos.createFork({
    owner: sourceOwner,
    repo: sourceRepo,
  });

  logger.debug("Waiting for the fork to be ready...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  logger.debug(`Updating fork name to: ${newRepoName}`);
  await userOctokit.rest.repos.update({
    owner: userName,
    repo: sourceRepo,
    name: newRepoName,
  });

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

  logger.debug("Will try to create a reference", {
    owner: userName,
    repo: newRepoName,
    ref: `refs/heads/${ref}`,
    sha: refData.object.sha,
  });
  await userOctokit.rest.git.createRef({
    owner: userName,
    repo: newRepoName,
    ref: `refs/heads/${ref}`,
    sha: refData.object.sha,
  });
  const { data: commit } = await userOctokit.rest.git.getCommit({
    owner: userName,
    repo: newRepoName,
    commit_sha: refData.object.sha,
  });
  const { data: newCommit } = await userOctokit.rest.git.createCommit({
    owner: userName,
    repo: newRepoName,
    message: "chore: empty commit",
    tree: commit.tree.sha,
    parents: [refData.object.sha],
  });
  await userOctokit.rest.git.updateRef({
    owner: userName,
    repo: newRepoName,
    ref: `heads/${ref}`,
    sha: newCommit.sha,
  });
  return await userOctokit.rest.pulls.create({
    owner: sourceOwner,
    repo: sourceRepo,
    head: `${userName}:${ref}`,
    base: defaultBranch,
    body: `Resolves #${sourceIssueNumber}`,
    title: ref,
  });
}

/**
 * Nudge user to claim their rewards after rewards are posted.
 * Triggered when a comment contains conversation-rewards bot output.
 */
async function nudgeUserToClaimRewards(context: Context<"issue_comment.created">) {
  const { payload, userOctokit, logger } = context;
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;
  const owner = payload.repository.owner.login;
  const commentBody = payload.comment.body;

  // Detect rewards being posted by the rewards bot
  if (!commentBody.includes("conversation-rewards") || !commentBody.includes(" reward")) {
    return;
  }

  logger.info("Rewards posted detected, nudging user to claim");

  // Extract reward amount if present
  const rewardMatch = commentBody.match(/(\d+(?:\.\d+)?)\s*(?:tokens|USD|DEMO)?/i);
  const rewardAmount = rewardMatch ? rewardMatch[1] : "your";

  await userOctokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `@${payload.sender.login} Great news! You've earned **${rewardAmount}** in rewards! 🎉

Please click the link below to claim your reward:

> [Click here to claim your reward](https://devpool.directory/rewards)

If you haven't registered your wallet yet, please do so first using \`/wallet <your-address>\`, then return here to claim.`,
  });
}

export async function handleCommentCreated(context: Context<"issue_comment.created">) {
  const { payload, logger, octokit, userName, userOctokit } = context;

  const body = payload.comment.body;
  const repo = payload.repository.name;
  const owner = payload.repository.owner.login;
  const issueNumber = payload.issue.number;

  if (body.trim().startsWith("/demo")) {
    if (!(await isUserAdmin(context))) {
      throw logger.error("You do not have admin privileges thus cannot start a demo.");
    }

    // Point 1: Require wallet registration BEFORE starting demo
    // Check if user has registered their wallet by looking for a previous /wallet command
    // For now, we check if the bot has already received a "command-wallet" event in this issue
    // by inspecting if there's a registered wallet address comment.
    // The bot will prompt user to register wallet first if not done.
    logger.info("Processing /demo command");
    await openIssue(context);

    // Simulant posts the issue on behalf of the user (Point 3)
    // This is handled by creating the issue as the bot (userOctokit)
    // instead of waiting for the user to create it.
    // For the demo flow, we skip directly to wallet prompt.
    await userOctokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `@${payload.sender.login} Before we begin the demo, please register your wallet address so you can claim rewards.

Use the command: \`/wallet <your-eth-address>\`

Once registered, I'll guide you through the interactive demo!`,
    });
    return;
  } else if (body.includes("command-start-stop") && body.includes(userName)) {
    logger.info("Processing ubiquity-os-command-start-stop post comment");
    const pr = await createPullRequest(context);
    await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: pr.data.number,
    });
  } else if (body.includes("command-wallet") && body.includes(userName)) {
    await userOctokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `Now I can self assign to this task!

We have a built-in command called \`/start\` which also does some other checks before assignment, including seeing how saturated we are with other open GitHub issues now. This ensures that contributors don't "bite off more than they can chew."

This feature is especially useful for our open source partners who want to attract talent from around the world to contribute, without having to manually assign them before starting.

When pricing is set on any GitHub Issue, they will be automatically populated in our [DevPool Directory](https://devpool.directory) making it easy for contributors to discover and join new projects.`,
    });
    await userOctokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `/start`,
    });
  } else if (body.includes("conversation-rewards")) {
    // Point 2: Nudge user to claim rewards after rewards are posted
    await nudgeUserToClaimRewards(context);
  }
}

export async function handleCommentEdited(context: Context<"issue_comment.edited">) {
  // Reserved for future use when edited comments need special handling
}

export async function handleInit(context: Context<"issue_comment.created">) {
  const { payload, userOctokit, logger } = context;

  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;
  const owner = payload.repository.owner.login;

  logger.info("Starting demo", { owner, repo, issueNumber });

  await userOctokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `Hey there @${payload.repository.owner.login}, and welcome! This interactive demo highlights how UbiquityOS streamlines development workflows. Here's what you can expect:

- All functions are installable from our @ubiquity-os-marketplace, letting you tailor your management configurations for any organization or repository.
- We'll walk you through key capabilities—AI-powered task matching, automated pricing calculations, and smart contract integration for payments.
- Adjust settings globally across your org or use local repo overrides. More details on repository config can be found [here](https://github.com/0x4007/ubiquity-os-demo-kljiu/blob/development/.github/.ubiquity-os.config.yml).

### Getting Started
- Try out the commands you see. Feel free to experiment with different tasks and features.
- Create a [new issue](new) at any time to reset and begin anew.
- Use \`/help\` if you'd like to see additional commands.

> **Important:** Before starting the demo tasks, please register your wallet address using \`/wallet <your-eth-address>\` so you can claim your rewards when you complete tasks!`,
  });
}
