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

export function parseRobloxGroupId(input) {
  const value = String(input ?? "").trim();
  if (!value) throw new RobloxSetupError("Enter a Roblox group ID or group URL.");

  let idText;
  if (/^\d+$/.test(value)) {
    idText = value;
  } else {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new RobloxSetupError("Enter a numeric group ID or a valid roblox.com community URL.");
    }

    const hostname = url.hostname.toLocaleLowerCase();
    const hasValidHost = hostname === "roblox.com" || hostname === "www.roblox.com";
    if (
      url.protocol !== "https:" ||
      !hasValidHost ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new RobloxSetupError("Enter a numeric group ID or a valid roblox.com community URL.");
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const typeIndex = segments.findIndex((segment) =>
      ["communities", "groups"].includes(segment.toLocaleLowerCase())
    );
    idText = typeIndex >= 0 ? segments[typeIndex + 1] : null;

    if (!idText || !/^\d+$/.test(idText)) {
      throw new RobloxSetupError("Enter a numeric group ID or a valid roblox.com community URL.");
    }
  }

  const groupId = Number(idText);
  if (!Number.isSafeInteger(groupId) || groupId <= 0) {
    throw new RobloxSetupError("The Roblox group ID must be a positive safe integer.");
  }

  return groupId;
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
