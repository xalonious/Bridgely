import { fetchApi, isAnyErrorResponse } from "rozod";
import {
  getGroupsGroupid,
  getGroupsGroupidRoles,
} from "rozod/endpoints/groupsv1";

export class RobloxSetupError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "RobloxSetupError";
  }
}

export async function fetchRobloxGroup(groupId) {
  try {
    const group = await fetchApi(getGroupsGroupid, { groupId });
    if (isAnyErrorResponse(group) || !group || group.id !== groupId || !group.name) {
      throw new RobloxSetupError("That Roblox group does not exist or is unavailable.");
    }

    return {
      id: group.id,
      name: group.name,
      ownerName: group.owner?.username || group.owner?.displayName || null,
      ownerId: group.owner?.userId || null,
      memberCount: Number.isSafeInteger(group.memberCount) ? group.memberCount : null,
    };
  } catch (error) {
    if (error instanceof RobloxSetupError) throw error;
    throw new RobloxSetupError("Roblox could not be reached. Please try again shortly.", error);
  }
}

export async function fetchRobloxGroupRoles(groupId) {
  try {
    const response = await fetchApi(getGroupsGroupidRoles, { groupId });
    if (isAnyErrorResponse(response) || !Array.isArray(response?.roles)) {
      throw new RobloxSetupError("The Roblox group's roles could not be loaded.");
    }

    return response.roles
      .filter((role) =>
        Number.isSafeInteger(role.id) &&
        Number.isInteger(role.rank) &&
        role.rank > 0 &&
        !role.isBase
      )
      .map((role) => ({
        id: role.id,
        rank: role.rank,
        name: String(role.name ?? ""),
      }))
      .sort((a, b) => b.rank - a.rank || a.id - b.id);
  } catch (error) {
    if (error instanceof RobloxSetupError) throw error;
    throw new RobloxSetupError("Roblox could not be reached. Please try again shortly.", error);
  }
}
