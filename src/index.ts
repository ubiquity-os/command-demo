import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { handleComment, handleLabel } from "./handlers/run-demo";
import { Context } from "./types";
import { isCommentEvent, isLabelEvent } from "./types/typeguards";

export async function runPlugin(context: Context) {
  const { logger, eventName } = context;

  context.userOctokit = new customOctokit({
    auth: context.env.USER_GITHUB_TOKEN,
  });
  const { data: user } = await context.userOctokit.rest.users.getAuthenticated();
  context.userName = user.login;
  if (isCommentEvent(context)) {
    return await handleComment(context);
  } else if (isLabelEvent(context)) {
    return await handleLabel(context);
  }

  logger.error(`Unsupported event: ${eventName}`);
}
