export class GroupConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GroupConfigurationError";
  }
}

export function configuredGroupId() {
  const value = process.env.ROBLOX_GROUP_ID?.trim();
  if (!/^[1-9]\d*$/.test(value ?? "")) {
    throw new GroupConfigurationError("ROBLOX_GROUP_ID must be a positive numeric Roblox group ID.");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new GroupConfigurationError("ROBLOX_GROUP_ID is too large.");
  }
  return id;
}

export function assertConfiguredGroup(configuration) {
  const groupId = configuredGroupId();
  if (configuration && configuration.robloxGroupId !== groupId) {
    throw new GroupConfigurationError("The configured Roblox group has changed. Run /setup again before using Bridgely.");
  }
  return groupId;
}
