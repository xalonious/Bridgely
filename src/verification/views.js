import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} from "discord.js";
import { VERIFICATION_COLOR, VERIFICATION_METHODS } from "./constants.js";
import { getGameVerificationConfig } from "../server/config.js";

export function buildMethodSelection(ownerId) {
  const embed = new EmbedBuilder()
    .setColor(VERIFICATION_COLOR)
    .setTitle("🔗 Verify with Bridgely")
    .setDescription(
      "Choose how you would like to connect your Discord account to Roblox."
    )
    .addFields(
      {
        name: "📝 Roblox Profile Code",
        value: "Place a short, temporary code in your Roblox profile About section.",
      },
      {
        name: "🎮 Roblox Game",
        value: "Verify instantly by joining the configured Roblox experience.",
      }
    )
    .setFooter({ text: "Your verification response is private" });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bridgely:verify:method:${ownerId}`)
    .setPlaceholder("Choose a verification method")
    .addOptions(
      {
        label: "Verify using a Roblox profile code",
        description: "Add a secure code to your Roblox About section.",
        value: VERIFICATION_METHODS.PROFILE_CODE,
        emoji: { name: "📝" },
      },
      {
        label: "Verify by joining a Roblox game",
        description: "Join the verification experience.",
        value: VERIFICATION_METHODS.GAME,
        emoji: { name: "🎮" },
      }
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

export function buildUsernameModal(
  ownerId,
  method = VERIFICATION_METHODS.PROFILE_CODE
) {
  const username = new TextInputBuilder()
    .setCustomId("roblox_username")
    .setLabel("Roblox username")
    .setPlaceholder("Enter your Roblox username")
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(20)
    .setRequired(true);

  const action = method === VERIFICATION_METHODS.GAME
    ? "username-game"
    : "username";
  return new ModalBuilder()
    .setCustomId(`bridgely:verify:${action}:${ownerId}`)
    .setTitle("🔎 Find Your Roblox Account")
    .addComponents(new ActionRowBuilder().addComponents(username));
}

export function buildGameInstructions(session) {
  const config = getGameVerificationConfig();
  const username = escapeMarkdown(session.robloxUsername);
  const embed = new EmbedBuilder()
    .setColor(VERIFICATION_COLOR)
    .setTitle("🎮 Join the Bridgely Verification Game")
    .setDescription(
      "Join the Roblox experience using the account below. The game will verify you automatically and update this message when finished."
    )
    .addFields(
      {
        name: "Roblox Account",
        value: `[@${username}](https://www.roblox.com/users/${session.robloxUserId}/profile)`,
        inline: true,
      },
      {
        name: "Expires",
        value: `<t:${Math.floor(session.expiresAt.getTime() / 1000)}:R>`,
        inline: true,
      }
    )
    .setFooter({ text: "The game must be joined with this exact Roblox account" });
  if (session.avatarUrl) embed.setThumbnail(session.avatarUrl);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Join Verification Game")
        .setEmoji("🎮")
        .setStyle(ButtonStyle.Link)
        .setURL(config.gameUrl),
      new ButtonBuilder()
        .setCustomId(`bridgely:verify:cancel:${session.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger)
    )],
  };
}

export function buildProfileInstructions(session, notice = null) {
  const username = escapeMarkdown(session.robloxUsername);
  const profileUrl = `https://www.roblox.com/users/${session.robloxUserId}/profile`;
  const embed = new EmbedBuilder()
    .setColor(notice ? 0xfee75c : VERIFICATION_COLOR)
    .setTitle("🔐 Verify Your Roblox Profile")
    .setDescription(
      "Complete these steps before the session expires:\n\n" +
      "**1.** Open your Roblox profile.\n" +
      "**2.** Add the exact code below anywhere in your **About** section.\n" +
      "**3.** Save the profile, then return here and press **Confirm**."
    )
    .addFields(
      {
        name: "🎮 Roblox Account",
        value: `[@${username}](${profileUrl})`,
        inline: true,
      },
      {
        name: "⏱️ Expires",
        value: `<t:${Math.floor(new Date(session.expiresAt).getTime() / 1000)}:R>`,
        inline: true,
      },
      {
        name: "🔑 Verification Code",
        value: `\`\`\`${session.verificationCode}\`\`\``,
      }
    )
    .setFooter({
      text: `Confirmation attempts: ${session.confirmationAttempts || 0}`,
    });

  if (session.avatarUrl) embed.setThumbnail(session.avatarUrl);

  if (notice) {
    embed.addFields({ name: "⚠️ Not Verified Yet", value: notice });
  }

  const sessionId = String(session.id ?? session._id);
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bridgely:verify:confirm:${sessionId}`)
      .setLabel("Confirm")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bridgely:verify:cancel:${sessionId}`)
      .setLabel("Cancel")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [buttons] };
}

