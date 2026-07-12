function parsePositiveInteger(value) {
  const number = Number(String(value ?? "").trim());
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function getGameVerificationConfig() {
  const enabled = String(process.env.GAME_VERIFICATION_ENABLED ?? "")
    .trim()
    .toLowerCase() === "true";
  const port = parsePositiveInteger(process.env.GAME_VERIFICATION_PORT) || 3000;
  const placeId = parsePositiveInteger(process.env.ROBLOX_VERIFICATION_PLACE_ID);
  let gameUrl = null;
  const configuredGameUrl = process.env.ROBLOX_VERIFICATION_GAME_URL?.trim();
  if (configuredGameUrl) {
    try {
      const url = new URL(configuredGameUrl);
      const host = url.hostname.toLowerCase();
      if (
        url.protocol === "https:" &&
        (host === "roblox.com" || host === "www.roblox.com") &&
        /^\/games\/\d+/.test(url.pathname)
      ) {
        gameUrl = url.toString();
      }
    } catch {
      gameUrl = null;
    }
  }
  if (!gameUrl && placeId) {
    gameUrl = `https://www.roblox.com/games/${placeId}`;
  }
  const apiKey = (
    process.env.GAME_VERIFICATION_API_KEY ??
    process.env.GAME_VERIFICATION_SECRET ??
    ""
  ).trim();

  return {
    enabled,
    ready: enabled && Boolean(gameUrl) && Boolean(apiKey),
    port,
    placeId,
    gameUrl,
    apiKey,
  };
}

export function isGameVerificationEnabled() {
  return getGameVerificationConfig().ready;
}
