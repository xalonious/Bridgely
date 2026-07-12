export const SETUP_COLOR = 0x5865f2;
export const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
export const DISCORD_ROLE_NAME_LIMIT = 100;
export const DISCORD_NICKNAME_LIMIT = 32;
export const CONFIG_SCHEMA_VERSION = 1;

export const ROLE_HANDLING = Object.freeze({
  KEEP_EXISTING: "KEEP_EXISTING",
  WIPE_MANAGEABLE: "WIPE_MANAGEABLE",
});

export const ROLE_HANDLING_LABELS = Object.freeze({
  [ROLE_HANDLING.KEEP_EXISTING]: "Keep existing roles",
  [ROLE_HANDLING.WIPE_MANAGEABLE]: "Remove manageable roles first",
});

export const NICKNAME_TEMPLATES = Object.freeze([
  {
    label: "Discord username (@Roblox username)",
    value: "{discord_username} (@{roblox_username})",
  },
  {
    label: "Discord username only",
    value: "{discord_username}",
  },
  {
    label: "Roblox username only",
    value: "{roblox_username}",
  },
  {
    label: "@Roblox username",
    value: "@{roblox_username}",
  },
  {
    label: "Roblox display name (@Roblox username)",
    value: "{roblox_display_name} (@{roblox_username})",
  },
  {
    label: "Discord display name (@Roblox username)",
    value: "{discord_display_name} (@{roblox_username})",
  },
]);

export const NICKNAME_PREVIEW_VALUES = Object.freeze({
  discord_username: "Builder",
  discord_display_name: "Builder Pro",
  roblox_username: "BridgelyUser",
  roblox_display_name: "Bridgely",
});
