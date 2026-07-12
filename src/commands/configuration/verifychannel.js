import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  escapeMarkdown,
} from "discord.js";
import GuildConfiguration from "../../schemas/guildConfiguration.js";

const VERIFY_IMAGE_URL = "https://cdn.discordapp.com/attachments/1452039120003141642/1525271727364636713/bot_pfp.png?ex=6a52c77d&is=6a5175fd&hm=d557ee345a7327774a9fe8ce089707b115aa88c5f0de487fa28dfff1dcb04d62&";

export default {
  name: "verifychannel",
  description: "Post the Bridgely verification panel in a channel",
  usage: "<?channel>",
  options: [
    {
      name: "channel",
      description: "The channel where Bridgely should post the verification panel",
      type: ApplicationCommandOptionType.Channel,
      channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      required: false,
    },
  ],
  permissionsRequired: [
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.Administrator,
  ],

  run: async (client, interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const configuration = await GuildConfiguration.exists({
      guildId: interaction.guildId,
    });

    if (!configuration) {
      await interaction.editReply({
        content: "Configure Bridgely with `/setup` before creating a verification channel.",
      });
      return;
    }

    const targetChannel = interaction.options.getChannel("channel") || interaction.channel;
    if (!targetChannel.isTextBased() || typeof targetChannel.send !== "function") {
      await interaction.editReply({
        content: "Choose a text or announcement channel where Bridgely can send messages.",
      });
      return;
    }

    const botMember = interaction.guild.members.me ||
      await interaction.guild.members.fetchMe();
    const channelPermissions = targetChannel.permissionsFor(botMember);
    const missingPermissions = [
      [PermissionFlagsBits.ViewChannel, "View Channel"],
      [PermissionFlagsBits.SendMessages, "Send Messages"],
      [PermissionFlagsBits.EmbedLinks, "Embed Links"],
    ]
      .filter(([permission]) => !channelPermissions?.has(permission))
      .map(([, label]) => label);

    if (missingPermissions.length) {
      await interaction.editReply({
        content: `Bridgely is missing required permissions in <#${targetChannel.id}>: ${missingPermissions.join(", ")}.`,
      });
      return;
    }

    const serverName = escapeMarkdown(interaction.guild.name);
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor({ name: "Bridgely Verification", iconURL: VERIFY_IMAGE_URL })
      .setTitle(`Welcome to ${serverName}!`)
      .setDescription(
        "Connect your Discord account to Roblox to verify your identity and gain access to the rest of the server. Click the button below to begin."
      )
      .setThumbnail(VERIFY_IMAGE_URL)
      .setFooter({ text: "Secure verification powered by Bridgely" });

    const verifyButton = new ButtonBuilder()
      .setCustomId("bridgely:verify:start")
      .setLabel("Verify with Bridgely")
      .setStyle(ButtonStyle.Success);

    await targetChannel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(verifyButton)],
    });

    await interaction.editReply({
      content: `The Bridgely verification panel was sent to <#${targetChannel.id}>.`,
    });
  },
};
