import { handleVerificationInteraction } from "../../verification/interactions.js";

export default async (client, interaction) => {
  await handleVerificationInteraction(interaction);
};
