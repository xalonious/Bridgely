import { randomBytes } from "node:crypto";
import { MessageFlags } from "discord.js";
import Bind from "../schemas/bind.js";
import GuildConfiguration from "../schemas/guildConfiguration.js";
import { hasSetupPermission } from "../setup/permissions.js";
import { fetchRobloxGroupRoles } from "../setup/roblox.js";
import { rollbackCreatedRoles, sanitizeDiscordRoleName } from "../setup/roles.js";
import { err } from "../utils/logger.js";
import {
  BIND_TIMEOUT_MS,
  BIND_TYPES,
  GROUP_CONDITIONS,
  MAX_BINDS_PER_GUILD,
} from "./constants.js";
import { BindRobloxError, fetchBindAsset, parseRobloxAssetId } from "./roblox.js";
import {
  buildAssetModal,
  buildAssetPrompt,
  buildBindList,
  buildBindStatus,
  buildConditionSelection,
  buildDeleteConfirmation,
  buildDeleteSelection,
  buildDiscordRoleSelection,
  buildRankSelection,
  buildRankModal,
  buildRepairConfirmation,
  buildRepairNamesModal,
  buildRepairSelection,
  buildReview,
  buildTypeSelection,
} from "./views.js";

const sessions = new Map();
const userSessions = new Map();

function logBindError(context, error) {
  console.error(err(`[Binds] ${context}: ${error?.stack || error}`));
}

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function clearSession(session) {
  if (!session) return;
  clearTimeout(session.timeout);
  sessions.delete(session.id);
  if (userSessions.get(key(session.guildId, session.userId)) === session.id) {
    userSessions.delete(key(session.guildId, session.userId));
  }
}

function armTimeout(session) {
  clearTimeout(session.timeout);
  session.timeout = setTimeout(async () => {
    if (!sessions.has(session.id)) return;
    clearSession(session);
    try {
      await session.commandInteraction.editReply(
        buildBindStatus("⌛ Bind Session Expired", "Run **/binds** to open the bind manager again.", 0x99aab5)
      );
    } catch (error) {
      logBindError("Could not expire a bind session", error);
    }
  }, BIND_TIMEOUT_MS);
  session.timeout.unref?.();
}

function resetDraft(session) {
  session.type = null;
  session.asset = null;
  session.criteria = null;
  session.groupRoles = [];
  session.discordRoleIds = [];
  session.deleteBindId = null;
  session.repairBindId = null;
  session.repairMissingRoles = [];
  session.processing = false;
}

async function privateReply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
  return interaction.reply(payload);
}

function parseCustomId(customId) {
  const match = String(customId ?? "").match(/^bind:([a-f0-9]{12}):([a-z_]+)$/);
  return match ? { sessionId: match[1], action: match[2] } : null;
}

async function loadBinds(guild) {
  await guild.roles.fetch();
  const binds = await Bind.find({ guildId: guild.id }).sort({ _id: 1 }).lean();
  for (const bind of binds) {
    bind.missingRoleIds = bind.discordRoleIds.filter(
      (roleId) => !guild.roles.cache.has(roleId)
    );
  }
  return binds;
}

export async function startBindManager(interaction) {
  if (!interaction.inCachedGuild()) {
    await privateReply(interaction, "Binds can only be managed in a Discord server.");
    return;
  }
  if (!hasSetupPermission(interaction.member)) {
    await privateReply(interaction, "You need Manage Server or Administrator permission to manage binds.");
    return;
  }
  const configuration = await GuildConfiguration.findOne({ guildId: interaction.guildId }).lean();
  if (!configuration) {
    await privateReply(interaction, "Run **/setup** before configuring binds.");
    return;
  }

  const previousId = userSessions.get(key(interaction.guildId, interaction.user.id));
  clearSession(previousId ? sessions.get(previousId) : null);
  const session = {
    id: randomBytes(6).toString("hex"),
    guildId: interaction.guildId,
    userId: interaction.user.id,
    commandInteraction: interaction,
    configuration,
    binds: await loadBinds(interaction.guild),
    timeout: null,
  };
  resetDraft(session);
  sessions.set(session.id, session);
  userSessions.set(key(session.guildId, session.userId), session.id);
  armTimeout(session);
  await interaction.reply(buildBindList(session));
}

async function showHome(interaction, session) {
  resetDraft(session);
  session.binds = await loadBinds(interaction.guild);
  armTimeout(session);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(buildBindList(session));
  } else {
    await interaction.update(buildBindList(session));
  }
}

