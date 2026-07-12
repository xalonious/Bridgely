import { randomUUID } from "node:crypto";
import { MessageFlags, escapeMarkdown } from "discord.js";
import GuildConfiguration from "../schemas/guildConfiguration.js";
import { err } from "../utils/logger.js";
import {
  CONFIG_SCHEMA_VERSION,
  NICKNAME_TEMPLATES,
  ROLE_HANDLING,
  SETUP_TIMEOUT_MS,
} from "./constants.js";
import { renderNicknameTemplate } from "./nickname.js";
import { SetupValidationError, validateSetupPermissions } from "./permissions.js";
import {
  fetchRobloxGroup,
  fetchRobloxGroupRoles,
  parseRobloxGroupId,
  RobloxSetupError,
} from "./roblox.js";
import {
  createOrReuseRobloxRoles,
  createOrReuseVerifiedRole,
  positionCreatedRobloxRoles,
  rollbackCreatedRoles,
  validateVerifiedRoleName,
  wipeManageableRoles,
} from "./roles.js";
import {
  buildExistingConfigurationWarning,
  buildGroupModal,
  buildProgress,
  buildStatus,
  buildStep,
  buildVerifiedRoleModal,
} from "./views.js";

const sessions = new Map();
const guildSessions = new Map();

function logSetupError(context, error) {
  console.error(err(`[Setup] ${context}: ${error?.stack || error}`));
}

function parseSetupCustomId(customId) {
  const match = String(customId ?? "").match(/^setup:([a-f0-9]{12}):([a-z_]+)$/);
  return match ? { sessionId: match[1], action: match[2] } : null;
}

function clearSession(session) {
  if (!session) return;
  clearTimeout(session.timeout);
  sessions.delete(session.id);
  if (guildSessions.get(session.guildId) === session.id) {
    guildSessions.delete(session.guildId);
  }
}

function armTimeout(session) {
  clearTimeout(session.timeout);
  session.timeout = setTimeout(async () => {
    if (!sessions.has(session.id) || session.processing) return;
    clearSession(session);
    try {
      await session.commandInteraction.editReply(
        buildStatus(
          "⌛ Setup Session Expired",
          "This setup session was inactive for 2 minutes. Run `/setup` to start again.",
          0x99aab5
        )
      );
    } catch (error) {
      logSetupError("Could not mark an expired session", error);
    }
  }, SETUP_TIMEOUT_MS);
  session.timeout.unref?.();
}

async function privateReply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
  return interaction.reply(payload);
}

export function getActiveGuildSession(guildId) {
  const sessionId = guildSessions.get(guildId);
  return sessionId ? sessions.get(sessionId) : null;
}

export async function startSetupSession(interaction, replacesExisting) {
  const existingSession = getActiveGuildSession(interaction.guildId);
  if (existingSession) {
    const ownerText = existingSession.userId === interaction.user.id
      ? "You already have an active setup session in this server."
      : "Another administrator already has an active setup session in this server.";
    await privateReply(interaction, `${ownerText} Finish or cancel it before starting another.`);
    return null;
  }

  const defaultNickname = NICKNAME_TEMPLATES[0];
  const session = {
    id: randomUUID().replaceAll("-", "").slice(0, 12),
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    userId: interaction.user.id,
    commandInteraction: interaction,
    step: 1,
    replacesExisting,
    processing: false,
    group: null,
    roleHandlingStrategy: null,
    verifiedRoleName: "Verified",
    nicknameTemplate: defaultNickname.value,
    nicknameTemplateLabel: defaultNickname.label,
    timeout: null,
  };

  sessions.set(session.id, session);
  guildSessions.set(session.guildId, session.id);
  armTimeout(session);

  try {
    await interaction.reply({
      ...(replacesExisting
        ? buildExistingConfigurationWarning(session)
        : buildStep(session)),
    });
  } catch (error) {
    clearSession(session);
    throw error;
  }

  return session;
}

async function updateStep(interaction, session, step = session.step) {
  session.step = step;
  armTimeout(session);
  await interaction.update(buildStep(session));
}

async function cancelSession(interaction, session) {
  clearSession(session);
  await interaction.update(
    buildStatus("✖️ Setup Cancelled", "No settings were saved and no roles were changed.", 0x99aab5)
  );
}

