import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { handleCommentCreated, handleCommentEdited } from "./handlers/run-demo";
import { Context } from "./types/index";
import { isCommentCreatedEvent, isCommentEditedEvent } from "./types/typeguards";

export async function runPlugin(context: Context) {
  const { logger, eventName } = context;

  context.userOctokit = new customOctokit({
    auth: context.env.USER_GITHUB_TOKEN,
  });
  const { data: user } = await context.userOctokit.rest.users.getAuthenticated();
  context.userName = user.login;
  if (isCommentCreatedEvent(context)) {
    return await handleCommentCreated(context);
  } else if (isCommentEditedEvent(context)) {
    return await handleCommentEdited(context);
  }

  logger.error(`Unsupported event: ${eventName}`);
}