async function handleButton(interaction, session, action) {
  if (action === "home") return showHome(interaction, session);
  if (action === "cancel") {
    clearSession(session);
    await interaction.update(buildBindStatus("Bind Manager Closed", "No unsaved changes were applied.", 0x99aab5));
    return;
  }
  if (action === "create") {
    if (session.binds.length >= MAX_BINDS_PER_GUILD) {
      await privateReply(interaction, `This server already has the maximum of ${MAX_BINDS_PER_GUILD} binds.`);
      return;
    }
    resetDraft(session);
    armTimeout(session);
    await interaction.update(buildTypeSelection(session));
    return;
  }
  if (action === "delete") {
    if (!session.binds.length) return showHome(interaction, session);
    armTimeout(session);
    await interaction.update(buildDeleteSelection(session));
    return;
  }
  if (action === "asset_enter") {
    armTimeout(session);
    await interaction.showModal(buildAssetModal(session));
    return;
  }
  if (action === "rank_enter") {
    armTimeout(session);
    await interaction.showModal(buildRankModal(session));
    return;
  }
  if (action === "condition_back") {
    armTimeout(session);
    await interaction.update(buildConditionSelection(session));
    return;
  }
  if (action === "roles_back") {
    armTimeout(session);
    if (session.type === BIND_TYPES.GROUP && session.criteria.condition !== GROUP_CONDITIONS.MEMBER) {
      await interaction.update(buildRankSelection(session));
    } else if (session.type === BIND_TYPES.GROUP) {
      await interaction.update(buildConditionSelection(session));
    } else {
      await interaction.update(buildAssetPrompt(session));
    }
    return;
  }
  if (action === "review_back") {
    armTimeout(session);
    await interaction.update(buildDiscordRoleSelection(session));
    return;
  }
  if (action === "confirm") {
    if (session.processing) {
      await privateReply(interaction, "This bind is already being saved.");
      return;
    }
    session.processing = true;
    await interaction.guild.roles.fetch();
    const selectedRoles = session.discordRoleIds.map((id) =>
      interaction.guild.roles.cache.get(id)
    );
    const invalidRole = selectedRoles.find((role) =>
      !role || role.id === interaction.guild.id || role.managed || !role.editable
    );
    if (invalidRole) {
      session.processing = false;
      await privateReply(
        interaction,
        `The role **${invalidRole?.name || "Unknown Role"}** is no longer manageable by Bridgely. Go back and choose another role.`
      );
      return;
    }
    const count = await Bind.countDocuments({ guildId: session.guildId });
    if (count >= MAX_BINDS_PER_GUILD) {
      session.processing = false;
      await privateReply(interaction, `This server already has the maximum of ${MAX_BINDS_PER_GUILD} binds.`);
      return;
    }
    await Bind.create({
      bindId: randomBytes(6).toString("hex"),
      guildId: session.guildId,
      type: session.type,
      robloxGroupId: session.type === BIND_TYPES.GROUP ? session.configuration.robloxGroupId : null,
      assetId: session.asset?.id ?? null,
      assetName: session.asset?.name ?? null,
      criteria: session.criteria,
      discordRoleIds: session.discordRoleIds,
      schemaVersion: 1,
    });
    return showHome(interaction, session);
  }
  if (action === "delete_confirm") {
    if (session.processing) {
      await privateReply(interaction, "This bind is already being deleted.");
      return;
    }
    session.processing = true;
    await Bind.deleteOne({
      guildId: session.guildId,
      bindId: session.deleteBindId,
    });
    return showHome(interaction, session);
  }
  if (action === "repair") {
    const unhealthy = session.binds.filter((bind) => bind.missingRoleIds?.length);
    if (!unhealthy.length) return showHome(interaction, session);
    armTimeout(session);
    await interaction.update(buildRepairSelection(session, unhealthy));
    return;
  }
  if (action === "repair_names") {
    armTimeout(session);
    await interaction.showModal(buildRepairNamesModal(session));
    return;
  }
  if (action === "repair_confirm") {
    if (session.processing) {
      await privateReply(interaction, "This bind is already being repaired.");
      return;
    }
    session.processing = true;
    await interaction.deferUpdate();
    await interaction.guild.roles.fetch();
    const bind = await Bind.findOne({
      guildId: session.guildId,
      bindId: session.repairBindId,
    }).lean();
    if (!bind) {
      session.processing = false;
      await interaction.editReply(buildBindStatus("Bind Not Found", "That bind was already deleted.", 0x99aab5));
      return;
    }

    const createdRoles = [];
    const replacements = new Map();
    let databaseUpdated = false;
    try {
      const usedRoleIds = new Set(bind.discordRoleIds.filter((id) =>
        interaction.guild.roles.cache.has(id)
      ));
      for (const missing of session.repairMissingRoles) {
        if (interaction.guild.roles.cache.has(missing.discordRoleId)) continue;
        const name = sanitizeDiscordRoleName(missing.discordRoleName, "Bound Role");
        let role = interaction.guild.roles.cache.find((candidate) =>
          candidate.name === name &&
          candidate.editable &&
          !candidate.managed &&
          !usedRoleIds.has(candidate.id)
        );
        if (!role) {
          role = await interaction.guild.roles.create({
            name,
            reason: `Repair Bridgely bind ${bind.bindId}`,
          });
          createdRoles.push(role);
        }
        usedRoleIds.add(role.id);
        replacements.set(missing.discordRoleId, role);
      }

      const discordRoleIds = bind.discordRoleIds.map((roleId) =>
        replacements.get(roleId)?.id || roleId
      );
      const updated = await Bind.updateOne(
        {
          guildId: session.guildId,
          bindId: bind.bindId,
          discordRoleIds: bind.discordRoleIds,
        },
        { $set: { discordRoleIds } }
      );
      if (!updated.modifiedCount) {
        throw new Error("The bind changed while it was being repaired.");
      }
      databaseUpdated = true;
      return showHome(interaction, session);
    } catch (error) {
      if (!databaseUpdated) {
        await rollbackCreatedRoles(createdRoles, "Rollback failed bind repair");
      }
      throw error;
    }
  }
}

