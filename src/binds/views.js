import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} from "discord.js";
import {
  BIND_COLOR,
  BIND_TYPES,
  GROUP_CONDITIONS,
  MAX_BOUND_DISCORD_ROLES,
} from "./constants.js";

const TYPE_LABELS = {
  GROUP: "Group Rank",
  BADGE: "Badge",
  GAMEPASS: "Game Pass",
};

const CONDITION_LABELS = {
  EXACT: "Rank matches any selected roleset",
  GTE: "Rank is greater than or equal to",
  LTE: "Rank is less than or equal to",
  BETWEEN: "Rank is between two rolesets",
  MEMBER: "User is a member of the group",
};

function controls(session, { back = null, confirm = null } = {}) {
  const row = new ActionRowBuilder();
  if (back) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bind:${session.id}:${back}`)
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (confirm) row.addComponents(confirm);
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`bind:${session.id}:cancel`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );
  return row;
}

export function describeCriteria(bind) {
  const criteria = bind.criteria ?? {};
  if (criteria.condition === GROUP_CONDITIONS.EXACT) {
    return `Rank equals ${criteria.ranks.join(", ")}`;
  }
  if (criteria.condition === GROUP_CONDITIONS.GTE) return `Rank ≥ ${criteria.minRank}`;
  if (criteria.condition === GROUP_CONDITIONS.LTE) return `Rank ≤ ${criteria.maxRank}`;
  if (criteria.condition === GROUP_CONDITIONS.BETWEEN) {
    return `Rank ${criteria.minRank}–${criteria.maxRank}`;
  }
  return "Any group member";
}

export function describeBind(bind) {
  const target = bind.type === BIND_TYPES.GROUP
    ? describeCriteria(bind)
    : `${escapeMarkdown(bind.assetName || TYPE_LABELS[bind.type])} (ID ${bind.assetId})`;
  const roles = (bind.discordRoleIds ?? []).map((id) => `<@&${id}>`).join(", ");
  return `**${TYPE_LABELS[bind.type]}:** ${target}\n**Roles:** ${roles || "None"}`;
}

export function buildBindList(session) {
  const visible = session.binds.slice(0, 25);
  const description = visible.length
    ? visible.map((bind, index) => `**${index + 1}.** ${describeBind(bind)}`).join("\n\n")
    : "No binds have been configured yet.";
  const embed = new EmbedBuilder()
    .setColor(BIND_COLOR)
    .setTitle("🔗 Bridgely Binds")
    .setDescription(description.slice(0, 4096))
    .setFooter({ text: `${session.binds.length} of 25 binds configured` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bind:${session.id}:create`)
      .setLabel("Create Bind")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bind:${session.id}:delete`)
      .setLabel("Delete Bind")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!session.binds.length)
  );

  if (session.binds.some((bind) => bind.missingRoleIds?.length)) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`bind:${session.id}:repair`)
      .setLabel("Repair Bind")
      .setEmoji("🛠️")
      .setStyle(ButtonStyle.Primary)
    );
  }
  return { embeds: [embed], components: [row] };
}

export function buildTypeSelection(session) {
  const embed = new EmbedBuilder()
    .setColor(BIND_COLOR)
    .setTitle("➕ Create a Bind")
    .setDescription("Choose which Roblox condition should grant one or more Discord roles.");
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bind:${session.id}:type`)
    .setPlaceholder("Choose a bind type")
    .addOptions(
      { label: "Linked Group Rank", value: BIND_TYPES.GROUP, emoji: "👥" },
      { label: "Roblox Badge", value: BIND_TYPES.BADGE, emoji: "🏅" },
      { label: "Roblox Game Pass", value: BIND_TYPES.GAMEPASS, emoji: "🎟️" }
    );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), controls(session, { back: "home" })] };
}

export function buildAssetPrompt(session, notice = null) {
  const label = TYPE_LABELS[session.type];
  const embed = new EmbedBuilder()
    .setColor(notice ? 0xfee75c : BIND_COLOR)
    .setTitle(`${session.type === BIND_TYPES.BADGE ? "🏅" : "🎟️"} Bind a Roblox ${label}`)
    .setDescription(`Enter the numeric Roblox ${label.toLowerCase()} ID. Bridgely will validate it directly with Roblox.`);
  if (notice) embed.addFields({ name: "Could Not Validate", value: notice });
  const enter = new ButtonBuilder()
    .setCustomId(`bind:${session.id}:asset_enter`)
    .setLabel(`Enter ${label} ID`)
    .setStyle(ButtonStyle.Primary);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(enter), controls(session, { back: "create" })] };
}

