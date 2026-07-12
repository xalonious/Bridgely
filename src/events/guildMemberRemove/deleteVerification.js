import VerifiedUser from "../../schemas/verifiedUser.js";
import { err } from "../../utils/logger.js";

export default async (client, member) => {
  try {
    await VerifiedUser.deleteOne({
      guildId: member.guild.id,
      discordUserId: member.id,
    });
  } catch (error) {
    console.error(
      err(
        `[GuildMemberRemove] Could not delete verification data for ${member.id} in ${member.guild.id}: ${error?.stack || error}`
      )
    );
  }
};
