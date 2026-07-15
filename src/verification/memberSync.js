import { renderNicknameTemplate } from "../setup/nickname.js";
import { err } from "../utils/logger.js";

function logSyncError(context, error) {
  console.error(err(`[Verification Sync] ${context}: ${error?.stack || error}`));
}

export async function syncVerifiedMember({
  guild,
  discordUserId,
  configuration,
  profile,
  membership,
  groupMembershipKnown,
  groupRolesComplete,
  bindEvaluation,
}) {
  const member = await guild.members.fetch(discordUserId);
  await guild.roles.fetch();

  const addedRoles = [];
  const removedRoles = [];
  const warnings = [];
  const reason = `Bridgely verification for @${profile.username} (${profile.id})`;
  const roleMappings = configuration.roleMappings ?? [];
  const mappedRoleIds = new Set(
    roleMappings.map((mapping) => mapping.discordRoleId)
  );
  const desiredRoleIds = new Set([configuration.verifiedRoleId]);
  for (const roleId of bindEvaluation?.desiredRoleIds ?? []) {
    desiredRoleIds.add(roleId);
  }
  const missingBindRoleCount = [...(bindEvaluation?.managedRoleIds ?? [])]
    .filter((roleId) => !guild.roles.cache.has(roleId)).length;
  if (missingBindRoleCount) {
    warnings.push(
      `${missingBindRoleCount} Discord role(s) associated with a bind no longer exist. Ask an administrator to repair the bind with **/binds**.`
    );
  }

  const membershipRoleNames = [];
  if (groupMembershipKnown) {
    for (const robloxRole of membership?.roles ?? []) {
      const mapping = roleMappings.find(
        (entry) => entry.robloxRoleId === robloxRole.robloxRoleId
      );
      if (mapping) {
        desiredRoleIds.add(mapping.discordRoleId);
        membershipRoleNames.push(mapping.robloxRoleName || robloxRole.name);
      } else {
        warnings.push(
          `No Discord role is mapped to Roblox role ID **${robloxRole.robloxRoleId}**.`
        );
      }
    }
  }

  const rolesToAdd = [...desiredRoleIds]
    .filter((roleId) => !member.roles.cache.has(roleId))
    .map((roleId) => guild.roles.cache.get(roleId))
    .filter((role) => {
      if (!role) {
        warnings.push("A configured role no longer exists in this server.");
        return false;
      }
      return true;
    });

  const removableRoleIds = new Set();
  if (groupMembershipKnown && groupRolesComplete) {
    for (const roleId of mappedRoleIds) removableRoleIds.add(roleId);
  }
  for (const roleId of bindEvaluation?.managedRoleIds ?? []) {
    if (!bindEvaluation?.protectedRoleIds?.has(roleId)) {
      removableRoleIds.add(roleId);
    }
  }
  const rolesToRemove = [...member.roles.cache.filter(
    (role) => removableRoleIds.has(role.id) && !desiredRoleIds.has(role.id)
  ).values()];

  for (const role of rolesToAdd) {
    if (!role.editable) {
      warnings.push(`The role **${role.name}** is above Bridgely's highest role.`);
      continue;
    }
    try {
      await member.roles.add(role, reason);
      addedRoles.push(role);
    } catch (error) {
      logSyncError(`Could not add role ${role.id}`, error);
      warnings.push(`The role **${role.name}** could not be added.`);
    }
  }

  for (const role of rolesToRemove) {
    if (!role.editable) {
      warnings.push(`The outdated role **${role.name}** could not be removed.`);
      continue;
    }
    try {
      await member.roles.remove(role, reason);
      removedRoles.push(role);
    } catch (error) {
      logSyncError(`Could not remove role ${role.id}`, error);
      warnings.push(`The role **${role.name}** could not be removed.`);
    }
  }

  const nicknameEnabled = configuration.nicknameEnabled !== false;
  let nickname = member.displayName;

  if (nicknameEnabled) {
    const desiredNickname = renderNicknameTemplate(configuration.nicknameTemplate, {
      discord_username: member.user.username,
      discord_display_name: member.displayName,
      roblox_username: profile.username,
      roblox_display_name: profile.displayName,
    });
    if (desiredNickname === member.displayName) {
      nickname = desiredNickname;
    } else if (member.id === guild.ownerId) {
      warnings.push("Discord does not allow bots to change the server owner's nickname.");
    } else {
      try {
        await member.setNickname(desiredNickname, reason);
        nickname = desiredNickname;
      } catch (error) {
        logSyncError(`Could not update nickname for ${member.id}`, error);
        warnings.push("The configured nickname could not be applied.");
      }
    }
  }

  return {
    addedRoles,
    removedRoles,
    nicknameEnabled,
    nickname,
    warnings: [...new Set([...warnings, ...(bindEvaluation?.warnings ?? [])])],
    groupRoleName: groupMembershipKnown
      ? membershipRoleNames.join(", ") || "Guest / not in group"
      : "Could not be checked",
  };
}

export async function unlinkVerifiedMember({
  guild,
  discordUserId,
  configuration,
  robloxUsername,
  bindRoleIds = [],
}) {
  const member = await guild.members.fetch(discordUserId);
  await guild.roles.fetch();

  const configuredRoleIds = new Set([
    configuration.verifiedRoleId,
    ...(configuration.roleMappings ?? []).map((mapping) => mapping.discordRoleId),
    ...bindRoleIds,
  ]);
  const rolesToRemove = [...member.roles.cache.filter(
    (role) => configuredRoleIds.has(role.id)
  ).values()];
  const removedRoles = [];
  const warnings = [];
  const reason = `Bridgely unlink for @${robloxUsername}`;

  for (const role of rolesToRemove) {
    if (!role.editable) {
      warnings.push(`The role **${role.name}** could not be removed because of role hierarchy.`);
      continue;
    }
    try {
      await member.roles.remove(role, reason);
      removedRoles.push(role);
    } catch (error) {
      logSyncError(`Could not remove role ${role.id} during unlink`, error);
      warnings.push(`The role **${role.name}** could not be removed.`);
    }
  }

  return {
    removedRoles,
    warnings: [...new Set(warnings)],
  };
}
