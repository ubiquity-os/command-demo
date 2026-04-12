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

/**
 * Updates issue labels to ensure reward pricing exceeds $150.
 * Removes lower price labels and sets Price: 200 USD.
 */
async function updateRewardLabels(context: Context): Promise<void> {
  const { octokit, payload, logger } = context;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;

  const { data: currentLabels } = await octokit.rest.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const labelsToKeep = currentLabels.map((label: { name: string }) => label.name).filter((name: string) => !name.startsWith("Price:"));

  labelsToKeep.push("Price: 200 USD");

  logger.info("Updating reward labels for demo", {
    oldLabels: currentLabels.map((label: { name: string }) => label.name),
    newLabels: labelsToKeep,
  });

  await octokit.rest.issues.setLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: labelsToKeep,
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
    logger.info("Processing /demo command");
    await openIssue(context);
    await updateRewardLabels(context);
    await handleInit(context);
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
  }
}

export async function handleCommentEdited(context: Context<"issue_comment.edited">) {
  const { eventName, payload, octokit, logger } = context;

  const body = payload.comment.body;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;

  if (eventName === "issue_comment.edited" && body.includes("ubiquity-os-marketplace/text-conversation-rewards")) {
    logger.info("Detected text-conversation-rewards comment, nudging user to claim rewards");

    // Extract reward amount from the comment if available
    const rewardMatch = /([$])([\d,.]+)/.exec(body);
    const rewardAmount = rewardMatch ? rewardMatch[2] : "your rewards";

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: [
        `🎉 **Your rewards are ready to claim!**`,
        ``,
        `You've earned ${rewardAmount} in DEMO currency. Here's how to claim:`,
        ``,
        `1. Click the permit link in the reward comment above`,
        `2. Connect your registered wallet (the one you set up at the start of the demo)`,
        `3. Claim your reward — it's that simple!`,
        ``,
        `> 💡 If you haven't registered your wallet yet, you can do so by commenting \`/wallet <your-address>\` below.`,
        ``,
        `[Claim your reward here](https://pay.ubq.fi)`,
      ].join("\n"),
    });
  }
}

export async function handleInit(context: Context<"issue_comment.created">) {
  const { payload, userOctokit, octokit, logger } = context;

  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;
  const owner = payload.repository.owner.login;

  logger.info("Starting demo", { owner, repo, issueNumber });

  // Simulant posts the welcome message (privacy: avoids posting on behalf of user)
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: [
      `Hey there @${payload.repository.owner.login}, and welcome! This interactive demo highlights how UbiquityOS streamlines development workflows. Here's what you can expect:`,
      ``,
      `- All functions are installable from our @ubiquity-os-marketplace, letting you tailor your management configurations for any organization or repository.`,
      `- We'll walk you through key capabilities—AI-powered task matching, automated pricing calculations, and smart contract integration for payments.`,
      `- Adjust settings globally across your org or use local repo overrides. More details on repository config can be found [here](https://github.com/0x4007/ubiquity-os-demo-kljiu/blob/development/.github/.ubiquity-os.config.yml).`,
      ``,
      `### Getting Started`,
      `- Try out the commands you see. Feel free to experiment with different tasks and features.`,
      `- Create a [new issue](new) at any time to reset and begin anew.`,
      `- Use \`/help\` if you'd like to see additional commands.`,
      ``,
      `Enjoy the tour!`,
    ].join("\n"),
  });

  // Step 1: Wallet registration prompt before starting the demo
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: [
      `### 🔑 Step 1: Register Your Wallet`,
      ``,
      `Before we begin the demo, you need to register a wallet address to receive **DEMO currency rewards**. This is the address where your earned rewards will be sent.`,
      ``,
      `You can use any Ethereum-compatible wallet address. If you don't have one, we'll generate one for you during the demo.`,
      ``,
      `Registering now ensures you can claim your rewards as soon as they're posted!`,
    ].join("\n"),
  });

  await userOctokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `The first step is for me to register my wallet address to collect rewards.`,
  });
  await userOctokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `/wallet 0xefC0e701A824943b469a694aC564Aa1efF7Ab7dd`,
  });
}
