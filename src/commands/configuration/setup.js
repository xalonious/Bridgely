import { MessageFlags, PermissionFlagsBits } from "discord.js";
import {
  configurationExists,
  startSetupSession,
} from "../../setup/sessions.js";
import {
  SetupValidationError,
  validateSetupPermissions,
} from "../../setup/permissions.js";

export default {
  name: "setup",
  description: "Setup Bridgely for your server.",
  permissionsRequired: [
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.Administrator,
  ],

  run: async (client, interaction) => {
    try {
      await validateSetupPermissions(interaction);
      const replacesExisting = await configurationExists(interaction.guildId);
      await startSetupSession(interaction, replacesExisting);
    } catch (error) {
      if (!(error instanceof SetupValidationError)) throw error;
      await interaction.reply({
        content: error.message,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
