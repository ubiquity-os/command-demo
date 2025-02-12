import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Context } from "../types";

async function setLabels({ payload, octokit }: Context) {
  const repo = payload.repository.name;
  const issueNumber = "issue" in payload ? payload.issue.number : payload.pull_request.number;
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
    labels: ["Priority: 1 (Normal)", "Time: <1 Hour", "Price: 12 USD"],
  });
}

async function createPullRequest({ payload, octokit }: Context) {
  const userOctokit = new customOctokit({
    auth: "",
  });
  const repo = payload.repository.name;
  const issueNumber = "issue" in payload ? payload.issue.number : payload.pull_request.number;
  const owner = payload.repository.owner.login;

  const { data: repoData } = await octokit.rest.repos.get({
    owner,
    repo,
  });
  const defaultBranch = repoData.default_branch;
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  const ref = `fix/${crypto.randomUUID()}`;

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${ref}`,
    sha: refData.object.sha,
  });
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: "test.txt",
    message: "chore: update test.txt file",
    content: Buffer.from(crypto.randomUUID()).toString("base64"),
    branch: ref,
  });
  await userOctokit.rest.pulls.create({
    owner,
    repo,
    head: ref,
    base: defaultBranch,
    body: `Resolves #${issueNumber}`,
  });
}

export async function handleComment(context: Context) {
  const { payload } = context;

  const userOctokit = new customOctokit({
    auth: "",
  });
  const repo = payload.repository.name;
  const issueNumber = "issue" in payload ? payload.issue.number : payload.pull_request.number;
  const owner = payload.repository.owner.login;
  const body = payload.comment.body;

  if (body.trim().startsWith("/demo")) {
    await setLabels(context);
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
    await createPullRequest(context);
  }
}
