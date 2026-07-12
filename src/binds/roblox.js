import { fetchApi, isAnyErrorResponse } from "rozod";
import { getBadgesBadgeid } from "rozod/endpoints/badgesv1";
import { getUsersUseridItemsItemtypeItemtargetidIsOwned } from "rozod/endpoints/inventoryv1";
import { getGamePasses } from "rozod/endpoints/thumbnailsv1";
import { warn } from "../utils/logger.js";

export class BindRobloxError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "BindRobloxError";
  }
}

export function parseRobloxAssetId(input, label) {
  const value = String(input ?? "").trim();
  if (!/^\d+$/.test(value)) {
    throw new BindRobloxError(`Enter a valid numeric Roblox ${label} ID.`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BindRobloxError(`The Roblox ${label} ID must be a positive safe integer.`);
  }
  return id;
}

async function fetchGamePassName(gamePassId) {
  try {
    const response = await fetch(
      `https://apis.roblox.com/game-passes/v1/game-passes/${gamePassId}/product-info`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!response.ok) throw new Error(`Roblox returned HTTP ${response.status}.`);
    const product = await response.json();
    if (
      product?.TargetId !== gamePassId ||
      product?.ProductType !== "Game Pass" ||
      typeof product?.Name !== "string" ||
      !product.Name.trim()
    ) {
      throw new Error("Roblox returned invalid game-pass metadata.");
    }
    return product.Name.trim();
  } catch (error) {
    console.warn(
      warn(`[Binds] Could not load the name for game pass ${gamePassId}: ${error?.message || error}`)
    );
    return null;
  }
}

export async function fetchBindAsset(type, assetId) {
  try {
    if (type === "BADGE") {
      const badge = await fetchApi(
        getBadgesBadgeid,
        { badgeId: assetId },
        { retries: 2, retryDelay: 500 }
      );
      if (isAnyErrorResponse(badge) || badge?.id !== assetId || !badge.name) {
        throw new BindRobloxError("That Roblox badge does not exist or is unavailable.");
      }
      return { id: assetId, name: badge.displayName || badge.name };
    }

    const response = await fetchApi(
      getGamePasses,
      {
        gamePassIds: [assetId],
        size: "150x150",
        format: "Png",
        isCircular: false,
      },
      { retries: 2, retryDelay: 500 }
    );
    const gamePass = response?.data?.find((entry) => entry.targetId === assetId);
    if (isAnyErrorResponse(response) || !gamePass) {
      throw new BindRobloxError("That Roblox game pass does not exist or is unavailable.");
    }
    return {
      id: assetId,
      name: await fetchGamePassName(assetId) || `Game Pass ${assetId}`,
    };
  } catch (error) {
    if (error instanceof BindRobloxError) throw error;
    throw new BindRobloxError("Roblox could not validate that item. Please try again.", error);
  }
}

export async function fetchOwnedBadgeIds(userId, badgeIds) {
  if (!badgeIds.length) return new Set();
  const owned = new Set();
  for (const badgeId of badgeIds) {
    const response = await fetchApi(
      getUsersUseridItemsItemtypeItemtargetidIsOwned,
      { userId, itemType: 2, itemTargetId: badgeId },
      { retries: 2, retryDelay: 500 }
    );
    if (isAnyErrorResponse(response) || typeof response !== "boolean") {
      throw new BindRobloxError("Roblox badge ownership could not be checked.");
    }
    if (response) owned.add(badgeId);
  }
  return owned;
}

export async function fetchOwnsGamePass(userId, gamePassId) {
  const response = await fetchApi(
    getUsersUseridItemsItemtypeItemtargetidIsOwned,
    { userId, itemType: 1, itemTargetId: gamePassId },
    { retries: 2, retryDelay: 500 }
  );
  if (isAnyErrorResponse(response) || typeof response !== "boolean") {
    throw new BindRobloxError("Roblox game-pass ownership could not be checked.");
  }
  return response;
}
