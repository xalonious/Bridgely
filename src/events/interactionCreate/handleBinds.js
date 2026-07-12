import { handleBindInteraction } from "../../binds/sessions.js";

export default async (client, interaction) => {
  await handleBindInteraction(interaction);
};