export function buildAssetModal(session) {
  const label = TYPE_LABELS[session.type];
  const input = new TextInputBuilder()
    .setCustomId("asset_id")
    .setLabel(`${label} ID`)
    .setPlaceholder("Enter a numeric Roblox ID")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(16)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`bind:${session.id}:asset_submit`)
    .setTitle(`Bind a Roblox ${label}`)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export function buildConditionSelection(session) {
  const embed = new EmbedBuilder()
    .setColor(BIND_COLOR)
    .setTitle("👥 Make a Group Bind")
    .setDescription("Choose how a member's rank in the linked Roblox group should be evaluated.");
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bind:${session.id}:condition`)
    .setPlaceholder("Select a rank condition")
    .addOptions(
      { label: "Rank must match selected roleset(s)", value: GROUP_CONDITIONS.EXACT },
      { label: "Rank must be greater than or equal to", value: GROUP_CONDITIONS.GTE },
      { label: "Rank must be less than or equal to", value: GROUP_CONDITIONS.LTE },
      { label: "Rank must be between two rolesets", value: GROUP_CONDITIONS.BETWEEN },
      { label: "User must be a member of the group", value: GROUP_CONDITIONS.MEMBER }
    );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), controls(session, { back: "create" })] };
}

export function buildRankSelection(session) {
  const condition = session.criteria.condition;
  const roles = session.groupRoles.slice(0, 25);
  const exact = condition === GROUP_CONDITIONS.EXACT;
  const between = condition === GROUP_CONDITIONS.BETWEEN;
  const embed = new EmbedBuilder()
    .setColor(BIND_COLOR)
    .setTitle("📊 Select Roblox Group Rank Criteria")
    .setDescription(
      `${CONDITION_LABELS[condition]}. Select ${exact ? "one or more ranks" : between ? "exactly two range boundaries" : "the threshold rank"}.` +
      (session.groupRoles.length > 25
        ? "\n\nDiscord shows the 25 highest rolesets here. Use **Enter Numeric Rank Values** for any other rank."
        : "")
    );
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bind:${session.id}:ranks`)
    .setPlaceholder("Select Roblox roleset(s)")
    .setMinValues(between ? 2 : 1)
    .setMaxValues(between ? 2 : exact ? roles.length : 1)
    .addOptions(roles.map((role) => ({
      label: String(role.name).slice(0, 100),
      description: `Rank ${role.rank}`,
      value: String(role.rank),
    })));
  const numeric = new ButtonBuilder()
    .setCustomId(`bind:${session.id}:rank_enter`)
    .setLabel("Enter Numeric Rank Values")
    .setStyle(ButtonStyle.Secondary);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(numeric),
      controls(session, { back: "condition_back" }),
    ],
  };
}

export function buildRankModal(session) {
  const condition = session.criteria.condition;
  const exact = condition === GROUP_CONDITIONS.EXACT;
  const between = condition === GROUP_CONDITIONS.BETWEEN;
  const input = new TextInputBuilder()
    .setCustomId("rank_values")
    .setLabel(exact ? "Rank values" : between ? "Minimum and maximum rank" : "Rank threshold")
    .setPlaceholder(exact ? "1, 10, 50" : between ? "10-50" : "50")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`bind:${session.id}:rank_submit`)
    .setTitle("Enter Roblox Rank Values")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export function buildDiscordRoleSelection(session, notice = null) {
  const target = session.type === BIND_TYPES.GROUP
    ? describeCriteria({ criteria: session.criteria })
    : `${session.asset.name} (ID ${session.asset.id})`;
  const embed = new EmbedBuilder()
    .setColor(notice ? 0xfee75c : BIND_COLOR)
    .setTitle("🎭 Select Discord Roles")
    .setDescription(`Choose up to ${MAX_BOUND_DISCORD_ROLES} roles to grant when this bind matches.\n\n**Target:** ${escapeMarkdown(target)}`);
  if (notice) embed.addFields({ name: "Invalid Role Selection", value: notice });
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`bind:${session.id}:roles`)
    .setPlaceholder("Select one or more Discord roles")
    .setMinValues(1)
    .setMaxValues(MAX_BOUND_DISCORD_ROLES);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), controls(session, { back: "roles_back" })] };
}

