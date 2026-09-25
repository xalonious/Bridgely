import { configureServer, fetchApi, isAnyErrorResponse } from "rozod";
import { getUsersUserid } from "rozod/endpoints/usersv1";
import {
  getCloudV2GroupsGroupId,
  getCloudV2GroupsGroupIdMemberships,
  getCloudV2GroupsGroupIdRoles,
  postCloudV2GroupsGroupIdMembershipsMembershipIdAssignRole,
  postCloudV2GroupsGroupIdMembershipsMembershipIdUnassignRole,
} from "rozod/opencloud/v2/cloud";
import { configuredGroupId } from "../setup/groupConfiguration.js";

export class RobloxError extends Error {
  constructor(message) {
    super(message);
    this.name = "RobloxError";
  }
}

let configuredKey;
function ensureConfigured() {
  const key = process.env.ROBLOX_CLOUD_KEY?.trim();
  if (!key) throw new RobloxError("ROBLOX_CLOUD_KEY is missing.");
  if (configuredKey !== key) {
    configureServer({ cloudKey: key });
    configuredKey = key;
  }
  return String(configuredGroupId());
}

async function request(endpoint, params) {
  let result;
  try {
    result = await fetchApi(endpoint, params, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new RobloxError(`Roblox request failed: ${error.message}`);
  }
  if (isAnyErrorResponse(result)) {
    throw new RobloxError(`Roblox API rejected the request: ${result.message ?? "unknown error"}`);
  }
  return result;
}

export function groupId() {
  return ensureConfigured();
}

export async function getGroupOwner() {
  const id = ensureConfigured();
  const group = await request(getCloudV2GroupsGroupId, { group_id: id });
  if (!/^users\/[1-9]\d*$/.test(group.owner ?? "")) {
    throw new RobloxError("Roblox returned an invalid group owner.");
  }
  return group.owner;
}

export async function getRobloxUsername(robloxId) {
  const result = await request(getUsersUserid, { userId: Number(robloxId) });
  if (Number(result?.id) !== Number(robloxId) || !result?.name) {
    throw new RobloxError("The verified Roblox account no longer exists.");
  }
  return result.name;
}

export async function getMembership(robloxId) {
  const id = ensureConfigured();
  const data = await request(getCloudV2GroupsGroupIdMemberships, {
    group_id: id,
    filter: `user == 'users/${robloxId}'`,
    maxPageSize: 10,
  });
  if (!Array.isArray(data.groupMemberships)) throw new RobloxError("Roblox returned invalid membership data.");
  const membership = data.groupMemberships.find((item) => item.user === `users/${robloxId}`);
  if (!membership) return null;
  if (!membership.path.startsWith(`groups/${id}/memberships/`) ||
      !/^groups\/\d+\/memberships\/[^/]+$/.test(membership.path) ||
      !Array.isArray(membership.roles) || typeof membership.role !== "string") {
    throw new RobloxError("Roblox returned incomplete membership data.");
  }
  return membership;
}

let roleCache;
export async function getGroupRoles({ fresh = false } = {}) {
  const id = ensureConfigured();
  if (!fresh && roleCache?.groupId === id && roleCache.expiresAt > Date.now()) {
    return roleCache.roles;
  }

  const roles = [];
  const seenTokens = new Set();
  let pageToken;
  do {
    const page = await request(getCloudV2GroupsGroupIdRoles, {
      group_id: id,
      maxPageSize: 20,
      ...(pageToken ? { pageToken } : {}),
    });
    if (!Array.isArray(page.groupRoles)) throw new RobloxError("Roblox returned invalid role data.");
    roles.push(...page.groupRoles);
    pageToken = page.nextPageToken || undefined;
    if (pageToken && seenTokens.has(pageToken)) throw new RobloxError("Roblox role pagination repeated a page.");
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken);

  if (roles.some((role) => !/^\d+$/.test(String(role.id ?? "")) ||
      role.path !== `groups/${id}/roles/${role.id}` ||
      typeof role.displayName !== "string")) {
    throw new RobloxError("Roblox returned invalid role data.");
  }
  roleCache = { groupId: id, roles, expiresAt: Date.now() + 60000 };
  return roles;
}

export function isAssignableRole(role, groupRoles = []) {
  if (!role || role.assignable === false || role.rank === 0) return false;

  const guestIndex = groupRoles.findIndex((item) => item.rank === 0);
  const baseMember = guestIndex > 0 && groupRoles[guestIndex - 1].rank === 1
    ? groupRoles[guestIndex - 1]
    : null;
  if (role.rank === 1 && !baseMember) return false;
  return role.path !== baseMember?.path;
}

export async function changeMemberRole(operation, membership, role) {
  const id = ensureConfigured();
  const membershipId = membership.path.split("/").at(-1);
  const endpoint = operation === "add"
    ? postCloudV2GroupsGroupIdMembershipsMembershipIdAssignRole
    : postCloudV2GroupsGroupIdMembershipsMembershipIdUnassignRole;
  return request(endpoint, {
    group_id: id,
    membership_id: membershipId,
    body: { role: role.path },
  });
}
