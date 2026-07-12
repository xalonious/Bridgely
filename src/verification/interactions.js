import { randomBytes } from "node:crypto";
import { MessageFlags, escapeMarkdown } from "discord.js";
import GuildConfiguration from "../schemas/guildConfiguration.js";
import Bind from "../schemas/bind.js";
import VerifiedUser from "../schemas/verifiedUser.js";
import { err } from "../utils/logger.js";
import { generateVerificationCode } from "./code.js";
import { evaluateBinds } from "../binds/evaluator.js";
import {
  VERIFICATION_METHODS,
  VERIFICATION_SESSION_MS,
  VERIFICATION_STATUS,
} from "./constants.js";
import {
  fetchRobloxGroupMemberships,
  fetchRobloxHeadshot,
  fetchRobloxProfile,
  resolveRobloxUsername,
  VerificationRobloxError,
} from "./roblox.js";
import { syncVerifiedMember, unlinkVerifiedMember } from "./memberSync.js";
import { ensureGroupRoleIntegrity } from "./groupIntegrity.js";
import { isGameVerificationEnabled } from "../server/config.js";
import {
  buildCheckingProfile,
  buildGameInstructions,
  buildMemberUpdated,
  buildMethodSelection,
  buildProfileInstructions,
  buildUnlinkComplete,
  buildUnlinkConfirmation,
  buildUsernameModal,
  buildVerificationStatus,
} from "./views.js";

const VERIFY_PREFIX = "bridgely:verify:";
const sessions = new Map();
const userSessions = new Map();
const unlinkingLinks = new Set();

function logVerificationError(context, error) {
  console.error(err(`[Verification] ${context}: ${error?.stack || error}`));
}

function userSessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function clearVerificationSession(session) {
  if (!session) return;
  clearTimeout(session.timeout);
  sessions.delete(session.id);
  const key = userSessionKey(session.guildId, session.discordUserId);
  if (userSessions.get(key) === session.id) userSessions.delete(key);
}

function getActiveUserSession(guildId, userId) {
  const id = userSessions.get(userSessionKey(guildId, userId));
  const session = id ? sessions.get(id) : null;
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    clearVerificationSession(session);
    return null;
  }
  return session;
}

function createVerificationSession({
  guildId,
  discordUserId,
  robloxUser,
  verificationMethod = VERIFICATION_METHODS.PROFILE_CODE,
  interaction,
}) {
  clearVerificationSession(getActiveUserSession(guildId, discordUserId));

  const now = new Date();
  const session = {
    id: randomBytes(12).toString("hex"),
    discordUserId,
    guildId,
    robloxUserId: robloxUser.id,
    robloxUsername: robloxUser.username,
    avatarUrl: robloxUser.avatarUrl || null,
    verificationCode: verificationMethod === VERIFICATION_METHODS.PROFILE_CODE
      ? generateVerificationCode()
      : null,
    verificationMethod,
    interaction,
    createdAt: now,
    expiresAt: new Date(now.getTime() + VERIFICATION_SESSION_MS),
    confirmationAttempts: 0,
    status: VERIFICATION_STATUS.ACTIVE,
    timeout: null,
  };

  session.timeout = setTimeout(
    () => clearVerificationSession(session),
    VERIFICATION_SESSION_MS
  );
  session.timeout.unref?.();
  sessions.set(session.id, session);
  userSessions.set(userSessionKey(guildId, discordUserId), session.id);
  return session;
}

async function privateReply(interaction, payload) {
  const response = typeof payload === "string" ? { content: payload } : payload;
  const privatePayload = { ...response, flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(privatePayload);
  }
  return interaction.reply(privatePayload);
}

async function initialReply(interaction, payload, ephemeral) {
  if (ephemeral) return privateReply(interaction, payload);
  const response = typeof payload === "string" ? { content: payload } : payload;
  return interaction.reply(response);
}

function parseVerificationCustomId(customId) {
  const value = String(customId ?? "");
  if (value === "bridgely:verify:start") return { action: "start" };

  let match = value.match(
    /^bridgely:verify:(method|username|username-game):(\d{17,20})$/
  );
  if (match) return { action: match[1], ownerId: match[2] };

  match = value.match(/^bridgely:verify:(confirm|cancel):([a-f0-9]{24})$/i);
  if (match) return { action: match[1], sessionId: match[2] };

  match = value.match(
    /^bridgely:verify:(unlink|unlink-confirm|unlink-cancel):([a-f0-9]{24})$/i
  );
  if (match) return { action: match[1], linkId: match[2] };
  return null;
}

