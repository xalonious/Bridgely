import { PermissionFlagsBits } from "discord.js";
import { startBindManager } from "../../binds/sessions.js";

export default {
  name: "binds",
  description: "View, create, or delete Roblox-to-Discord role binds",
  permissionsRequired: [
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.Administrator,
  ],

  run: async (client, interaction) => {
    await startBindManager(interaction);
  },
};
