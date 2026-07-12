import { DISCORD_ROLE_NAME_LIMIT } from "./constants.js";
import { SetupValidationError } from "./permissions.js";

function truncateRoleName(value, limit = DISCORD_ROLE_NAME_LIMIT) {
  return Array.from(value).slice(0, limit).join("");
}

export function validateVerifiedRoleName(input) {
  const value = String(input ?? "").trim();
  if (!value) throw new SetupValidationError("The verified role name cannot be empty.");
  if (Array.from(value).length > DISCORD_ROLE_NAME_LIMIT) {
    throw new SetupValidationError(
      `Role names cannot exceed ${DISCORD_ROLE_NAME_LIMIT} characters.`
    );
  }
  if (/^@(everyone|here)$/i.test(value)) {
    throw new SetupValidationError("The verified role cannot be named @everyone or @here.");
  }
  if (/\p{C}/u.test(value)) {
    throw new SetupValidationError("The verified role name contains unsupported control characters.");
  }
  return value;
}

export function sanitizeDiscordRoleName(input, fallback = "Roblox Role") {
  let value = String(input ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/@(everyone|here)/gi, "＠$1")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) value = fallback;
  return truncateRoleName(value);
}

export function prepareRobloxRoleNames(robloxRoles) {
  return [...robloxRoles]
    .sort((a, b) => b.rank - a.rank || a.id - b.id)
    .map((role) => ({
      ...role,
      discordName: sanitizeDiscordRoleName(role.name, "Roblox Role"),
    }));
}

export function isRoleSafelyManageable(role, botMember) {
  if (!role || !botMember || role.id === role.guild.id || role.managed) return false;
  if (botMember.roles.cache.has(role.id)) return false;
  if (role.position >= botMember.roles.highest.position) return false;
  return role.editable !== false;
}

export function collectWipeEligibleRoles(guild, botMember) {
  return guild.roles.cache
    .filter((role) => isRoleSafelyManageable(role, botMember))
    .sort((a, b) => b.position - a.position);
}

function isSafeReusableRole(role, botMember, usedRoleIds) {
  return (
    isRoleSafelyManageable(role, botMember) &&
    !usedRoleIds.has(role.id)
  );
}

function findReusableRole(guild, botMember, name, usedRoleIds) {
  return guild.roles.cache.find(
    (role) =>
      role.name === name && isSafeReusableRole(role, botMember, usedRoleIds)
  );
}

function resolveExactRoleTarget(guild, botMember, desiredName, usedRoleIds) {
  return {
    role: findReusableRole(guild, botMember, desiredName, usedRoleIds) || null,
    name: desiredName,
  };
}

export async function wipeManageableRoles(guild, botMember, reason) {
  const eligibleRoles = [...collectWipeEligibleRoles(guild, botMember).values()];
  const deletedRoleNames = [];
  const failures = [];

  for (const role of eligibleRoles) {
    try {
      await role.delete(reason);
      deletedRoleNames.push(role.name);
    } catch (error) {
      failures.push({ roleName: role.name, error });
    }
  }

  if (failures.length) {
    throw new SetupValidationError(
      `${failures.length} manageable role(s) could not be removed. Setup stopped before creating new roles.`,
      failures[0].error
    );
  }

  return deletedRoleNames;
}

export async function createOrReuseVerifiedRole({
  guild,
  botMember,
  name,
  createdRoles,
  usedRoleIds,
  reason,
}) {
  const target = resolveExactRoleTarget(
    guild,
    botMember,
    name,
    usedRoleIds
  );
  if (target.role) {
    usedRoleIds.add(target.role.id);
    return { role: target.role, created: false };
  }

  const role = await guild.roles.create({ name: target.name, reason });
  createdRoles.push(role);
  usedRoleIds.add(role.id);
  return { role, created: true };
}

export async function createOrReuseRobloxRoles({
  guild,
  botMember,
  robloxRoles,
  createdRoles,
  usedRoleIds,
  reason,
}) {
  const targets = prepareRobloxRoleNames(robloxRoles);
  const mappings = [];
  const createdGroupRoles = [];

  for (const target of targets) {
    const resolved = resolveExactRoleTarget(
      guild,
      botMember,
      target.discordName,
      usedRoleIds
    );
    let role = resolved.role;
    if (!role) {
      role = await guild.roles.create({ name: resolved.name, reason });
      createdRoles.push(role);
      createdGroupRoles.push({ role, rank: target.rank });
    }

    usedRoleIds.add(role.id);
    mappings.push({
      robloxRoleId: target.id,
      robloxRank: target.rank,
      robloxRoleName: target.name || `Roblox Role ${target.id}`,
      discordRoleId: role.id,
    });
  }

  return { mappings, createdGroupRoles };
}

function rolesFollowRobloxRankOrder(entries) {
  return entries.every((entry, index) =>
    index === 0 || entries[index - 1].role.position > entry.role.position
  );
}

function readCurrentCreatedRoles(guild, sortedEntries) {
  return sortedEntries.map((entry) => ({
    ...entry,
    role: guild.roles.cache.get(entry.role.id) || entry.role,
  }));
}

export async function positionCreatedRobloxRoles(guild, createdGroupRoles) {
  if (createdGroupRoles.length < 2) return null;

  const sorted = [...createdGroupRoles].sort((a, b) => b.rank - a.rank);

  try {
    await guild.roles.fetch();
    const current = readCurrentCreatedRoles(guild, sorted);

    if (rolesFollowRobloxRankOrder(current)) return null;

    const occupiedPositions = current
      .map(({ role }) => role.position)
      .sort((a, b) => b - a);
    const positions = current.map(({ role }, index) => ({
      role,
      position: occupiedPositions[index],
    }));

    await guild.roles.setPositions(positions);
    return null;
  } catch (error) {
    try {
      await guild.roles.fetch();
      if (rolesFollowRobloxRankOrder(readCurrentCreatedRoles(guild, sorted))) {
        return null;
      }
    } catch (verificationError) {
      error = new AggregateError(
        [error, verificationError],
        "Role positioning and follow-up verification both failed."
      );
    }

    return {
      message: "Some generated roles could not be positioned exactly by Roblox rank.",
      error,
    };
  }
}

export async function rollbackCreatedRoles(createdRoles, reason) {
  const failures = [];
  for (const role of [...createdRoles].reverse()) {
    try {
      if (role.editable) await role.delete(reason);
      else failures.push({
        roleName: role.name,
        error: new Error("Role was no longer editable during rollback."),
      });
    } catch (error) {
      failures.push({ roleName: role.name, error });
    }
  }
  return failures;
}