async function requireConfiguredGuild(interaction) {
  if (!interaction.inCachedGuild()) {
    await privateReply(interaction, "Verification can only be used in a Discord server.");
    return false;
  }
  if (!await GuildConfiguration.exists({ guildId: interaction.guildId })) {
    await privateReply(
      interaction,
      "Bridgely has not been configured in this server yet. Ask an administrator to run `/setup`."
    );
    return false;
  }
  return true;
}

function findVerifiedDiscordUser(interaction, discordUserId = interaction.user.id) {
  return VerifiedUser.findOne({
    guildId: interaction.guildId,
    discordUserId,
  }).lean();
}

async function synchronizeVerifiedLink(interaction, link, existingProfile = null) {
  const profile = existingProfile ?? await fetchRobloxProfile(link.robloxUserId);
  const linkedMember = interaction.guild.members.cache.get(link.discordUserId);
  let syncResult = {
    addedRoles: [],
    removedRoles: [],
    nickname: linkedMember?.displayName || "Unchanged",
    warnings: [],
    groupRoleName: "Could not be checked",
  };

  let configuration;
  try {
    configuration = await GuildConfiguration.findOne({
      guildId: interaction.guildId,
    }).lean();
  } catch (error) {
    logVerificationError("Could not load the server configuration", error);
    syncResult.warnings.push(
      "The server configuration could not be loaded, so roles and nickname were not updated."
    );
    return { profile, syncResult };
  }

  if (!configuration) {
    syncResult.warnings.push(
      "The server configuration could not be loaded, so roles and nickname were not updated."
    );
    return { profile, syncResult };
  }

  let membership = { roles: [], complete: false, warning: null };
  let groupMembershipKnown = true;
  const membershipWarnings = [];
  try {
    membership = await fetchRobloxGroupMemberships(
      link.robloxUserId,
      configuration.robloxGroupId
    );
    if (membership.warning) membershipWarnings.push(membership.warning);
  } catch (error) {
    groupMembershipKnown = false;
    membershipWarnings.push(
      "The Roblox group ranks could not be checked, so group roles were left unchanged."
    );
    logVerificationError("Could not load Roblox group memberships", error);
  }

  if (groupMembershipKnown) {
    try {
      const integrity = await ensureGroupRoleIntegrity({
        guild: interaction.guild,
        configuration,
        membership,
      });
      configuration = integrity.configuration;
      membershipWarnings.push(...integrity.warnings);
    } catch (error) {
      logVerificationError("Could not repair Roblox group role mappings", error);
      membershipWarnings.push(
        "The Roblox group roles could not be checked or refreshed, so the saved mappings were used."
      );
    }
  }

  try {
    let bindEvaluation = null;
    try {
      const binds = await Bind.find({ guildId: interaction.guildId }).lean();
      bindEvaluation = await evaluateBinds({
        binds,
        robloxUserId: link.robloxUserId,
        membership,
        configuration,
        groupMembershipKnown,
        groupMembershipComplete: membership.complete,
      });
    } catch (error) {
      logVerificationError("Could not evaluate configured binds", error);
      membershipWarnings.push(
        "Configured binds could not be checked, so their roles were left unchanged."
      );
    }

    syncResult = await syncVerifiedMember({
      guild: interaction.guild,
      discordUserId: link.discordUserId,
      configuration,
      profile,
      membership,
      groupMembershipKnown,
      groupRolesComplete: membership.complete,
      bindEvaluation,
    });
    syncResult.warnings.unshift(...membershipWarnings);
  } catch (error) {
    logVerificationError("Member role or nickname synchronization failed", error);
    syncResult.warnings.push(
      "Roles and nickname could not be synchronized. Please try again."
    );
  }

  return { profile, syncResult };
}

