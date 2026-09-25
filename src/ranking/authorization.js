import VerifiedUser from "../schemas/verifiedUser.js";
import { getGroupOwner, getGroupRoles, getMembership, RobloxError } from "./roblox.js";

export class RankingError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "RankingError";
    this.kind = kind;
  }
}

export function inspectAuthorization(membership, roles, { robloxId, owner } = {}) {
  if (!membership) return { allowed: false, reason: "not_member" };
  if (owner === `users/${robloxId}`) return { allowed: true, highestIndex: -1, isOwner: true };

  const heldPaths = new Set([...membership.roles, membership.role]);
  const heldRoles = roles.filter((role) => heldPaths.has(role.path));
  if (heldRoles.length !== heldPaths.size) {
    throw new RobloxError("The executor has roles not visible through this API key.");
  }
  const withPermission = heldRoles.filter((role) => role.permissions?.changeRank === true);
  if (!withPermission.length) {
    if (heldRoles.some((role) => typeof role.permissions?.changeRank !== "boolean")) {
      throw new RobloxError("The API key cannot read the executor's role permissions.");
    }
    return { allowed: false, reason: "no_permission" };
  }
  const highestIndex = roles.findIndex((role) => role.path === membership.role);
  if (highestIndex < 0 || heldRoles.some((role) => roles.indexOf(role) < highestIndex)) {
    throw new RobloxError("The role list does not match Roblox's highest-role data.");
  }
  return { allowed: true, highestIndex };
}

export async function checkAuthorization(robloxId, { fresh = true } = {}) {
  const [membership, roles, owner] = await Promise.all([
    getMembership(robloxId),
    getGroupRoles({ fresh }),
    getGroupOwner(),
  ]);
  return { ...inspectAuthorization(membership, roles, { robloxId, owner }), membership, roles, owner };
}

export function canManageRole(authorization, role) {
  if (!authorization.allowed || !role) return false;
  const index = authorization.roles.findIndex((item) => item.path === role.path);
  return index > authorization.highestIndex;
}

export async function verifiedIdentity(guildId, discordId) {
  return VerifiedUser.findOne({ guildId, discordUserId: discordId }).lean();
}

export async function resolveExecutor(guildId, discordId) {
  const identity = await verifiedIdentity(guildId, discordId);
  if (!identity) {
    throw new RankingError("executor_unverified", "Verify your Roblox account with Bridgely before managing ranks.");
  }
  const authorization = await checkAuthorization(identity.robloxUserId);
  if (!authorization.allowed) {
    throw new RankingError("unauthorized", "You don't have permission to manage ranks.");
  }
  return { ...identity, authorization };
}