async function handleStringSelect(interaction, session, action) {
  if (action === "type") {
    session.type = interaction.values[0];
    session.asset = null;
    session.criteria = null;
    armTimeout(session);
    if (session.type === BIND_TYPES.GROUP) {
      await interaction.deferUpdate();
      session.groupRoles = await fetchRobloxGroupRoles(session.configuration.robloxGroupId);
      if (!session.groupRoles.length) {
        await privateReply(interaction, "The linked Roblox group has no bindable rolesets.");
        return;
      }
      await interaction.editReply(buildConditionSelection(session));
    } else {
      await interaction.update(buildAssetPrompt(session));
    }
    return;
  }
  if (action === "condition") {
    const condition = interaction.values[0];
    if (
      condition === GROUP_CONDITIONS.BETWEEN &&
      session.groupRoles.slice(0, 25).length < 2
    ) {
      await privateReply(
        interaction,
        "This Roblox group needs at least two bindable rolesets for a rank range."
      );
      return;
    }
    session.criteria = { condition, ranks: [], minRank: null, maxRank: null };
    armTimeout(session);
    await interaction.update(
      condition === GROUP_CONDITIONS.MEMBER
        ? buildDiscordRoleSelection(session)
        : buildRankSelection(session)
    );
    return;
  }
  if (action === "ranks") {
    const ranks = interaction.values.map(Number).sort((a, b) => a - b);
    if (session.criteria.condition === GROUP_CONDITIONS.EXACT) session.criteria.ranks = ranks;
    if (session.criteria.condition === GROUP_CONDITIONS.GTE) session.criteria.minRank = ranks[0];
    if (session.criteria.condition === GROUP_CONDITIONS.LTE) session.criteria.maxRank = ranks[0];
    if (session.criteria.condition === GROUP_CONDITIONS.BETWEEN) {
      [session.criteria.minRank, session.criteria.maxRank] = ranks;
    }
    armTimeout(session);
    await interaction.update(buildDiscordRoleSelection(session));
    return;
  }
  if (action === "delete_select") {
    const bind = session.binds.find((entry) => entry.bindId === interaction.values[0]);
    if (!bind) {
      await privateReply(interaction, "That bind no longer exists. Run **/binds** again.");
      return;
    }
    session.deleteBindId = bind.bindId;
    armTimeout(session);
    await interaction.update(buildDeleteConfirmation(session, bind));
    return;
  }
  if (action === "repair_select") {
    const bind = session.binds.find((entry) => entry.bindId === interaction.values[0]);
    if (!bind || !bind.missingRoleIds?.length) {
      await privateReply(interaction, "That bind no longer needs repair.");
      return;
    }
    session.repairBindId = bind.bindId;
    session.repairMissingRoles = bind.missingRoleIds.map((roleId) => ({
      discordRoleId: roleId,
      discordRoleName: null,
    }));
    armTimeout(session);
    await interaction.update(buildRepairConfirmation(session, bind));
  }
}

async function handleRoleSelect(interaction, session) {
  await interaction.deferUpdate();
  await interaction.guild.roles.fetch();
  const roles = interaction.values.map((id) => interaction.guild.roles.cache.get(id));
  const invalid = roles.find((role) =>
    !role || role.id === interaction.guild.id || role.managed || !role.editable
  );
  if (invalid) {
    await interaction.editReply(
      buildDiscordRoleSelection(
        session,
        invalid?.managed
          ? `**${invalid.name}** is managed by Discord or an integration.`
          : `**${invalid?.name || "That role"}** is not manageable by Bridgely.`
      )
    );
    return;
  }
  session.discordRoleIds = roles.map((role) => role.id);
  armTimeout(session);
  await interaction.editReply(buildReview(session));
}