async function handleButton(interaction, session, action) {
  switch (action) {
    case "cancel":
      await cancelSession(interaction, session);
      return;
    case "replace_continue":
      await updateStep(interaction, session, 1);
      return;
    case "welcome_next":
      await updateStep(interaction, session, 2);
      return;
    case "group_enter":
      armTimeout(session);
      await interaction.showModal(buildGroupModal(session));
      return;
    case "group_back":
      await updateStep(interaction, session, 1);
      return;
    case "group_confirm":
      if (!session.group) {
        await privateReply(interaction, "Validate a Roblox group before continuing.");
        return;
      }
      await updateStep(interaction, session, 3);
      return;
    case "strategy_back":
      await updateStep(interaction, session, 2);
      return;
    case "strategy_next":
      if (!session.roleHandlingStrategy) {
        await privateReply(interaction, "Choose how Bridgely should handle existing roles.");
        return;
      }
      await updateStep(interaction, session, 4);
      return;
    case "verified_default":
      session.verifiedRoleName = "Verified";
      await updateStep(interaction, session, 5);
      return;
    case "verified_custom":
      armTimeout(session);
      await interaction.showModal(buildVerifiedRoleModal(session));
      return;
    case "verified_back":
      await updateStep(interaction, session, 3);
      return;
    case "nickname_back":
      await updateStep(interaction, session, 4);
      return;
    case "nickname_next":
      await updateStep(interaction, session, 6);
      return;
    case "review_back":
      await updateStep(interaction, session, 5);
      return;
    case "confirm":
      await confirmSetup(interaction, session);
      return;
    default:
      await privateReply(interaction, "That setup control is no longer valid.");
  }
}

async function handleSelect(interaction, session, action) {
  if (action === "strategy_select") {
    const value = interaction.values[0];
    if (!Object.values(ROLE_HANDLING).includes(value)) {
      await privateReply(interaction, "That role-handling choice is invalid.");
      return;
    }
    session.roleHandlingStrategy = value;
    await updateStep(interaction, session, 3);
    return;
  }

  if (action === "nickname_select") {
    const selection = NICKNAME_TEMPLATES.find(
      (option) => option.value === interaction.values[0]
    );
    if (!selection) {
      await privateReply(interaction, "That nickname format is invalid.");
      return;
    }
    session.nicknameTemplate = selection.value;
    session.nicknameTemplateLabel = selection.label;
    await updateStep(interaction, session, 5);
  }
}

