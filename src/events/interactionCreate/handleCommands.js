import "dotenv/config";

import { MessageFlags } from "discord.js";
import { err } from "../../utils/logger.js";
import getLocalCommands from "../../utils/getLocalCommands.js";

const dev = process.env.DEV_ID;
const devs = [dev].filter(Boolean);

export default async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const testmode = false;
    if (testmode && interaction.user.id !== dev) {
        return interaction.reply("The bot is currently in test mode, pls try again later");
    }

    const localCommands = await getLocalCommands();
    const commandObject = localCommands.find((cmd) => cmd.name === interaction.commandName);

    if (!commandObject) return;

    if (commandObject.devOnly && !devs.includes(interaction.user.id)) {
        return interaction.reply("Only the developer is able to use this command.");
    }

    if (commandObject.permissionsRequired?.length > 0 && !interaction.inCachedGuild()) {
        return interaction.reply({
            content: "That command can only be used in a Discord server.",
            flags: MessageFlags.Ephemeral,
        });
    }

    if (commandObject.permissionsRequired?.length > 0 &&
        !commandObject.permissionsRequired.some((permission) => interaction.member.permissions.has(permission))) {
        return interaction.reply({
            content: "You do not have permission to run that command!",
            flags: MessageFlags.Ephemeral,
        });
    }

    if (commandObject.rolesRequired?.length > 0 &&
        (!interaction.inCachedGuild() || !interaction.member.roles.cache.some((role) => commandObject.rolesRequired.includes(role.id)))) {
        return interaction.reply({
            content: "You do not have permission to run that command!",
            flags: MessageFlags.Ephemeral,
        });
    }

    try {
        await commandObject.run(client, interaction);
    } catch (error) {
        console.error(err(`[Command:${interaction.commandName}] ${error?.stack || error}`));

        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({
                content: "There was an unexpected error while running this command.",
            });
        } else if (interaction.replied) {
            await interaction.followUp({
                content: "There was an unexpected error while running this command.",
                flags: MessageFlags.Ephemeral,
            });
        } else {
            await interaction.reply({
                content: "There was an unexpected error while running this command.",
                flags: MessageFlags.Ephemeral,
            });
        }
    }
};
