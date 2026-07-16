import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { completeGameVerification } from "../verification/interactions.js";
import { err, ok } from "../utils/logger.js";
import { getGameVerificationConfig } from "./config.js";

let httpServer = null;

function secretsMatch(received, expected) {
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function startGameVerificationServer() {
  const config = getGameVerificationConfig();
  if (!config.enabled) return null;
  if (!config.ready) {
    console.error(
      err(
        "❌ Game verification is enabled but no valid Roblox verification game URL/place ID or GAME_VERIFICATION_API_KEY is configured."
      )
    );
    return null;
  }
  if (httpServer) return httpServer;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8kb", strict: true }));
  app.use((request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use((request, response, next) => {
    const authorization = request.get("authorization") || "";
    const prefix = "Bearer ";
    const received = authorization.startsWith(prefix)
      ? authorization.slice(prefix.length)
      : "";
    if (!received || !secretsMatch(received, config.apiKey)) {
      response.status(401).json({
        verified: false,
        error: "Unauthorized",
      });
      return;
    }
    next();
  });

  app.post("/verification/complete", async (request, response) => {
    const robloxUserId = Number(request.body?.robloxUserId);
    if (!Number.isSafeInteger(robloxUserId) || robloxUserId <= 0) {
      response.status(400).json({
        verified: false,
        error: "Invalid Roblox user ID",
      });
      return;
    }
    try {
      const result = await completeGameVerification(robloxUserId);
      response.status(result.status).json(result.body);
    } catch (error) {
      console.error(err(`[Game Verification Server] ${error?.stack || error}`));
      response.status(500).json({
        verified: false,
        error: "Verification could not be completed",
      });
    }
  });

  app.use((error, request, response, next) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({
        verified: false,
        error: "Invalid JSON body",
      });
      return;
    }
    console.error(err(`[Game Verification Server] ${error?.stack || error}`));
    response.status(500).json({
      verified: false,
      error: "Internal server error",
    });
  });

  httpServer = app.listen(config.port, "0.0.0.0", () => {
    console.log(ok(`✅ Game verification server listening on port ${config.port}`));
  });
  httpServer.on("error", (error) => {
    console.error(err(`[Game Verification Server] ${error?.stack || error}`));
  });
  return httpServer;
}
