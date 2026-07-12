import { handleSetupInteraction } from "../../setup/sessions.js";

export default async (client, interaction) => {
  await handleSetupInteraction(interaction);
};
