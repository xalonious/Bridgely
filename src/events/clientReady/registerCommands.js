import "dotenv/config";

import getApplicationCommands from "../../utils/getApplicationCommands.js";
import getLocalCommands from "../../utils/getLocalCommands.js";
import { ok, warn } from "../../utils/logger.js";

const server = process.env.SERVER_ID;

const toApplicationCommandData = ({ name, description, options = [] }) => ({
  name,
  description,
  options,
});

export default async (client) => {
  try {
    const localCommands = await getLocalCommands();
    const applicationCommands = await getApplicationCommands(client, server);

    let created = 0;
    let edited = 0;
    let deleted = 0;

    for (const existingCommand of applicationCommands.cache.values()) {
      const localMatch = localCommands.find(
        (cmd) => cmd.name === existingCommand.name
      );

      if (!localMatch || localMatch.deleted) {
        await applicationCommands.delete(existingCommand.id);
        deleted++;
        console.log(`🗑️ Deleted command ${existingCommand.name}`);
      }
    }

    for (const localCommand of localCommands) {
      if (localCommand.deleted) continue;

      const commandData = toApplicationCommandData(localCommand);
      const { name } = commandData;

      const existingCommand = applicationCommands.cache.find(
        (cmd) => cmd.name === name
      );

      if (existingCommand) {
        if (!existingCommand.equals(commandData, true)) {
          await applicationCommands.edit(existingCommand.id, commandData);

          edited++;
          console.log(`🔀 Edited command ${name}`);
        }
      } else {
        await applicationCommands.create(commandData);

        created++;
        console.log(`👍 Registered command ${name}`);
      }
    }

    await applicationCommands.fetch();
    const registered = applicationCommands.cache.size;

    console.log(
      ok
        ? ok(`✅ Commands registered: ${registered} (${created} new, ${edited} updated, ${deleted} removed)`)
        : `✅ Commands registered: ${registered} (${created} new, ${edited} updated, ${deleted} removed)`
    );
  } catch (error) {
    console.log(
      warn
        ? warn(`⚠️ An error occurred while registering commands: ${error}`)
        : `⚠️ An error occurred while registering commands: ${error}`
    );
  }
};
