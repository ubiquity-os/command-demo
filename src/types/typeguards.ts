import { Context } from "./context";

export function isCommentEvent(context: Context): context is Context<"issue_comment.created" | "issue_comment.edited"> {
  return context.eventName === "issue_comment.created" || context.eventName === "issue_comment.edited";
}

export function isLabelEvent(context: Context): context is Context<"issues.labeled"> {
  return context.eventName === "issues.labeled";
}
