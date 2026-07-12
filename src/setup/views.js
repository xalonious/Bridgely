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
import {
  NICKNAME_PREVIEW_VALUES,
  NICKNAME_TEMPLATES,
  ROLE_HANDLING,
  ROLE_HANDLING_LABELS,
  SETUP_COLOR,
} from "./constants.js";
import { renderNicknameTemplate } from "./nickname.js";

const BUTTON_EMOJIS = Object.freeze({
  replace_continue: "🔄",
  welcome_next: "➡️",
  group_enter: "🔎",
  group_confirm: "✅",
  group_back: "⬅️",
  strategy_back: "⬅️",
  strategy_next: "➡️",
  verified_default: "✅",
  verified_custom: "✏️",
  verified_back: "⬅️",
  nickname_back: "⬅️",
  nickname_next: "➡️",
  review_back: "⬅️",
  confirm: "🚀",
  cancel: "✖️",
});

function customId(session, action) {
  return `setup:${session.id}:${action}`;
}

function safe(value, fallback = "Not available") {
  const text = String(value ?? "").trim();
  return text ? escapeMarkdown(text).slice(0, 1024) : fallback;
}

function embed(title, description, step) {
  const builder = new EmbedBuilder()
    .setColor(SETUP_COLOR)
    .setTitle(title)
    .setDescription(description);
  if (step) builder.setFooter({ text: `Bridgely Setup • Step ${step} of 6` });
  return builder;
}

function button(session, action, label, style = ButtonStyle.Secondary, disabled = false) {
  const builder = new ButtonBuilder()
    .setCustomId(customId(session, action))
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);

  const emoji = BUTTON_EMOJIS[action];
  if (emoji) builder.setEmoji(emoji);
  return builder;
}

function navigationRow(session, { back, next, nextDisabled = false } = {}) {
  const row = new ActionRowBuilder();
  if (back) row.addComponents(button(session, back, "Back"));
  if (next) {
    row.addComponents(
      button(session, next, "Next", ButtonStyle.Primary, nextDisabled)
    );
  }
  row.addComponents(button(session, "cancel", "Cancel", ButtonStyle.Danger));
  return row;
}

export function buildExistingConfigurationWarning(session) {
  return {
    embeds: [
      embed(
        "⚠️ Bridgely is Already Configured",
        "This server already has an active configuration. Continuing will prepare new settings, but **nothing will be replaced** until you review everything and confirm the final step."
      ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        button(
          session,
          "replace_continue",
          "Continue and reset settings",
          ButtonStyle.Danger
        ),
        button(session, "cancel", "Cancel")
      ),
    ],
  };
}

function buildWelcome(session) {
  return {
    embeds: [
      embed(
        "✨ Setup Bridgely",
        "Welcome! This guided setup will get Bridgely ready for your community.\n\n> 🔗 Connect your Roblox group\n> 🎭 Configure group roles\n> ✅ Create a verified role\n> 🏷️ Choose a nickname format",
        1
      ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        button(session, "welcome_next", "Next", ButtonStyle.Primary),
        button(session, "cancel", "Cancel", ButtonStyle.Danger)
      ),
    ],
  };
}

function buildGroupStep(session) {
  const group = session.group;
  const groupEmbed = embed(
    "🔗 Connect a Roblox Group",
    group
      ? "This group was resolved directly through Roblox. Confirm it to continue, or enter a different group."
      : "Enter a numeric Roblox group ID or a full roblox.com community URL. Bridgely will validate it directly with Roblox.",
    2
  );

  if (group) {
    groupEmbed.addFields(
      { name: "🎮 Group", value: safe(group.name), inline: true },
      { name: "🆔 Group ID", value: String(group.id), inline: true },
      { name: "👑 Owner", value: safe(group.ownerName), inline: true },
      {
        name: "👥 Members",
        value: group.memberCount == null
          ? "Not available"
          : group.memberCount.toLocaleString(),
        inline: true,
      }
    );
  }

  const choices = new ActionRowBuilder();
  if (group) {
    choices.addComponents(
      button(session, "group_confirm", "Confirm Group", ButtonStyle.Success),
      button(session, "group_enter", "Enter Different Group", ButtonStyle.Primary)
    );
  } else {
    choices.addComponents(
      button(session, "group_enter", "Enter Roblox Group", ButtonStyle.Primary)
    );
  }
  choices.addComponents(
    button(session, "group_back", "Back"),
    button(session, "cancel", "Cancel", ButtonStyle.Danger)
  );

  return { embeds: [groupEmbed], components: [choices] };
}