export async function startVerification(interaction, { ephemeral = true } = {}) {
  if (!await requireConfiguredGuild(interaction)) return;

  const verified = await findVerifiedDiscordUser(interaction);
  if (verified) {
    await initialReply(
      interaction,
      buildVerificationStatus(
        "Already Verified",
        `Your Discord account is already connected to **@${escapeMarkdown(verified.robloxUsername)}**. Use **/getroles** to update your roles and nickname.`,
        0x57f287
      ),
      ephemeral
    );
    return;
  }

  const pending = getActiveUserSession(interaction.guildId, interaction.user.id);
  if (pending?.status === VERIFICATION_STATUS.PROCESSING) {
    await initialReply(
      interaction,
      buildVerificationStatus(
        "🔎 Verification in Progress",
        "Your Roblox profile is currently being checked. Please wait a moment."
      ),
      ephemeral
    );
    return;
  }
  if (pending) {
    await initialReply(
      interaction,
      pending.verificationMethod === VERIFICATION_METHODS.GAME
        ? buildGameInstructions(pending)
        : buildProfileInstructions(pending),
      ephemeral
    );
    return;
  }

  await initialReply(
    interaction,
    buildMethodSelection(interaction.user.id),
    ephemeral
  );
}

export async function refreshVerifiedMember(
  interaction,
  { ephemeral = false, targetUser = interaction.user } = {}
) {
  if (!await requireConfiguredGuild(interaction)) return;

  let targetMember = interaction.guild.members.cache.get(targetUser.id);
  if (!targetMember) {
    try {
      targetMember = await interaction.guild.members.fetch(targetUser.id);
    } catch (error) {
      logVerificationError(`Could not fetch target guild member ${targetUser.id}`, error);
    }
  }
  if (!targetMember) {
    await initialReply(
      interaction,
      buildVerificationStatus(
        "Member Not Found",
        "That user is not currently a member of this Discord server.",
        0x99aab5
      ),
      ephemeral
    );
    return;
  }

  const verified = await findVerifiedDiscordUser(interaction, targetUser.id);
  if (!verified) {
    await initialReply(
      interaction,
      buildVerificationStatus(
        "Not Verified Yet",
        targetUser.id === interaction.user.id
          ? "Connect your Roblox account with **/verify** before updating your roles."
          : `<@${targetUser.id}> has not verified with Bridgely in this server.`,
        0x99aab5
      ),
      ephemeral
    );
    return;
  }

  await interaction.deferReply(
    ephemeral ? { flags: MessageFlags.Ephemeral } : undefined
  );
  try {
    const { profile, syncResult } = await synchronizeVerifiedLink(
      interaction,
      verified
    );
    const robloxUsername = profile.username || verified.robloxUsername;
    let robloxAvatarUrl = null;
    try {
      robloxAvatarUrl = await fetchRobloxHeadshot(verified.robloxUserId);
    } catch (error) {
      logVerificationError("Could not load Roblox avatar headshot", error);
    }
    try {
      await VerifiedUser.updateOne(
        { _id: verified._id },
        { $set: { robloxUsername } }
      );
    } catch (error) {
      logVerificationError("Could not update the saved Roblox username", error);
      syncResult.warnings.push(
        "Your roles were refreshed, but the saved Roblox username could not be updated."
      );
    }
    await interaction.editReply(
      buildMemberUpdated({
        profile: { ...profile, username: robloxUsername },
        syncResult,
        avatarUrl: targetUser.displayAvatarURL(),
        robloxAvatarUrl,
        isNewVerification: false,
        discordUserId: targetUser.id,
        isSelf: targetUser.id === interaction.user.id,
      })
    );
  } catch (error) {
    if (!(error instanceof VerificationRobloxError)) {
      logVerificationError("Could not refresh an existing verification", error);
    }
    await interaction.editReply(
      buildVerificationStatus(
        "Role Refresh Failed",
        error instanceof VerificationRobloxError
          ? error.message
          : `${targetUser.id === interaction.user.id ? "Your" : "That member's"} linked Roblox account could not be refreshed right now. Please try again.`
      )
    );
  }
}

export async function startUnlink(interaction, { ephemeral = false } = {}) {
  if (!interaction.inCachedGuild()) {
    await initialReply(
      interaction,
      "Accounts can only be unlinked in a Discord server.",
      ephemeral
    );
    return;
  }

  const link = await findVerifiedDiscordUser(interaction);
  if (!link) {
    await initialReply(
      interaction,
      buildVerificationStatus(
        "No Linked Account",
        "Your Discord account is not currently connected to a Roblox account.",
        0x99aab5
      ),
      ephemeral
    );
    return;
  }

  await initialReply(
    interaction,
    buildUnlinkConfirmation(link),
    ephemeral
  );
}

