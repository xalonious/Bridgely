import "dotenv/config";

import { Client, IntentsBitField, Partials } from "discord.js";

import eventHandler from "./handlers/eventHandler.js";

const client = new Client({

    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent
    ],
    partials: [
        Partials.GuildMember
    ]

})

eventHandler(client);


client.login(process.env.TOKEN);
