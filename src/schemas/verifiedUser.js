import mongoose from "mongoose";
import { VERIFICATION_METHODS } from "../verification/constants.js";

const verifiedUserSchema = new mongoose.Schema(
  {
    discordUserId: { type: String, required: true },
    guildId: { type: String, required: true },
    robloxUserId: { type: Number, required: true },
    robloxUsername: { type: String, required: true },
    verificationMethod: {
      type: String,
      required: true,
      enum: Object.values(VERIFICATION_METHODS),
    },
    verifiedAt: { type: Date, required: true },
  },
  { versionKey: false }
);

verifiedUserSchema.index(
  { guildId: 1, discordUserId: 1 },
  { unique: true, name: "unique_discord_user_per_guild" }
);
verifiedUserSchema.index(
  { guildId: 1, robloxUserId: 1 },
  { unique: true, name: "unique_roblox_user_per_guild" }
);

const VerifiedUser =
  mongoose.models.VerifiedUser ||
  mongoose.model("VerifiedUser", verifiedUserSchema);

export default VerifiedUser;