function buildRoleStrategyStep(session) {
  const selected = session.roleHandlingStrategy;
  const description = selected === ROLE_HANDLING.WIPE_MANAGEABLE
    ? "⚠️ **Destructive choice selected.** After final confirmation, Bridgely will remove only roles below its highest role that Discord allows it to manage. Integration, managed, bot, booster, and @everyone roles are always preserved."
    : "Choose whether Bridgely should preserve existing roles or remove only roles it can safely manage. No roles are changed until final confirmation.";

  const strategyEmbed = embed("🎭 Handle Existing Discord Roles", description, 3);
  if (selected) {
    strategyEmbed.addFields({
      name: "✅ Selected Strategy",
      value: ROLE_HANDLING_LABELS[selected],
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(session, "strategy_select"))
    .setPlaceholder("Choose an existing-role strategy")
    .addOptions(
      {
        label: "Keep existing roles",
        description: "Preserve roles and safely reuse suitable exact matches.",
        value: ROLE_HANDLING.KEEP_EXISTING,
        emoji: { name: "🛡️" },
        default: selected === ROLE_HANDLING.KEEP_EXISTING,
      },
      {
        label: "Remove manageable roles first",
        description: "Delete only safe roles below Bridgely before creating roles.",
        value: ROLE_HANDLING.WIPE_MANAGEABLE,
        emoji: { name: "🧹" },
        default: selected === ROLE_HANDLING.WIPE_MANAGEABLE,
      }
    );

  return {
    embeds: [strategyEmbed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      navigationRow(session, {
        back: "strategy_back",
        next: "strategy_next",
        nextDisabled: !selected,
      }),
    ],
  };
}

function buildVerifiedRoleStep(session) {
  const roleEmbed = embed(
    "✅ Choose the Verified Role Name",
    "Use the default role name or enter a custom name. Bridgely will safely reuse a suitable exact match when possible.",
    4
  ).addFields({
    name: "🏷️ Current Choice",
    value: safe(session.verifiedRoleName),
  });

  return {
    embeds: [roleEmbed],
    components: [
      new ActionRowBuilder().addComponents(
        button(session, "verified_default", 'Use "Verified"', ButtonStyle.Primary),
        button(session, "verified_custom", "Choose custom name"),
        button(session, "verified_back", "Back"),
        button(session, "cancel", "Cancel", ButtonStyle.Danger)
      ),
    ],
  };
}

function buildNicknameStep(session) {
  const preview = renderNicknameTemplate(
    session.nicknameTemplate,
    NICKNAME_PREVIEW_VALUES
  );
  const nicknameEmbed = embed(
    "🏷️ Choose a Nickname Format",
    "Select how verified members should be named. Nicknames are safely shortened to Discord's 32-character limit.",
    5
  ).addFields(
    { name: "📝 Selected Format", value: safe(session.nicknameTemplateLabel) },
    { name: "👀 Preview", value: `**${safe(preview)}**` }
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(session, "nickname_select"))
    .setPlaceholder("Choose a nickname format")
    .addOptions(
      NICKNAME_TEMPLATES.map((option, index) => ({
        label: option.label,
        value: option.value,
        emoji: { name: ["🔗", "💬", "🎮", "🎯", "✨", "🪪"][index] },
        default: option.value === session.nicknameTemplate,
      }))
    );

  return {
    embeds: [nicknameEmbed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      navigationRow(session, { back: "nickname_back", next: "nickname_next" }),
    ],
  };
}

function buildReviewStep(session) {
  const preview = renderNicknameTemplate(
    session.nicknameTemplate,
    NICKNAME_PREVIEW_VALUES
  );
  const reviewEmbed = embed(
    "📋 Review Bridgely Setup",
    "Take one last look before continuing. **Nothing has been changed yet.** Confirm when everything looks right.",
    6
  ).addFields(
    { name: "🏠 Discord Server", value: safe(session.guildName), inline: true },
    { name: "🎮 Roblox Group", value: safe(session.group?.name), inline: true },
    { name: "🆔 Roblox Group ID", value: String(session.group?.id), inline: true },
    {
      name: "🎭 Existing Roles",
      value: ROLE_HANDLING_LABELS[session.roleHandlingStrategy],
      inline: true,
    },
    { name: "✅ Verified Role", value: safe(session.verifiedRoleName), inline: true },
    {
      name: "🏷️ Nickname Format",
      value: safe(session.nicknameTemplateLabel),
      inline: true,
    },
    { name: "👀 Nickname Preview", value: safe(preview), inline: true },
    {
      name: "💾 Existing Configuration",
      value: session.replacesExisting ? "Will be replaced" : "None",
      inline: true,
    }
  );

  return {
    embeds: [reviewEmbed],
    components: [
      new ActionRowBuilder().addComponents(
        button(session, "confirm", "Confirm Setup", ButtonStyle.Success),
        button(session, "review_back", "Back"),
        button(session, "cancel", "Cancel", ButtonStyle.Danger)
      ),
    ],
  };
}

export function buildStep(session) {
  switch (session.step) {
    case 1: return buildWelcome(session);
    case 2: return buildGroupStep(session);
    case 3: return buildRoleStrategyStep(session);
    case 4: return buildVerifiedRoleStep(session);
    case 5: return buildNicknameStep(session);
    case 6: return buildReviewStep(session);
    default: return buildWelcome(session);
  }
}

export function buildGroupModal(session) {
  const input = new TextInputBuilder()
    .setCustomId("group_input")
    .setLabel("Roblox group ID or URL")
    .setPlaceholder("123456 or https://roblox.com/communities/123456")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  return new ModalBuilder()
    .setCustomId(customId(session, "group_modal"))
    .setTitle("🔗 Connect a Roblox Group")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export function buildVerifiedRoleModal(session) {
  const input = new TextInputBuilder()
    .setCustomId("role_name")
    .setLabel("Verified role name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setValue(session.verifiedRoleName || "Verified");

  return new ModalBuilder()
    .setCustomId(customId(session, "verified_modal"))
    .setTitle("✅ Choose a Verified Role Name")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export function buildStatus(title, description, color = SETUP_COLOR) {
  return {
    embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description)],
    components: [],
  };
}

export function buildProgress(message) {
  return buildStatus("⚙️ Setting up Bridgely", `⏳ ${message}`);
}
