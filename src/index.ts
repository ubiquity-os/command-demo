import { handleComment } from "./handlers/hello-world";
import { Context } from "./types";
import { isCommentEvent } from "./types/typeguards";

export async function runPlugin(context: Context) {
  const { logger, eventName } = context;

  if (isCommentEvent(context)) {
    return await handleComment(context);
  }

  logger.error(`Unsupported event: ${eventName}`);
}
