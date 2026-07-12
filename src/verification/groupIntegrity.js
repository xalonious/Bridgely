import GuildConfiguration from "../schemas/guildConfiguration.js";
import { fetchRobloxGroupRoles } from "../setup/roblox.js";
import {
  createOrReuseRobloxRoles,
  positionCreatedRobloxRoles,
  rollbackCreatedRoles,
  sanitizeDiscordRoleName,
} from "../setup/roles.js";
import { err, warn } from "../utils/logger.js";

const repairs = new Map();

function mappingsMatchRobloxRoles(guild, configuration, robloxRoles) {
  const mappings = configuration.roleMappings ?? [];
  if (mappings.length !== robloxRoles.length) return false;
  return robloxRoles.every((role) => {
    const mapping = mappings.find((entry) =>
      entry.robloxRoleId === role.id &&
      entry.robloxRank === role.rank &&
      entry.robloxRoleName === role.name
    );
    const discordRole = mapping
      ? guild.roles.cache.get(mapping.discordRoleId)
      : null;
    return Boolean(
      discordRole &&
      !discordRole.managed &&
      discordRole.name === sanitizeDiscordRoleName(role.name, "Roblox Role")
    );
  });
}

async function restoreRenamedRoles(renamedRoles) {
  const failures = [];
  for (const { role, oldName } of [...renamedRoles].reverse()) {
    try {
      if (role.editable) {
        await role.setName(oldName, "Rollback failed group role integrity repair");
      } else {
        failures.push(role.name);
      }
    } catch {
      failures.push(role.name);
    }
  }
  return failures;
}

async function inspectAndRepairGroupRoles(guild, configuration) {
  const reason = "Bridgely group role integrity repair";
  const createdRoles = [];
  const renamedRoles = [];
  try {
    const robloxRoles = await fetchRobloxGroupRoles(configuration.robloxGroupId);
    const latestConfiguration = await GuildConfiguration.findOne({
      guildId: configuration.guildId,
    }).lean();
    if (!latestConfiguration) {
      throw new Error("The guild configuration no longer exists.");
    }
    await guild.roles.fetch();
    if (mappingsMatchRobloxRoles(guild, latestConfiguration, robloxRoles)) {
      return { configuration: latestConfiguration, warnings: [] };
    }

    const botMember = guild.members.me || await guild.members.fetchMe();
    const usedRoleIds = new Set([latestConfiguration.verifiedRoleId]);
    const preservedMappings = new Map();

    for (const robloxRole of robloxRoles) {
      const existing = (latestConfiguration.roleMappings ?? []).find(
        (mapping) => mapping.robloxRoleId === robloxRole.id
      );
      const discordRole = existing
        ? guild.roles.cache.get(existing.discordRoleId)
        : null;
      if (
        discordRole &&
        discordRole.id !== guild.id &&
        !discordRole.managed &&
        !usedRoleIds.has(discordRole.id)
      ) {
        const desiredName = sanitizeDiscordRoleName(
          robloxRole.name,
          "Roblox Role"
        );
        if (discordRole.name !== desiredName) {
          if (!discordRole.editable) {
            throw new Error(
              `The mapped Discord role ${discordRole.name} cannot be renamed because of role hierarchy.`
            );
          }
          const oldName = discordRole.name;
          await discordRole.setName(desiredName, reason);
          renamedRoles.push({ role: discordRole, oldName });
        }

        usedRoleIds.add(discordRole.id);
        preservedMappings.set(robloxRole.id, {
          robloxRoleId: robloxRole.id,
          robloxRank: robloxRole.rank,
          robloxRoleName: robloxRole.name,
          discordRoleId: discordRole.id,
        });
      }
    }

    const rolesNeedingMappings = robloxRoles.filter(
      (role) => !preservedMappings.has(role.id)
    );
    const generated = await createOrReuseRobloxRoles({
      guild,
      botMember,
      robloxRoles: rolesNeedingMappings,
      createdRoles,
      usedRoleIds,
      reason,
    });
    const generatedByRoleId = new Map(
      generated.mappings.map((mapping) => [mapping.robloxRoleId, mapping])
    );
    const roleMappings = robloxRoles.map((role) =>
      preservedMappings.get(role.id) || generatedByRoleId.get(role.id)
    );
    if (roleMappings.some((mapping) => !mapping)) {
      throw new Error("A refreshed Roblox role could not be mapped to Discord.");
    }

    const positionResult = await positionCreatedRobloxRoles(
      guild,
      generated.createdGroupRoles
    );
    const updated = await GuildConfiguration.findOneAndUpdate(
      {
        guildId: latestConfiguration.guildId,
        robloxGroupId: latestConfiguration.robloxGroupId,
      },
      { $set: { roleMappings, updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!updated) throw new Error("The guild configuration changed during repair.");

    const warnings = [
      "The saved Roblox group roles were refreshed after a roleset change was detected.",
    ];
    if (positionResult) {
      console.warn(
        warn(`[Group Integrity] ${positionResult.message}: ${positionResult.error?.stack || positionResult.error}`)
      );
      warnings.unshift(positionResult.message);
    }
    return { configuration: updated, warnings };
  } catch (error) {
    const [rollbackFailures, renameFailures] = await Promise.all([
      rollbackCreatedRoles(
        createdRoles,
        "Rollback failed group role integrity repair"
      ),
      restoreRenamedRoles(renamedRoles),
    ]);
    if (rollbackFailures.length || renameFailures.length) {
      console.error(
        err(
          `[Group Integrity] ${rollbackFailures.length} created role(s) and ${renameFailures.length} renamed role(s) could not be rolled back.`
        )
      );
    }
    throw error;
  }
}

export async function ensureGroupRoleIntegrity({ guild, configuration }) {
  let repair = repairs.get(guild.id);
  if (!repair) {
    repair = inspectAndRepairGroupRoles(guild, configuration)
      .finally(() => repairs.delete(guild.id));
    repairs.set(guild.id, repair);
  }
  return repair;
}
