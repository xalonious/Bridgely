import { startVerification } from "../../verification/interactions.js";

export default {
  name: "verify",
  description: "Verify your Discord account with Roblox",

  run: async (client, interaction) => {
    await startVerification(interaction, { ephemeral: false });
  },
};
