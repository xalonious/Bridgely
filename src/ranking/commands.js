import { ApplicationCommandOptionType, escapeMarkdown } from "discord.js";
import { canManageRole, checkAuthorization, verifiedIdentity, RankingError } from "./authorization.js";
import { changeRobloxRole } from "./changeRole.js";
import { getGroupRoles, getMembership, getRobloxUsername, isAssignableRole, RobloxError } from "./roblox.js";
import { resolveRobloxUsername, VerificationRobloxError } from "../verification/roblox.js";
import { GroupConfigurationError } from "../setup/groupConfiguration.js";
import { err } from "../utils/logger.js";

const rankOption = { name: "rank", description: "Roblox group role", type: ApplicationCommandOptionType.String, required: true, autocomplete: true };
const authCache = new Map();
const targetCache = new Map();

export function rankingOptions(targetKind) {
  const target = targetKind === "user"
    ? { name: "user", description: "Verified Discord member", type: ApplicationCommandOptionType.User, required: true }
    : { name: "username", description: "Roblox username", type: ApplicationCommandOptionType.String, required: true };
  return ["add", "remove"].map((name) => ({
    name,
    description: `${name === "add" ? "Add" : "Remove"} a Roblox group role`,
    type: ApplicationCommandOptionType.Subcommand,
    options: [target, rankOption],
  }));
}

function cached(map, key, ttl, loader) {
  const current = map.get(key);
  if (current?.until > Date.now()) return current.promise;
  if (map.size >= 250) {
    for (const [storedKey, value] of map) if (value.until <= Date.now()) map.delete(storedKey);
    if (map.size >= 250) map.delete(map.keys().next().value);
  }
  let entry;
  const promise = Promise.resolve().then(loader).catch((error) => {
    if (map.get(key) === entry) map.delete(key);
    throw error;
  });
  entry = { promise, until: Date.now() + ttl };
  map.set(key, entry);
  promise.then((value) => {
    if (map.get(key) === entry && (value === false || value === null ||
        value?.authorization === null || value?.authorization?.allowed === false)) {
      map.delete(key);
    }
  }, () => {});
  return promise;
}

async function within(promise, milliseconds, fallback) {
  let timeout;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timeout = setTimeout(() => resolve(fallback), milliseconds); })]);
  } finally {
    clearTimeout(timeout);
  }
}

async function autocompleteAuthorization(interaction) {
  const identity = await verifiedIdentity(interaction.guildId, interaction.user.id);
  if (!identity) return { roles: await getGroupRoles(), authorization: null };
  const authorization = await checkAuthorization(identity.robloxUserId, { fresh: false });
  return { roles: authorization.allowed ? authorization.roles : [], authorization };
}

async function autocompleteTarget(interaction) {
  if (interaction.commandName === "rank-user") {
    const discordId = interaction.options.get("user")?.value;
    if (!/^\d+$/.test(String(discordId ?? ""))) return null;
    const identity = await verifiedIdentity(interaction.guildId, discordId);
    if (!identity) return false;
    return getMembership(identity.robloxUserId);
  }
  const username = interaction.options.getString("username")?.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username ?? "")) return null;
  try {
    const user = await resolveRobloxUsername(username);
    return getMembership(user.id);
  } catch (error) {
    if (error instanceof VerificationRobloxError && error.code === "NOT_FOUND") return false;
    throw error;
  }
}

export function rankChoices(roles, action, search, heldPaths = null, authorization = null) {
  if (heldPaths === false) {
    heldPaths = null;
    authorization = null;
  }
  return roles
    .filter((role) => isAssignableRole(role, roles))
    .filter((role) => !authorization || canManageRole(authorization, role))
    .filter((role) => heldPaths === null || (action === "remove" ? heldPaths.has(role.path) : !heldPaths.has(role.path)))
    .filter((role) => role.displayName.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 25)
    .map((role) => ({ name: role.displayName.slice(0, 100), value: String(role.id) }));
}

