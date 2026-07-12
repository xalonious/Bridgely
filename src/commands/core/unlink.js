import { startUnlink } from "../../verification/interactions.js";

export default {
  name: "unlink",
  description: "Unlink your Roblox account from this Discord server",

  run: async (client, interaction) => {
    await startUnlink(interaction, { ephemeral: false });
  },
};