export function buildReview(session) {
  const bind = {
    type: session.type,
    assetId: session.asset?.id,
    assetName: session.asset?.name,
    criteria: session.criteria,
    discordRoleIds: session.discordRoleIds,
  };
  const embed = new EmbedBuilder()
    .setColor(BIND_COLOR)
    .setTitle("✅ Review Bind")
    .setDescription(`${describeBind(bind)}\n\nThis bind will be evaluated whenever a member verifies or runs **/getroles**.`);
  const confirm = new ButtonBuilder()
    .setCustomId(`bind:${session.id}:confirm`)
    .setLabel("Create Bind")
    .setStyle(ButtonStyle.Success);
  return { embeds: [embed], components: [controls(session, { back: "review_back", confirm })] };
}

export function buildDeleteSelection(session) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🗑️ Delete a Bind")
    .setDescription("Select the bind you want to remove. Members will be updated the next time they verify or run **/getroles**.");
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bind:${session.id}:delete_select`)
    .setPlaceholder("Select a bind to delete")
    .addOptions(session.binds.slice(0, 25).map((bind, index) => ({
      label: `${index + 1}. ${TYPE_LABELS[bind.type]}`,
      description: bind.type === BIND_TYPES.GROUP
        ? describeCriteria(bind).slice(0, 100)
        : `${bind.assetName || bind.assetId}`.slice(0, 100),
      value: bind.bindId,
    })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), controls(session, { back: "home" })] };
}

export function buildDeleteConfirmation(session, bind) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ Delete This Bind?")
    .setDescription(`${describeBind(bind)}\n\nThis only deletes the bind. Existing member roles will be reconciled on their next verification or **/getroles** run.`);
  const confirm = new ButtonBuilder()
    .setCustomId(`bind:${session.id}:delete_confirm`)
    .setLabel("Confirm Delete")
    .setStyle(ButtonStyle.Danger);
  return { embeds: [embed], components: [controls(session, { back: "delete", confirm })] };
}

export function buildRepairSelection(session, unhealthyBinds) {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🛠️ Repair a Bind")
    .setDescription(
      "One or more Discord roles referenced by these binds were deleted. Select a bind to recreate its missing roles."
    );
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bind:${session.id}:repair_select`)
    .setPlaceholder("Select a bind to repair")
    .addOptions(unhealthyBinds.slice(0, 25).map((bind, index) => ({
      label: `${index + 1}. ${TYPE_LABELS[bind.type]}`,
      description: `${bind.missingRoleIds.length} missing Discord role(s)`,
      value: bind.bindId,
    })));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      controls(session, { back: "home" }),
    ],
  };
}

export function buildRepairConfirmation(session, bind, notice = null) {
  const unnamed = session.repairMissingRoles.filter(
    (role) => !role.discordRoleName
  );
  const roleLines = session.repairMissingRoles.map((role, index) =>
    `**${index + 1}.** ${role.discordRoleName
      ? escapeMarkdown(role.discordRoleName)
      : `Deleted role ID \`${role.discordRoleId}\``}`
  );
  const embed = new EmbedBuilder()
    .setColor(notice ? 0xed4245 : 0xfee75c)
    .setTitle("🛠️ Recreate Missing Bind Roles")
    .setDescription(
      `${describeBind(bind)}\n\n**Missing Roles**\n${roleLines.join("\n")}\n\n` +
      (unnamed.length
        ? "Discord no longer provides the names of deleted roles. Enter a new name for each role in the same order."
        : "Bridgely will create or safely reuse roles with these names, then update the bind with their new IDs.")
    );
  if (notice) embed.addFields({ name: "Could Not Continue", value: notice });

  const action = unnamed.length
    ? new ButtonBuilder()
      .setCustomId(`bind:${session.id}:repair_names`)
      .setLabel("Enter Role Names")
      .setStyle(ButtonStyle.Primary)
    : new ButtonBuilder()
      .setCustomId(`bind:${session.id}:repair_confirm`)
      .setLabel("Recreate Missing Roles")
      .setStyle(ButtonStyle.Success);
  return {
    embeds: [embed],
    components: [controls(session, { back: "repair", confirm: action })],
  };
}

export function buildRepairNamesModal(session) {
  const missingCount = session.repairMissingRoles.filter(
    (role) => !role.discordRoleName
  ).length;
  const input = new TextInputBuilder()
    .setCustomId("role_names")
    .setLabel(`${missingCount} role name${missingCount === 1 ? "" : "s"}, one per line`)
    .setPlaceholder(missingCount === 1 ? "Customer" : "Customer\nVIP\nModerator")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`bind:${session.id}:repair_names_submit`)
    .setTitle("Name the Replacement Roles")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export function buildBindStatus(title, description, color = BIND_COLOR) {
  return { embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description)], components: [] };
}