export async function autocompleteRank(interaction) {
  try {
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const targetKey = interaction.commandName === "rank-user"
      ? `user:${interaction.guildId}:${interaction.options.get("user")?.value}`
      : `name:${interaction.options.getString("username")?.trim().toLowerCase()}`;
    const targetSelected = !targetKey.endsWith(":undefined") && !targetKey.endsWith(":");
    const statePromise = cached(authCache, key, 45_000, () => autocompleteAuthorization(interaction));
    const targetPromise = targetSelected
      ? cached(targetCache, targetKey, 60_000, () => autocompleteTarget(interaction))
          .catch((error) => {
            console.error(err(`[Ranking] Target autocomplete lookup failed: ${error?.stack || error}`));
            return undefined;
          })
      : Promise.resolve(undefined);
    const [state, membership] = await within(Promise.all([statePromise, targetPromise]), 2500, [null, undefined]);
    let heldPaths = null;
    if (targetSelected) {
      heldPaths = membership === undefined ? null : membership === null || membership === false ? false
        : new Set([...membership.roles, membership.role]);
    }
    await interaction.respond(rankChoices(state?.roles ?? [], interaction.options.getSubcommand(), interaction.options.getFocused(), heldPaths, state?.authorization?.allowed ? state.authorization : null));
  } catch (error) {
    console.error(err(`[Ranking] Autocomplete failed: ${error?.stack || error}`));
    if (!interaction.responded) await interaction.respond([]).catch(() => {});
  }
}

function userMessage(error) {
  if (error instanceof RankingError || error instanceof GroupConfigurationError || error instanceof VerificationRobloxError) return error.message;
  if (error instanceof RobloxError) {
    if (error.message.includes("ROBLOX_CLOUD_KEY")) return "The Roblox Open Cloud key is not configured. Contact a server administrator.";
    if (error.message.includes("no longer exists")) return "A stored Roblox account no longer exists. Verify again with Bridgely.";
    return "Roblox could not complete that rank change. Check the bot key's group scopes and hierarchy, then try again.";
  }
  return "The rank change could not be completed. Please try again later.";
}

export async function runRanking(interaction) {
  await interaction.deferReply();
  try {
    if (!interaction.inGuild()) throw new RankingError("guild", "Ranking is only available in a Discord server.");
    const action = interaction.options.getSubcommand(true);
    const roleId = interaction.options.getString("rank", true);
    if (!await verifiedIdentity(interaction.guildId, interaction.user.id)) {
      throw new RankingError("executor_unverified", "Verify your Roblox account with Bridgely before managing ranks.");
    }
    let target;
    if (interaction.commandName === "rank-user") {
      const discordUser = interaction.options.getUser("user", true);
      try {
        await interaction.guild.members.fetch(discordUser.id);
      } catch {
        throw new RankingError("target_left", "That Discord user is no longer in this server.");
      }
      const identity = await verifiedIdentity(interaction.guildId, discordUser.id);
      if (!identity) {
        throw new RankingError("target_unverified", "That user is not verified with Bridgely. Have them verify, or use /rank with their Roblox username.");
      }
      target = { id: identity.robloxUserId, username: await getRobloxUsername(identity.robloxUserId), discordUser };
    } else {
      const user = await resolveRobloxUsername(interaction.options.getString("username", true));
      target = { id: user.id, username: user.username };
    }
    const result = await changeRobloxRole({ interaction, target, roleId, action });
    authCache.delete(`${interaction.guildId}:${interaction.user.id}`);
    targetCache.clear();
    const verb = action === "add" ? "added" : "removed";
    const preposition = action === "add" ? "to" : "from";
    const targetText = target.discordUser ? `<@${target.discordUser.id}>'s Roblox account` : `**${escapeMarkdown(target.username)}**`;
    const updateHint = target.discordUser ? " Run `/update` to synchronize their Discord roles." : "";
    await interaction.editReply({ content: `Successfully ${verb} **${escapeMarkdown(result.role.displayName)}** ${preposition} ${targetText}.${updateHint}`, allowedMentions: { parse: [] } });
  } catch (error) {
    if (!(error instanceof RankingError || error instanceof VerificationRobloxError)) {
      console.error(err(`[Ranking] Command failed: ${error?.stack || error}`));
    }
    await interaction.editReply(userMessage(error));
  }
}
