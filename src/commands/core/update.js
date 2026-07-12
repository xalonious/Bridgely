import {
  ApplicationCommandOptionType,
  PermissionFlagsBits,
} from "discord.js";
import { refreshVerifiedMember } from "../../verification/interactions.js";

export default {
  name: "update",
  description: "Update another member's Bridgely roles and nickname",
  usage: "<user>",
  options: [
    {
      name: "user",
      description: "The verified server member to update",
      type: ApplicationCommandOptionType.User,
      required: true,
    },
  ],
  permissionsRequired: [
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.Administrator,
  ],

  run: async (client, interaction) => {
    const targetUser = interaction.options.getUser("user", true);
    await refreshVerifiedMember(interaction, {
      ephemeral: false,
      targetUser,
    });
  },
};