async function handleMethodSelection(interaction, parsed) {
  if (interaction.user.id !== parsed.ownerId) {
    await privateReply(interaction, "This verification prompt belongs to another user.");
    return;
  }

  const method = interaction.values[0];
  if (method === VERIFICATION_METHODS.GAME) {
    if (!isGameVerificationEnabled()) {
      await privateReply(interaction, "Game verification is not enabled.");
      return;
    }
    await interaction.showModal(
      buildUsernameModal(interaction.user.id, VERIFICATION_METHODS.GAME)
    );
    return;
  }
  if (method !== VERIFICATION_METHODS.PROFILE_CODE) {
    await privateReply(interaction, "That verification method is invalid.");
    return;
  }
  await interaction.showModal(
    buildUsernameModal(interaction.user.id, VERIFICATION_METHODS.PROFILE_CODE)
  );
}

async function handleUsernameModal(interaction, parsed) {
  if (interaction.user.id !== parsed.ownerId) {
    await privateReply(interaction, "This verification prompt belongs to another user.");
    return;
  }

  await interaction.deferUpdate();
  if (!await requireConfiguredGuild(interaction)) return;

  try {
    const verificationMethod = parsed.action === "username-game"
      ? VERIFICATION_METHODS.GAME
      : VERIFICATION_METHODS.PROFILE_CODE;
    if (
      verificationMethod === VERIFICATION_METHODS.GAME &&
      !isGameVerificationEnabled()
    ) {
      await interaction.editReply(
        buildVerificationStatus(
          "Game Verification Unavailable",
          "Game verification was disabled while this prompt was open."
        )
      );
      return;
    }
    const existingLink = await findVerifiedDiscordUser(interaction);
    if (existingLink) {
      await interaction.editReply(
        buildVerificationStatus(
          "✅ Already Verified",
          `Your Discord account is already connected to **@${escapeMarkdown(existingLink.robloxUsername)}**.`,
          0x57f287
        )
      );
      return;
    }

    const existingSession = getActiveUserSession(interaction.guildId, interaction.user.id);
    if (existingSession?.status === VERIFICATION_STATUS.PROCESSING) {
      await privateReply(interaction, "Your previous confirmation is still being checked.");
      return;
    }

    const robloxUser = await resolveRobloxUsername(
      interaction.fields.getTextInputValue("roblox_username")
    );
    try {
      robloxUser.avatarUrl = await fetchRobloxHeadshot(robloxUser.id);
    } catch (error) {
      logVerificationError("Could not load Roblox avatar headshot", error);
    }
    const linkedRobloxAccount = await VerifiedUser.findOne({
      guildId: interaction.guildId,
      robloxUserId: robloxUser.id,
    }).lean();

    if (linkedRobloxAccount) {
      await privateReply(
        interaction,
        "That Roblox account is already connected to another Discord user in this server."
      );
      return;
    }

    const conflictingPendingSession = [...sessions.values()].find((session) =>
      session.guildId === interaction.guildId &&
      session.robloxUserId === robloxUser.id &&
      session.discordUserId !== interaction.user.id &&
      session.expiresAt > new Date()
    );
    if (conflictingPendingSession) {
      await privateReply(
        interaction,
        "That Roblox account already has a pending verification in this server."
      );
      return;
    }

    const session = createVerificationSession({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
      robloxUser,
      verificationMethod,
      interaction,
    });
    await interaction.editReply(
      verificationMethod === VERIFICATION_METHODS.GAME
        ? buildGameInstructions(session)
        : buildProfileInstructions(session)
    );
  } catch (error) {
    if (error instanceof VerificationRobloxError) {
      await privateReply(interaction, error.message);
      return;
    }
    throw error;
  }
}

async function getOwnedSession(interaction, sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    await interaction.editReply(
      buildVerificationStatus(
        "⌛ Verification Session Expired",
        "This verification session is no longer active. Press **Verify with Bridgely** again to restart.",
        0x99aab5
      )
    );
    return null;
  }
  if (
    session.discordUserId !== interaction.user.id ||
    session.guildId !== interaction.guildId
  ) {
    await privateReply(interaction, "This verification session belongs to another user.");
    return null;
  }
  if (session.expiresAt <= new Date()) {
    clearVerificationSession(session);
    await interaction.editReply(
      buildVerificationStatus(
        "⌛ Verification Session Expired",
        "This verification session expired. Press **Verify with Bridgely** again to restart.",
        0x99aab5
      )
    );
    return null;
  }
  return session;
}

