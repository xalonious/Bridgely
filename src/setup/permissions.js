import { PermissionFlagsBits } from "discord.js";

const BOT_GUILD_PERMISSIONS = Object.freeze([
  [PermissionFlagsBits.ManageRoles, "Manage Roles"],
]);

const BOT_CHANNEL_PERMISSIONS = Object.freeze([
  [PermissionFlagsBits.SendMessages, "Send Messages"],
  [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  [PermissionFlagsBits.UseApplicationCommands, "Use Application Commands"],
]);

export class SetupValidationError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "SetupValidationError";
  }
}

export function hasSetupPermission(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
      member?.permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

export async function validateSetupPermissions(
  interaction,
  { requireManageNicknames = false } = {}
) {
  if (!interaction.inCachedGuild()) {
    throw new SetupValidationError("The setup command can only be used in a Discord server.");
  }

  if (!hasSetupPermission(interaction.member)) {
    throw new SetupValidationError(
      "You need Manage Server or Administrator permission to configure Bridgely."
    );
  }

  let botMember;
  try {
    botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
  } catch (error) {
    throw new SetupValidationError("Bridgely could not inspect its server permissions.", error);
  }

  const missing = [];
  for (const [permission, label] of BOT_GUILD_PERMISSIONS) {
    if (!botMember.permissions.has(permission)) missing.push(label);
  }
  if (
    requireManageNicknames &&
    !botMember.permissions.has(PermissionFlagsBits.ManageNicknames)
  ) {
    missing.push("Manage Nicknames");
  }

  const channelPermissions = interaction.channel?.permissionsFor?.(botMember);
  for (const [permission, label] of BOT_CHANNEL_PERMISSIONS) {
    if (!channelPermissions?.has(permission)) missing.push(label);
  }

  if (missing.length) {
    throw new SetupValidationError(
      `Bridgely is missing required permissions: ${[...new Set(missing)].join(", ")}.`
    );
  }

  if (botMember.roles.highest.id === interaction.guild.id) {
    throw new SetupValidationError(
      "Move Bridgely's bot role above the roles it needs to manage, then run setup again."
    );
  }

  return botMember;
}
