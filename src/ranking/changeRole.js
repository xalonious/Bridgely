import { canManageRole, resolveExecutor, RankingError } from "./authorization.js";
import { changeMemberRole, getMembership, isAssignableRole, RobloxError } from "./roblox.js";
import { logRankOperation } from "./audit.js";
import GuildConfiguration from "../schemas/guildConfiguration.js";
import { assertConfiguredGroup } from "../setup/groupConfiguration.js";

export function validateRoleChange({ authorization, membership, roleId, action }) {
  if (!membership) {
    throw new RankingError("target_not_member", "That Roblox account is not a member of this group.");
  }
  const role = authorization.roles.find((item) => String(item.id) === String(roleId));
  if (!isAssignableRole(role, authorization.roles)) {
    throw new RankingError("invalid_role", "That rank is no longer available.");
  }
  if (!canManageRole(authorization, role)) {
    throw new RankingError("hierarchy", "Your Roblox roles do not allow you to manage that rank.");
  }
  const held = membership.roles.includes(role.path) || membership.role === role.path;
  if (action === "add" && held) {
    throw new RankingError("already_held", "That user already has this rank.");
  }
  if (action === "remove" && !held) {
    throw new RankingError("not_held", "That user does not currently have this rank.");
  }
  return role;
}

export async function changeRobloxRole({ interaction, target, roleId, action }) {
  if (action !== "add" && action !== "remove") {
    throw new RankingError("invalid_action", "That rank action is invalid.");
  }
  const configuration = await GuildConfiguration.findOne({ guildId: interaction.guildId }).lean();
  if (!configuration) throw new RankingError("setup", "Run /setup before managing ranks in this server.");
  assertConfiguredGroup(configuration);
  if (!/^[1-9]\d*$/.test(String(roleId ?? ""))) {
    throw new RankingError("invalid_role", "That rank is invalid.");
  }
  if (!Number.isSafeInteger(Number(target.id)) || Number(target.id) <= 0) {
    throw new RankingError("invalid_target", "That Roblox account is invalid or no longer exists.");
  }
  const executor = await resolveExecutor(interaction.guildId, interaction.user.id);
  if (Number(executor.robloxUserId) === Number(target.id)) {
    throw new RankingError("self", "You cannot change your own Roblox roles.");
  }
  const membership = await getMembership(target.id);
  const role = validateRoleChange({ authorization: executor.authorization, membership, roleId, action });
  const result = await changeMemberRole(action, membership, role);
  const nowHeld = result.roles?.includes(role.path) || result.role === role.path;
  if (nowHeld !== (action === "add") || result.user !== membership.user) {
    throw new RobloxError("Roblox did not confirm the requested role state.");
  }
  await logRankOperation({ interaction, action, executor, target, role });
  return { role, executor, target, membership: result };
}