async function duplicateLinkMatchesSession(session) {
  const [discordLink, robloxLink] = await Promise.all([
    VerifiedUser.findOne({
      guildId: session.guildId,
      discordUserId: session.discordUserId,
    }).lean(),
    VerifiedUser.findOne({
      guildId: session.guildId,
      robloxUserId: session.robloxUserId,
    }).lean(),
  ]);
  return (
    discordLink?.robloxUserId === session.robloxUserId &&
    robloxLink?.discordUserId === session.discordUserId
  );
}

async function finalizeVerificationSession(session, profile, interaction) {
  try {
    await VerifiedUser.create({
      discordUserId: session.discordUserId,
      guildId: session.guildId,
      robloxUserId: session.robloxUserId,
      robloxUsername: profile.username || session.robloxUsername,
      verificationMethod: session.verificationMethod,
      verifiedAt: new Date(),
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    if (!await duplicateLinkMatchesSession(session)) {
      clearVerificationSession(session);
      return { completed: false, conflict: true };
    }
  }

  session.robloxUsername = profile.username || session.robloxUsername;
  const verifiedLink = await VerifiedUser.findOne({
    guildId: session.guildId,
    discordUserId: session.discordUserId,
  }).lean();
  if (!verifiedLink) throw new Error("The completed verification link could not be loaded.");

  const { syncResult } = await synchronizeVerifiedLink(
    interaction,
    verifiedLink,
    profile
  );
  clearVerificationSession(session);
  try {
    await interaction.editReply(
      buildMemberUpdated({
        profile: { ...profile, username: session.robloxUsername },
        syncResult,
        avatarUrl: interaction.user.displayAvatarURL(),
        robloxAvatarUrl: session.avatarUrl,
      })
    );
  } catch (error) {
    logVerificationError("Could not update the completed verification message", error);
  }
  return { completed: true, conflict: false };
}

function findPendingGameSessions(robloxUserId) {
  const now = new Date();
  const pending = [];
  for (const session of sessions.values()) {
    if (session.expiresAt <= now) {
      clearVerificationSession(session);
      continue;
    }
    if (
      session.verificationMethod === VERIFICATION_METHODS.GAME &&
      session.robloxUserId === robloxUserId
    ) {
      pending.push(session);
    }
  }
  return pending;
}

export function getPendingGameVerification(robloxUserId) {
  return findPendingGameSessions(robloxUserId).find(
    (session) => session.status === VERIFICATION_STATUS.ACTIVE
  ) || null;
}

export async function completeGameVerification(robloxUserId) {
  const pending = findPendingGameSessions(robloxUserId);
  const active = pending.filter(
    (session) => session.status === VERIFICATION_STATUS.ACTIVE
  );
  if (!pending.length) {
    return { status: 404, body: { error: "No pending verification" } };
  }
  if (!active.length) {
    return { status: 409, body: { error: "Verification is already processing" } };
  }

  for (const session of active) {
    session.status = VERIFICATION_STATUS.PROCESSING;
  }

  let profile;
  try {
    profile = await fetchRobloxProfile(robloxUserId);
  } catch (error) {
    for (const session of active) {
      if (sessions.has(session.id)) session.status = VERIFICATION_STATUS.ACTIVE;
    }
    throw error;
  }

  let completed = 0;
  let conflicts = 0;
  for (const session of active) {
    try {
      const result = await finalizeVerificationSession(
        session,
        profile,
        session.interaction
      );
      if (result.completed) completed += 1;
      if (result.conflict) {
        conflicts += 1;
        try {
          await session.interaction.editReply(
            buildVerificationStatus(
              "❌ Account Already Linked",
              "That Discord or Roblox account was linked elsewhere while this verification was active.",
              0xed4245
            )
          );
        } catch (error) {
          logVerificationError("Could not update a conflicted game verification", error);
        }
      }
    } catch (error) {
      if (sessions.has(session.id)) session.status = VERIFICATION_STATUS.ACTIVE;
      logVerificationError("Game verification completion failed", error);
    }
  }

  if (completed) {
    return { status: 200, body: { verified: true, completed } };
  }
  if (conflicts) {
    return { status: 409, body: { error: "Discord or Roblox account already linked" } };
  }
  return { status: 500, body: { error: "Verification could not be completed" } };
}

async function handleConfirm(interaction, parsed) {
  if (!interaction.inCachedGuild()) {
    await privateReply(interaction, "Verification can only be completed in a Discord server.");
    return;
  }

  await interaction.deferUpdate();
  const session = await getOwnedSession(interaction, parsed.sessionId);
  if (!session) return;
  if (session.status === VERIFICATION_STATUS.PROCESSING) {
    await privateReply(interaction, "This verification is already being checked.");
    return;
  }

  session.status = VERIFICATION_STATUS.PROCESSING;
  session.confirmationAttempts += 1;
  try {
    await interaction.editReply(buildCheckingProfile());
  } catch (error) {
    logVerificationError("Could not show profile-check progress", error);
  }

  let profile;
  try {
    profile = await fetchRobloxProfile(session.robloxUserId);
  } catch (error) {
    session.status = VERIFICATION_STATUS.ACTIVE;
    if (!(error instanceof VerificationRobloxError)) {
      logVerificationError("Roblox profile check failed", error);
    }
    await interaction.editReply(
      buildProfileInstructions(
        session,
        error instanceof VerificationRobloxError
          ? error.message
          : "The Roblox profile could not be checked. Please try again."
      )
    );
    return;
  }

  if (!sessions.has(session.id) || session.expiresAt <= new Date()) {
    clearVerificationSession(session);
    await interaction.editReply(
      buildVerificationStatus(
        "⌛ Verification Session Expired",
        "The session expired while the Roblox profile was being checked. Please restart verification.",
        0x99aab5
      )
    );
    return;
  }

  if (!profile.description.includes(session.verificationCode)) {
    session.status = VERIFICATION_STATUS.ACTIVE;
    await interaction.editReply(
      buildProfileInstructions(
        session,
        "The exact verification code was not found in the profile About section. Save the profile, then try again."
      )
    );
    return;
  }

  const result = await finalizeVerificationSession(session, profile, interaction);
  if (result.conflict) {
    await interaction.editReply(
      buildVerificationStatus(
        "❌ Account Already Linked",
        "That Discord or Roblox account was linked elsewhere while this verification was active.",
        0xed4245
      )
    );
  }
}

async function getOwnedVerifiedLink(interaction, linkId) {
  const link = await VerifiedUser.findById(linkId).lean();
  if (!link) {
    await interaction.editReply(
      buildVerificationStatus(
        "Account Already Unlinked",
        "This Roblox account is no longer linked to your Discord account.",
        0x99aab5
      )
    );
    return null;
  }
  if (
    link.guildId !== interaction.guildId ||
    link.discordUserId !== interaction.user.id
  ) {
    await privateReply(interaction, "This account link belongs to another user.");
    return null;
  }
  return link;
}

async function handleUnlink(interaction, parsed) {
  if (!interaction.inCachedGuild()) {
    await privateReply(interaction, "Accounts can only be unlinked in a Discord server.");
    return;
  }

  await interaction.deferUpdate();
  const link = await getOwnedVerifiedLink(interaction, parsed.linkId);
  if (!link) return;
  await interaction.editReply(buildUnlinkConfirmation(link));
}

async function handleUnlinkCancel(interaction, parsed) {
  if (!interaction.inCachedGuild()) {
    await privateReply(interaction, "Accounts can only be unlinked in a Discord server.");
    return;
  }

  await interaction.deferUpdate();
  const link = await getOwnedVerifiedLink(interaction, parsed.linkId);
  if (!link) return;
  await interaction.editReply(
    buildVerificationStatus(
      "Unlink Cancelled",
      `Your Discord account is still connected to **@${escapeMarkdown(link.robloxUsername)}**.`,
      0x57f287
    )
  );
}

async function handleUnlinkConfirm(interaction, parsed) {
  if (!interaction.inCachedGuild()) {
    await privateReply(interaction, "Accounts can only be unlinked in a Discord server.");
    return;
  }

  await interaction.deferUpdate();
  const link = await getOwnedVerifiedLink(interaction, parsed.linkId);
  if (!link) return;
  const linkId = String(link._id);

  if (unlinkingLinks.has(linkId)) {
    await privateReply(interaction, "This account is already being unlinked.");
    return;
  }

  unlinkingLinks.add(linkId);
  try {
    const configuration = await GuildConfiguration.findOne({
      guildId: interaction.guildId,
    }).lean();
    if (!configuration) {
      await interaction.editReply(
        buildUnlinkConfirmation(
          link,
          "The server configuration could not be loaded. No account data was removed."
        )
      );
      return;
    }

    let unlinkResult;
    try {
      const binds = await Bind.find({ guildId: interaction.guildId }).lean();
      unlinkResult = await unlinkVerifiedMember({
        guild: interaction.guild,
        discordUserId: interaction.user.id,
        configuration,
        robloxUsername: link.robloxUsername,
        bindRoleIds: binds.flatMap((bind) => bind.discordRoleIds ?? []),
      });
    } catch (error) {
      logVerificationError("Could not remove roles while unlinking", error);
      await interaction.editReply(
        buildUnlinkConfirmation(
          link,
          "Bridgely could not remove your configured roles. Your account remains linked; please try again."
        )
      );
      return;
    }

    if (unlinkResult.warnings.length) {
      await interaction.editReply(
        buildUnlinkConfirmation(link, unlinkResult.warnings.join("\n"))
      );
      return;
    }

    try {
      await VerifiedUser.findOneAndDelete({
        _id: link._id,
        guildId: interaction.guildId,
        discordUserId: interaction.user.id,
      });
    } catch (error) {
      logVerificationError("Could not delete verified account link", error);
      await interaction.editReply(
        buildUnlinkConfirmation(
          link,
          "Your roles were removed, but the account link could not be deleted. Please try again."
        )
      );
      return;
    }

    clearVerificationSession(
      getActiveUserSession(interaction.guildId, interaction.user.id)
    );
    await interaction.editReply(buildUnlinkComplete(unlinkResult.removedRoles));
  } finally {
    unlinkingLinks.delete(linkId);
  }
}

async function handleCancel(interaction, parsed) {
  if (!interaction.inCachedGuild()) {
    await privateReply(interaction, "Verification can only be cancelled in a Discord server.");
    return;
  }

  await interaction.deferUpdate();
  const session = await getOwnedSession(interaction, parsed.sessionId);
  if (!session) return;
  if (session.status === VERIFICATION_STATUS.PROCESSING) {
    await privateReply(interaction, "This verification is currently being checked.");
    return;
  }

  clearVerificationSession(session);
  await interaction.editReply(
    buildVerificationStatus(
      "✖️ Verification Cancelled",
      "Your pending verification was cancelled. You can start again whenever you are ready.",
      0x99aab5
    )
  );
}

export async function handleVerificationInteraction(interaction) {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false;
  if (!String(interaction.customId ?? "").startsWith(VERIFY_PREFIX)) return false;

  const parsed = parseVerificationCustomId(interaction.customId);
  if (!parsed) {
    await privateReply(interaction, "That verification control is invalid or outdated.");
    return true;
  }

  try {
    if (parsed.action === "start" && interaction.isButton()) {
      await startVerification(interaction);
    } else if (parsed.action === "method" && interaction.isStringSelectMenu()) {
      await handleMethodSelection(interaction, parsed);
    } else if (
      (parsed.action === "username" || parsed.action === "username-game") &&
      interaction.isModalSubmit()
    ) {
      await handleUsernameModal(interaction, parsed);
    } else if (parsed.action === "confirm" && interaction.isButton()) {
      await handleConfirm(interaction, parsed);
    } else if (parsed.action === "cancel" && interaction.isButton()) {
      await handleCancel(interaction, parsed);
    } else if (parsed.action === "unlink" && interaction.isButton()) {
      await handleUnlink(interaction, parsed);
    } else if (parsed.action === "unlink-confirm" && interaction.isButton()) {
      await handleUnlinkConfirm(interaction, parsed);
    } else if (parsed.action === "unlink-cancel" && interaction.isButton()) {
      await handleUnlinkCancel(interaction, parsed);
    } else {
      await privateReply(interaction, "That verification control is invalid or outdated.");
    }
  } catch (error) {
    logVerificationError("Interaction handling failed", error);
    try {
      await privateReply(
        interaction,
        "Verification could not be completed because of an unexpected error. Please try again."
      );
    } catch (replyError) {
      logVerificationError("Could not send an interaction error", replyError);
    }
  }
  return true;
}
