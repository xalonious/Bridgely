import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { fetchRobloxHeadshot } from "../verification/roblox.js";
import { warn } from "../utils/logger.js";

export async function logRankOperation({ interaction, action, executor, target, role }) {
  const channelId = process.env.LOG_CHANNEL_ID?.trim();
  if (!channelId) return;
  try {
    const channel = interaction.client.channels.cache.get(channelId) ||
      await interaction.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== "function") {
      throw new Error("The configured channel cannot receive messages.");
    }
    let avatarUrl;
    try {
      avatarUrl = await fetchRobloxHeadshot(Number(target.id));
    } catch (error) {
      console.error(warn(`[Ranking] Could not load audit thumbnail: ${error?.message || error}`));
    }

    const targetName = escapeMarkdown(target.username);
    const rankName = escapeMarkdown(role.displayName);
    const embed = new EmbedBuilder()
      .setColor(action === "add" ? 0x2ecc71 : 0xe67e22)
      .setTitle(action === "add" ? "User rank added" : "User rank removed")
      .setDescription(
        `Rank **${rankName}** was ${action === "add" ? "added to" : "removed from"} **${targetName}**.\n\n` +
        `Action performed by <@${interaction.user.id}> (${escapeMarkdown(executor.robloxUsername)}).`
      )
      .setTimestamp();
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(warn(`[Ranking] Audit log failed: ${error?.message || error}`));
  }
}
