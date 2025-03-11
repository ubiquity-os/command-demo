import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Env } from "../types";

export async function acceptCollaboratorInvitation(owner: string, name: string, env: Env) {
  const userOctokit = new customOctokit({
    auth: env.USER_GITHUB_TOKEN,
  });
  const { data } = await userOctokit.rest.repos.listInvitationsForAuthenticatedUser();
  const invite = data.find((o) => o.repository.owner.login === owner && o.repository.name === name);
  if (invite?.id) {
    await userOctokit.rest.repos.acceptInvitationForAuthenticatedUser({
      invitation_id: invite.id,
    });
  }
}
