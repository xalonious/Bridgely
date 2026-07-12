import mongoose from "mongoose";

const criteriaSchema = new mongoose.Schema(
  {
    condition: {
      type: String,
      enum: ["EXACT", "GTE", "LTE", "BETWEEN", "MEMBER"],
      default: null,
    },
    ranks: { type: [Number], default: [] },
    minRank: { type: Number, default: null },
    maxRank: { type: Number, default: null },
  },
  { _id: false }
);

const bindSchema = new mongoose.Schema(
  {
    bindId: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["GROUP", "BADGE", "GAMEPASS"],
      required: true,
    },
    robloxGroupId: { type: Number, default: null },
    assetId: { type: Number, default: null },
    assetName: { type: String, default: null },
    criteria: { type: criteriaSchema, default: null },
    discordRoleIds: { type: [String], required: true },
    schemaVersion: { type: Number, required: true, default: 1 },
  },
  { versionKey: false }
);

bindSchema.index({ guildId: 1, bindId: 1 }, { unique: true });

const Bind = mongoose.models.Bind || mongoose.model("Bind", bindSchema);

export default Bind;
