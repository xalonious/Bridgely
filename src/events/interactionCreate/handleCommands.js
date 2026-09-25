import "dotenv/config";

import { MessageFlags } from "discord.js";
import getLocalCommands from "../../utils/getLocalCommands.js";
import { err } from "../../utils/logger.js";

const dev = process.env.DEV_ID;
const devs = [dev].filter(Boolean);

export default async (client, interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) return;

    const testmode = false;
    if (testmode && interaction.user.id !== dev) {
        return interaction.reply("The bot is currently in test mode, please try again later");
    }

    const localCommands = await getLocalCommands();
    const commandObject = localCommands.find((cmd) => cmd.name === interaction.commandName);

    if (!commandObject) return;

    if (interaction.isAutocomplete()) {
        try {
            if (commandObject.autocomplete) await commandObject.autocomplete(interaction);
            else await interaction.respond([]);
        } catch (error) {
            console.error(err(`[Commands] Autocomplete failed: ${error?.stack || error}`));
            if (!interaction.responded) await interaction.respond([]).catch(() => {});
        }
        return;
    }

    if (commandObject.devOnly && !devs.includes(interaction.member.id)) {
        return interaction.reply("Only the developer is able to use this command.");
    }

    if (commandObject.permissionsRequired?.every((permission) => !interaction.member.permissions.has(permission))) {
        return interaction.reply({
            content: "You do not have permission to run that command!",
            flags: MessageFlags.Ephemeral,
        });
    }

    if (commandObject.rolesRequired?.length > 0 && !interaction.member.roles.cache.some((role) => commandObject.rolesRequired.includes(role.id))) {
        return interaction.reply({
            content: "You do not have permission to run that command!",
            flags: MessageFlags.Ephemeral,
        });
    }

    try {
        await commandObject.run(client, interaction);
    } catch (error) {
        console.error(err(`[Commands] ${interaction.commandName} failed: ${error?.stack || error}`));

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp("There was an error while running this command.");
        } else {
            await interaction.reply("There was an error while running this command.");
        }
    }
};
