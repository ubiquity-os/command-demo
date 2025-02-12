import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { handleComment } from "./handlers/hello-world";
import { Context } from "./types";
import { isCommentEvent } from "./types/typeguards";

export async function runPlugin(context: Context) {
  const { logger, eventName } = context;

  context.userOctokit = new customOctokit({
    auth: context.env.USER_GITHUB_TOKEN,
  });

  if (isCommentEvent(context)) {
    return await handleComment(context);
  }

  logger.error(`Unsupported event: ${eventName}`);
}