export function buildCheckingProfile() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(VERIFICATION_COLOR)
        .setTitle("🔎 Checking Your Roblox Profile")
        .setDescription("Please wait while Bridgely checks your current About section..."),
    ],
    components: [],
  };
}

export function buildVerificationStatus(title, description, color = VERIFICATION_COLOR) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description),
    ],
    components: [],
  };
}

function formatRoleMentions(roles, emptyText) {
  if (!roles.length) return emptyText;
  const mentions = roles.map((role) => `<@&${role.id}>`);
  let value = "";
  for (let index = 0; index < mentions.length; index += 1) {
    const next = value ? `${value}, ${mentions[index]}` : mentions[index];
    if (next.length > 980) {
      return `${value}\n…and ${mentions.length - index} more`;
    }
    value = next;
  }
  return value;
}

export function buildMemberUpdated({
  profile,
  syncResult,
  avatarUrl,
  robloxAvatarUrl,
  isNewVerification = true,
  discordUserId = null,
  isSelf = true,
}) {
  const addedRoles = formatRoleMentions(
    syncResult.addedRoles,
    "None — already up to date"
  );
  const removedRoles = formatRoleMentions(syncResult.removedRoles, "None");

  const embed = new EmbedBuilder()
    .setColor(syncResult.warnings.length ? 0xfee75c : 0x57f287)
    .setAuthor({
      name: profile.username,
      ...(avatarUrl ? { iconURL: avatarUrl } : {}),
    })
    .setTitle("🎉 Member Updated")
    .setDescription(
      isNewVerification
        ? `Welcome! Your Discord account is now connected to **@${escapeMarkdown(profile.username)}**.`
        : `${isSelf ? "Your" : `<@${discordUserId}>'s`} roles and nickname were refreshed for **@${escapeMarkdown(profile.username)}**.`
    )
    .addFields(
      { name: "➕ Added Roles", value: addedRoles, inline: true },
      { name: "➖ Removed Roles", value: removedRoles, inline: true },
      {
        name: "🏷️ Nickname",
        value: escapeMarkdown(syncResult.nickname || "Unchanged"),
        inline: true,
      },
      {
        name: "🎭 Roblox Group Roles",
        value: escapeMarkdown(syncResult.groupRoleName),
        inline: true,
      }
    )
    .setFooter({
      text: "Want to switch accounts? You can unlink at any time with /unlink",
    });

  if (robloxAvatarUrl) embed.setThumbnail(robloxAvatarUrl);

  if (syncResult.warnings.length) {
    embed.addFields({
      name: "⚠️ Sync Notes",
      value: syncResult.warnings.map((warning) => `• ${warning}`).join("\n").slice(0, 1024),
    });
  }

  return { embeds: [embed], components: [] };
}

export function buildUnlinkConfirmation(link, notice = null) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ Unlink Roblox Account?")
    .setDescription(
      `You are about to unlink **@${escapeMarkdown(link.robloxUsername)}**.\n\n` +
      "This removes your Bridgely verified role and every configured Roblox group role. " +
      "You will need to verify again to restore access."
    );

  if (notice) {
    embed.addFields({
      name: "❌ Unlink Incomplete",
      value: String(notice).slice(0, 1024),
    });
  }

  const linkId = String(link._id);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bridgely:verify:unlink-confirm:${linkId}`)
        .setLabel("Confirm Unlink")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`bridgely:verify:unlink-cancel:${linkId}`)
        .setLabel("Cancel")
        .setEmoji("✖️")
        .setStyle(ButtonStyle.Secondary)
    )],
  };
}

export function buildUnlinkComplete(removedRoles) {
  return buildVerificationStatus(
    "🔓 Account Unlinked",
    `Your Roblox account was unlinked successfully.\n\n**Removed Roles**\n${formatRoleMentions(removedRoles, "None")}`,
    0x57f287
  );
}
