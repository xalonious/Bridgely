import { autocompleteRank, rankingOptions, runRanking } from "../../ranking/commands.js";

export default {
  name: "rank",
  description: "Add or remove a Roblox group role by Roblox username",
  usage: "add|remove username:<Roblox username> rank:<role>",
  options: rankingOptions("username"),
  autocomplete: autocompleteRank,
  run: (_client, interaction) => runRanking(interaction),
};
