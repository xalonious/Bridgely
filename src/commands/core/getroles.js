import { refreshVerifiedMember } from "../../verification/interactions.js";

export default {
  name: "getroles",
  description: "Update your Bridgely roles and nickname from Roblox",

  run: async (client, interaction) => {
    await refreshVerifiedMember(interaction, { ephemeral: false });
  },
};
