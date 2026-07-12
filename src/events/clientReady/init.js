import { ActivityType } from "discord.js";
import "dotenv/config";
import getLocalCommands from "../../utils/getLocalCommands.js";
import { brand, ok, warn, err, dim, banner } from "../../utils/logger.js";
import mongoose from "mongoose";
import { configureServer } from "rozod";
import { startGameVerificationServer } from "../../server/index.js";

export default async (client) => {
  const localCommands = await getLocalCommands();
  const robloxCloudKey = process.env.ROBLOX_CLOUD_KEY?.trim();
  if (robloxCloudKey) configureServer({ cloudKey: robloxCloudKey });
  else {
    console.log(
      warn("⚠️ ROBLOX_CLOUD_KEY is not configured; multi-role Roblox sync will use the legacy single-role fallback.")
    );
  }

  banner([
    `${brand("🤖 Bot Online")}`,
    `${ok("User:")} ${client.user.tag}`,
    `${ok("Events:")} ${client.eventCount} registered`,
    `${ok("Commands:")} ${localCommands.length} loaded`, 
    `${dim(new Date().toLocaleString())}`,
  ]);

  client.user.setActivity({
    name: "The server",
    type: ActivityType.Watching,
  });


  try {
    await mongoose.connect(process.env.MONGOURL);
    console.log(ok("✅ Connected to the database"));
    startGameVerificationServer();
  }
  catch (error) {
    console.error(err(`❌ Failed to connect to the database: ${error.message}`));
  }

};
