import { EmbedBuilder } from "discord.js";
import { warn } from "../utils/logger.js";

export async function logRankOperation({ interaction, action, executor, target, role, groupId }) {
  const channelId = process.env.LOG_CHANNEL_ID?.trim();
  if (!channelId) return;
  try {
    const channel = interaction.client.channels.cache.get(channelId) ||
      await interaction.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== "function") {
      throw new Error("The configured channel cannot receive messages.");
    }
    const embed = new EmbedBuilder()
      .setColor(action === "add" ? 0x2ecc71 : 0xe67e22)
      .setTitle(action === "add" ? "Add Rank" : "Remove Rank")
      .addFields(
        { name: "Executor Discord", value: `${interaction.user.username} (${interaction.user.id})` },
        { name: "Executor Roblox", value: `${executor.robloxUsername} (${executor.robloxUserId})` },
        { name: "Target Roblox", value: `${target.username} (${target.id})` },
        { name: "Rank", value: `${role.displayName} (${role.id})` },
        { name: "Group", value: String(groupId) },
        { name: "Discord server", value: `${interaction.guild?.name ?? "Unknown"} (${interaction.guildId})` },
      )
      .setTimestamp();
    if (target.discordUser) {
      embed.addFields({ name: "Target Discord", value: `${target.discordUser.username} (${target.discordUser.id})` });
    }
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(warn(`[Ranking] Audit log failed: ${error?.message || error}`));
  }
}
