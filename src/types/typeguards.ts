import { Context } from "./context";

export function isCommentCreatedEvent(context: Context): context is Context<"issue_comment.created"> {
  return context.eventName === "issue_comment.created";
}

export function isCommentEditedEvent(context: Context): context is Context<"issue_comment.edited"> {
  return context.eventName === "issue_comment.edited";
}

export function isLabelEvent(context: Context): context is Context<"issues.labeled"> {
  return context.eventName === "issues.labeled";
}

export function isIssueOpenedEvent(context: Context): context is Context<"issues.opened"> {
  return context.eventName === "issues.opened";
}
