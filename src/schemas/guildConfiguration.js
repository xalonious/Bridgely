import mongoose from "mongoose";

const roleMappingSchema = new mongoose.Schema(
  {
    robloxRoleId: { type: Number, required: true },
    robloxRank: { type: Number, required: true },
    robloxRoleName: { type: String, required: true },
    discordRoleId: { type: String, required: true },
  },
  { _id: false }
);

const guildConfigurationSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    robloxGroupId: { type: Number, required: true },
    robloxGroupName: { type: String, required: true },
    verifiedRoleName: { type: String, required: true },
    verifiedRoleId: { type: String, required: true },
    nicknameTemplate: { type: String, required: true },
    nicknameTemplateLabel: { type: String, required: true },
    roleMappings: { type: [roleMappingSchema], default: [] },
    updatedAt: { type: Date, required: true },
    schemaVersion: { type: Number, required: true },
  },
  { versionKey: false }
);

const GuildConfiguration =
  mongoose.models.GuildConfiguration ||
  mongoose.model("GuildConfiguration", guildConfigurationSchema);

export default GuildConfiguration;
