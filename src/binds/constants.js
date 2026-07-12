export const BIND_TYPES = Object.freeze({
  GROUP: "GROUP",
  BADGE: "BADGE",
  GAMEPASS: "GAMEPASS",
});

export const GROUP_CONDITIONS = Object.freeze({
  EXACT: "EXACT",
  GTE: "GTE",
  LTE: "LTE",
  BETWEEN: "BETWEEN",
  MEMBER: "MEMBER",
});

export const BIND_TIMEOUT_MS = 2 * 60 * 1000;
export const MAX_BINDS_PER_GUILD = 25;
export const MAX_BOUND_DISCORD_ROLES = 10;
export const BIND_COLOR = 0x5865f2;
