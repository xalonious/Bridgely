import { fetchOwnedBadgeIds, fetchOwnsGamePass } from "./roblox.js";
import { err } from "../utils/logger.js";

function logBindEvaluationError(context, error) {
  console.error(err(`[Bind Evaluation] ${context}: ${error?.stack || error}`));
}

function groupBindMatches(bind, ranks) {
  const condition = bind.criteria?.condition;
  if (condition === "MEMBER") return ranks.length > 0;
  if (condition === "EXACT") {
    const accepted = new Set(bind.criteria?.ranks ?? []);
    return ranks.some((rank) => accepted.has(rank));
  }
  if (condition === "GTE") {
    return ranks.some((rank) => rank >= bind.criteria.minRank);
  }
  if (condition === "LTE") {
    return ranks.some((rank) => rank <= bind.criteria.maxRank);
  }
  if (condition === "BETWEEN") {
    return ranks.some(
      (rank) => rank >= bind.criteria.minRank && rank <= bind.criteria.maxRank
    );
  }
  return false;
}

export async function evaluateBinds({
  binds,
  robloxUserId,
  membership,
  configuration,
  groupMembershipKnown,
  groupMembershipComplete,
}) {
  const desiredRoleIds = new Set();
  const managedRoleIds = new Set();
  const protectedRoleIds = new Set();
  const warnings = [];

  for (const bind of binds) {
    for (const roleId of bind.discordRoleIds ?? []) managedRoleIds.add(roleId);
  }
  const rankByRoleId = new Map(
    (configuration.roleMappings ?? []).map((entry) => [
      entry.robloxRoleId,
      entry.robloxRank,
    ])
  );
  const ranks = (membership?.roles ?? [])
    .map((role) => role.rank ?? rankByRoleId.get(role.robloxRoleId))
    .filter(Number.isInteger);

  for (const bind of binds.filter((entry) => entry.type === "GROUP")) {
    if (
      bind.robloxGroupId &&
      bind.robloxGroupId !== configuration.robloxGroupId
    ) {
      for (const roleId of bind.discordRoleIds) protectedRoleIds.add(roleId);
      warnings.push("A group bind belongs to a previous linked group and was left unchanged.");
    } else if (!groupMembershipKnown) {
      for (const roleId of bind.discordRoleIds) protectedRoleIds.add(roleId);
    } else if (groupBindMatches(bind, ranks)) {
      for (const roleId of bind.discordRoleIds) desiredRoleIds.add(roleId);
    } else if (!groupMembershipComplete) {
      for (const roleId of bind.discordRoleIds) protectedRoleIds.add(roleId);
    }
  }

  const badgeBinds = binds.filter((entry) => entry.type === "BADGE");
  if (badgeBinds.length) {
    try {
      const owned = await fetchOwnedBadgeIds(
        robloxUserId,
        [...new Set(badgeBinds.map((bind) => bind.assetId))]
      );
      for (const bind of badgeBinds) {
        if (owned.has(bind.assetId)) {
          for (const roleId of bind.discordRoleIds) desiredRoleIds.add(roleId);
        }
      }
    } catch (error) {
      logBindEvaluationError("Could not check badge ownership", error);
      for (const bind of badgeBinds) {
        for (const roleId of bind.discordRoleIds) protectedRoleIds.add(roleId);
      }
      warnings.push("Badge binds could not be checked, so their roles were left unchanged.");
    }
  }

  for (const bind of binds.filter((entry) => entry.type === "GAMEPASS")) {
    try {
      if (await fetchOwnsGamePass(robloxUserId, bind.assetId)) {
        for (const roleId of bind.discordRoleIds) desiredRoleIds.add(roleId);
      }
    } catch (error) {
      logBindEvaluationError(
        `Could not check game-pass ownership for ${bind.assetId}`,
        error
      );
      for (const roleId of bind.discordRoleIds) protectedRoleIds.add(roleId);
      warnings.push(
        `Game-pass bind **${bind.assetName || bind.assetId}** could not be checked, so its roles were left unchanged.`
      );
    }
  }

  return {
    desiredRoleIds,
    managedRoleIds,
    protectedRoleIds,
    warnings: [...new Set(warnings)],
  };
}
