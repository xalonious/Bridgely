import { fetchApi, isAnyErrorResponse } from "rozod";
import {
  getUsersUserid,
  postUsernamesUsers,
} from "rozod/endpoints/usersv1";
import { getUsersUseridGroupsRoles } from "rozod/endpoints/groupsv1";
import { getUsersAvatarHeadshot } from "rozod/endpoints/thumbnailsv1";
import { getCloudV2GroupsGroupIdMemberships } from "rozod/opencloud/v2/cloud";

export class VerificationRobloxError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = "VerificationRobloxError";
    this.code = code;
  }
}

export function normalizeRobloxUsername(input) {
  const username = String(input ?? "").trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    throw new VerificationRobloxError(
      "Enter a valid Roblox username between 3 and 20 characters.",
      "INVALID_USERNAME"
    );
  }
  return username;
}

export async function resolveRobloxUsername(input) {
  const username = normalizeRobloxUsername(input);

  try {
    const response = await fetchApi(
      postUsernamesUsers,
      {
        body: {
          usernames: [username],
          excludeBannedUsers: true,
        },
      },
      { retries: 2, retryDelay: 500 }
    );

    if (isAnyErrorResponse(response)) {
      throw new VerificationRobloxError(
        "Roblox could not resolve that username. Please try again shortly.",
        "UNAVAILABLE"
      );
    }

    const user = response?.data?.[0];
    if (!user || !Number.isSafeInteger(user.id) || !user.name) {
      throw new VerificationRobloxError(
        "No Roblox account was found with that username.",
        "NOT_FOUND"
      );
    }

    return {
      id: user.id,
      username: user.name,
      displayName: user.displayName || user.name,
    };
  } catch (error) {
    if (error instanceof VerificationRobloxError) throw error;
    throw new VerificationRobloxError(
      "Roblox could not be reached. Please try again shortly.",
      "UNAVAILABLE",
      error
    );
  }
}

export async function fetchRobloxProfile(userId) {
  try {
    const response = await fetchApi(
      getUsersUserid,
      { userId },
      { retries: 2, retryDelay: 500 }
    );

    if (
      isAnyErrorResponse(response) ||
      !response ||
      response.id !== userId ||
      typeof response.description !== "string"
    ) {
      throw new VerificationRobloxError(
        "The Roblox profile could not be checked. Please try again shortly.",
        "UNAVAILABLE"
      );
    }

    return {
      id: response.id,
      username: response.name,
      displayName: response.displayName || response.name,
      description: response.description,
    };
  } catch (error) {
    if (error instanceof VerificationRobloxError) throw error;
    throw new VerificationRobloxError(
      "Roblox could not be reached. Please try again shortly.",
      "UNAVAILABLE",
      error
    );
  }
}

export async function fetchRobloxHeadshot(userId) {
  try {
    const response = await fetchApi(
      getUsersAvatarHeadshot,
      {
        userIds: [userId],
        size: "180x180",
        format: "Png",
        isCircular: false,
      },
      { retries: 2, retryDelay: 500 }
    );

    if (isAnyErrorResponse(response)) {
      throw new Error("Roblox returned a thumbnail API error.");
    }

    const thumbnail = response?.data?.find(
      (entry) => entry.targetId === userId && entry.state === "Completed"
    );
    if (!thumbnail?.imageUrl) return null;

    const url = new URL(thumbnail.imageUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch (error) {
    throw new VerificationRobloxError(
      "The Roblox avatar headshot could not be loaded.",
      "THUMBNAIL_UNAVAILABLE",
      error
    );
  }
}

function parseCloudRoleId(path, groupId) {
  const match = String(path ?? "").match(/^groups\/(\d+)\/roles\/(\d+)$/);
  if (!match || Number(match[1]) !== groupId) return null;
  const roleId = Number(match[2]);
  return Number.isSafeInteger(roleId) ? roleId : null;
}

async function fetchOpenCloudGroupMembership(userId, groupId) {
  const response = await fetchApi(
    getCloudV2GroupsGroupIdMemberships,
    {
      group_id: String(groupId),
      maxPageSize: 100,
      filter: `user == 'users/${userId}'`,
    },
    { retries: 2, retryDelay: 500 }
  );

  if (isAnyErrorResponse(response) || !Array.isArray(response?.groupMemberships)) {
    throw new VerificationRobloxError(
      "The Roblox multi-role membership could not be checked.",
      "UNAVAILABLE"
    );
  }

  const membership = response.groupMemberships[0];
  if (!membership) return { roles: [], complete: true, warning: null };

  const paths = [
    ...(Array.isArray(membership.roles) ? membership.roles : []),
    membership.role,
  ];
  const roleIds = [...new Set(
    paths.map((path) => parseCloudRoleId(path, groupId)).filter(Boolean)
  )];

  return {
    roles: roleIds.map((robloxRoleId) => ({ robloxRoleId })),
    complete: true,
    warning: null,
  };
}

async function fetchLegacyGroupMembership(userId, groupId, warning) {
  const response = await fetchApi(
    getUsersUseridGroupsRoles,
    { userId },
    { retries: 2, retryDelay: 500 }
  );

  if (isAnyErrorResponse(response) || !Array.isArray(response?.data)) {
    throw new VerificationRobloxError(
      "The Roblox group rank could not be checked.",
      "UNAVAILABLE"
    );
  }

  const membership = response.data.find((entry) => entry.group?.id === groupId);
  if (!membership) return { roles: [], complete: true, warning: null };
  if (
    !Number.isSafeInteger(membership.role?.id) ||
    !Number.isInteger(membership.role?.rank)
  ) {
    throw new VerificationRobloxError(
      "Roblox returned an invalid group rank.",
      "UNAVAILABLE"
    );
  }

  return {
    roles: [{
      robloxRoleId: membership.role.id,
      rank: membership.role.rank,
      name: membership.role.name,
    }],
    complete: false,
    warning,
  };
}

export async function fetchRobloxGroupMemberships(userId, groupId) {
  try {
    if (process.env.ROBLOX_CLOUD_KEY?.trim()) {
      try {
        return await fetchOpenCloudGroupMembership(userId, groupId);
      } catch (error) {
        return fetchLegacyGroupMembership(
          userId,
          groupId,
          "Roblox Open Cloud multi-role lookup failed; only the legacy primary role was synchronized."
        );
      }
    }
    return fetchLegacyGroupMembership(
      userId,
      groupId,
      "Set ROBLOX_CLOUD_KEY to synchronize every assigned Roblox role; only the legacy primary role was available."
    );
  } catch (error) {
    if (error instanceof VerificationRobloxError) throw error;
    throw new VerificationRobloxError(
      "Roblox could not load the user's group rank. Please try again later.",
      "UNAVAILABLE",
      error
    );
  }
}