async function handleModal(interaction, session, action) {
  if (action === "group_modal") {
    await interaction.deferUpdate();
    try {
      const groupId = parseRobloxGroupId(
        interaction.fields.getTextInputValue("group_input")
      );
      const group = await fetchRobloxGroup(groupId);
      session.group = group;
      session.step = 2;
      armTimeout(session);
      await session.commandInteraction.editReply(buildStep(session));
    } catch (error) {
      const message = error instanceof RobloxSetupError
        ? error.message
        : "The Roblox group could not be validated. Please try again.";
      if (!(error instanceof RobloxSetupError)) logSetupError("Group validation failed", error);
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (action === "verified_modal") {
    try {
      session.verifiedRoleName = validateVerifiedRoleName(
        interaction.fields.getTextInputValue("role_name")
      );
      await updateStep(interaction, session, 5);
    } catch (error) {
      await privateReply(
        interaction,
        error instanceof SetupValidationError
          ? error.message
          : "That verified role name is invalid."
      );
    }
  }
}

function assertCompleteSession(session) {
  if (
    !session.group ||
    !Object.values(ROLE_HANDLING).includes(session.roleHandlingStrategy) ||
    !NICKNAME_TEMPLATES.some((item) => item.value === session.nicknameTemplate)
  ) {
    throw new SetupValidationError(
      "This setup session is incomplete. Go back and review each step."
    );
  }
  validateVerifiedRoleName(session.verifiedRoleName);
}

async function editProgress(session, message) {
  await session.commandInteraction.editReply(buildProgress(message));
}

async function confirmSetup(interaction, session) {
  if (session.processing) {
    await privateReply(interaction, "This setup is already being processed.");
    return;
  }

  session.processing = true;
  clearTimeout(session.timeout);
  const createdRoles = [];
  let deletedRoleNames = [];
  let positionWarning = null;

  try {
    assertCompleteSession(session);
    await interaction.update(buildProgress("Validating permissions..."));

    const botMember = await validateSetupPermissions(interaction);
    await interaction.guild.roles.fetch();
    if (botMember.roles.highest.id === interaction.guild.id) {
      throw new SetupValidationError(
        "Bridgely's role is not high enough to create and manage roles."
      );
    }

    await editProgress(session, "Fetching Roblox group roles...");
    session.group = await fetchRobloxGroup(session.group.id);
    const robloxRoles = await fetchRobloxGroupRoles(session.group.id);

    await editProgress(session, "Preparing Discord roles...");
    const reason = `Bridgely setup by ${interaction.user.tag} (${interaction.user.id})`;
    if (session.roleHandlingStrategy === ROLE_HANDLING.WIPE_MANAGEABLE) {
      deletedRoleNames = await wipeManageableRoles(interaction.guild, botMember, reason);
      await interaction.guild.roles.fetch();
    }

    const usedRoleIds = new Set();
    const verified = await createOrReuseVerifiedRole({
      guild: interaction.guild,
      botMember,
      name: session.verifiedRoleName,
      createdRoles,
      usedRoleIds,
      reason,
    });
    const linkedRoles = await createOrReuseRobloxRoles({
      guild: interaction.guild,
      botMember,
      robloxRoles,
      createdRoles,
      usedRoleIds,
      reason,
    });
    const positionResult = await positionCreatedRobloxRoles(
      interaction.guild,
      linkedRoles.createdGroupRoles
    );
    if (positionResult) {
      positionWarning = positionResult.message;
      logSetupError("Generated role positioning was incomplete", positionResult.error);
    }

    await editProgress(session, "Saving configuration...");
    const now = new Date();
    await GuildConfiguration.findOneAndUpdate(
      { guildId: session.guildId },
      {
        $set: {
          robloxGroupId: session.group.id,
          robloxGroupName: session.group.name,
          verifiedRoleName: verified.role.name,
          verifiedRoleId: verified.role.id,
          nicknameTemplate: session.nicknameTemplate,
          nicknameTemplateLabel: session.nicknameTemplateLabel,
          roleMappings: linkedRoles.mappings,
          updatedAt: now,
          schemaVersion: CONFIG_SCHEMA_VERSION,
        },
        $unset: {
          roleHandlingStrategy: 1,
          verifiedRoleCreated: 1,
          configuredBy: 1,
          configuredAt: 1,
        },
        $setOnInsert: { guildId: session.guildId },
      },
      { upsert: true, runValidators: true, new: true, strict: false }
    );

    const reusedCount = linkedRoles.mappings.length - linkedRoles.createdGroupRoles.length;
    const preview = renderNicknameTemplate(session.nicknameTemplate, {
      discord_username: "Builder",
      discord_display_name: "Builder Pro",
      roblox_username: "BridgelyUser",
      roblox_display_name: "Bridgely",
    });
    const notes = [
      `Connected **${escapeMarkdown(session.group.name).slice(0, 200)}** (ID ${session.group.id}).`,
      `Verified role: <@&${verified.role.id}> (${verified.created ? "created" : "reused"}).`,
      `Roblox roles: ${linkedRoles.mappings.length} linked (${linkedRoles.createdGroupRoles.length} created, ${reusedCount} reused).`,
      `Nickname preview: **${preview}**.`,
    ];
    if (deletedRoleNames.length) {
      notes.push(`${deletedRoleNames.length} manageable existing role(s) were removed.`);
    }
    if (positionWarning) notes.push(`⚠️ ${positionWarning}`);

    clearSession(session);
    try {
      await session.commandInteraction.editReply(
        buildStatus("🎉 Bridgely Setup Complete", notes.join("\n"), 0x57f287)
      );
    } catch (error) {
      logSetupError("Setup completed but the success message could not be edited", error);
    }
  } catch (error) {
    logSetupError(`Setup failed in guild ${session.guildId}`, error);
    const rollbackFailures = await rollbackCreatedRoles(
      createdRoles,
      `Rolling back failed Bridgely setup by ${session.userId}`
    );
    for (const failure of rollbackFailures) {
      logSetupError(`Could not roll back role ${failure.roleName}`, failure.error);
    }
    const userMessage = error instanceof SetupValidationError || error instanceof RobloxSetupError
      ? error.message
      : "Setup could not be completed because an unexpected error occurred.";
    const warnings = [];
    if (deletedRoleNames.length) {
      warnings.push(
        "The selected role wipe had already removed roles, so those deletions could not be rolled back."
      );
    }
    if (rollbackFailures.length) {
      warnings.push(
        `${rollbackFailures.length} newly created role(s) could not be cleaned up; manual cleanup may be required.`
      );
    }
    warnings.push("Any previous saved Bridgely configuration was preserved.");

    session.processing = false;
    clearSession(session);
    try {
      await session.commandInteraction.editReply(
        buildStatus("❌ Setup Failed", `${userMessage}\n\n${warnings.join("\n")}`, 0xed4245)
      );
    } catch (editError) {
      logSetupError("Could not display setup failure", editError);
    }
  }
}

export async function handleSetupInteraction(interaction) {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false;
  const parsed = parseSetupCustomId(interaction.customId);
  if (!parsed) return false;

  const session = sessions.get(parsed.sessionId);
  if (!session) {
    await privateReply(interaction, "This setup session has expired. Run `/setup` to start again.");
    return true;
  }

  if (interaction.user.id !== session.userId) {
    await privateReply(interaction, "This setup session belongs to another user.");
    return true;
  }

  if (interaction.guildId !== session.guildId) {
    await privateReply(interaction, "This setup control is not valid in this server.");
    return true;
  }

  if (session.processing && parsed.action !== "confirm") {
    await privateReply(interaction, "This setup is already being processed.");
    return true;
  }

  try {
    if (interaction.isButton()) {
      await handleButton(interaction, session, parsed.action);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction, session, parsed.action);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction, session, parsed.action);
    }
  } catch (error) {
    session.processing = false;
    logSetupError("Interaction handling failed", error);
    const message = error instanceof SetupValidationError || error instanceof RobloxSetupError
      ? error.message
      : "That setup action could not be completed. Please try again.";
    try {
      await privateReply(interaction, message);
    } catch (replyError) {
      logSetupError("Could not send an interaction error", replyError);
    }
  }

  return true;
}

export async function configurationExists(guildId) {
  return Boolean(await GuildConfiguration.exists({ guildId }));
}
