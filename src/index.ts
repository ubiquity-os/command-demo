import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { handleCommentCreated, handleCommentEdited, handleRepositoryCreated } from "./handlers/run-demo";
import { Context } from "./types";
import { isCommentCreatedEvent, isCommentEditedEvent, isIssueOpenedEvent } from "./types/typeguards";

export async function runPlugin(context: Context) {
  const { logger, eventName } = context;

  logger.info(`Event name ${eventName}`);

  context.userOctokit = new customOctokit({
    auth: context.env.USER_GITHUB_TOKEN,
  });
  const { data: user } = await context.userOctokit.rest.users.getAuthenticated();
  context.userName = user.login;
  if (isCommentCreatedEvent(context)) {
    return await handleCommentCreated(context);
  } else if (isCommentEditedEvent(context)) {
    return await handleCommentEdited(context);
  } else if (isIssueOpenedEvent(context)) {
    return await handleRepositoryCreated(context);
  }

  logger.error(`Unsupported event: ${eventName}`);
}