async function handleModal(interaction, session) {
  await interaction.deferUpdate();
  try {
    const label = session.type === BIND_TYPES.BADGE ? "badge" : "game pass";
    const assetId = parseRobloxAssetId(
      interaction.fields.getTextInputValue("asset_id"),
      label
    );
    session.asset = await fetchBindAsset(session.type, assetId);
    armTimeout(session);
    await interaction.editReply(buildDiscordRoleSelection(session));
  } catch (error) {
    if (!(error instanceof BindRobloxError)) throw error;
    await interaction.editReply(buildAssetPrompt(session, error.message));
  }
}

async function handleRankModal(interaction, session) {
  await interaction.deferUpdate();
  const raw = interaction.fields.getTextInputValue("rank_values").trim();
  const values = raw.split(/[\s,\-–—]+/).filter(Boolean).map(Number);
  const valid = values.length > 0 && values.every(
    (rank) => Number.isInteger(rank) && rank >= 1 && rank <= 255
  );
  const condition = session.criteria.condition;
  const expected = condition === GROUP_CONDITIONS.BETWEEN ? 2 :
    condition === GROUP_CONDITIONS.EXACT ? null : 1;
  if (!valid || (expected && values.length !== expected)) {
    await interaction.editReply(buildRankSelection(session));
    await privateReply(
      interaction,
      condition === GROUP_CONDITIONS.BETWEEN
        ? "Enter exactly two ranks between 1 and 255, such as `10-50`."
        : condition === GROUP_CONDITIONS.EXACT
          ? "Enter one or more ranks between 1 and 255, separated by commas."
          : "Enter one rank threshold between 1 and 255."
    );
    return;
  }

  const ranks = (condition === GROUP_CONDITIONS.EXACT
    ? [...new Set(values)]
    : values
  ).sort((a, b) => a - b);
  if (condition === GROUP_CONDITIONS.EXACT) session.criteria.ranks = ranks;
  if (condition === GROUP_CONDITIONS.GTE) session.criteria.minRank = ranks[0];
  if (condition === GROUP_CONDITIONS.LTE) session.criteria.maxRank = ranks[0];
  if (condition === GROUP_CONDITIONS.BETWEEN) {
    [session.criteria.minRank, session.criteria.maxRank] = ranks;
  }
  armTimeout(session);
  await interaction.editReply(buildDiscordRoleSelection(session));
}

async function handleRepairNamesModal(interaction, session) {
  await interaction.deferUpdate();
  const unnamed = session.repairMissingRoles.filter((role) => !role.discordRoleName);
  const names = interaction.fields
    .getTextInputValue("role_names")
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length !== unnamed.length) {
    await interaction.editReply(
      buildRepairConfirmation(
        session,
        session.binds.find((bind) => bind.bindId === session.repairBindId),
        `Enter exactly ${unnamed.length} role name(s), one per line.`
      )
    );
    return;
  }
  unnamed.forEach((role, index) => {
    role.discordRoleName = sanitizeDiscordRoleName(names[index], "Bound Role");
  });
  armTimeout(session);
  await interaction.editReply(
    buildRepairConfirmation(
      session,
      session.binds.find((bind) => bind.bindId === session.repairBindId)
    )
  );
}

export async function handleBindInteraction(interaction) {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false;
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;
  const session = sessions.get(parsed.sessionId);
  if (!session) {
    await privateReply(interaction, "This bind session expired. Run **/binds** again.");
    return true;
  }
  if (session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    await privateReply(interaction, "This bind session belongs to another administrator.");
    return true;
  }
  if (!hasSetupPermission(interaction.member)) {
    await privateReply(interaction, "You no longer have permission to manage binds.");
    return true;
  }

  try {
    if (interaction.isButton()) await handleButton(interaction, session, parsed.action);
    else if (interaction.isStringSelectMenu()) {
      await handleStringSelect(interaction, session, parsed.action);
    } else if (interaction.isRoleSelectMenu() && parsed.action === "roles") {
      await handleRoleSelect(interaction, session);
    } else if (interaction.isModalSubmit() && parsed.action === "asset_submit") {
      await handleModal(interaction, session);
    } else if (interaction.isModalSubmit() && parsed.action === "rank_submit") {
      await handleRankModal(interaction, session);
    } else if (interaction.isModalSubmit() && parsed.action === "repair_names_submit") {
      await handleRepairNamesModal(interaction, session);
    } else {
      await privateReply(interaction, "That bind control is invalid or outdated.");
    }
  } catch (error) {
    session.processing = false;
    logBindError("Interaction handling failed", error);
    await privateReply(interaction, "The bind manager encountered an unexpected error. Please try again.");
  }
  return true;
}
