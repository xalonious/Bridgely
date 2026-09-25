import { autocompleteRank, rankingOptions, runRanking } from "../../ranking/commands.js";

export default {
  name: "rank-user",
  description: "Add or remove a Roblox group role for a verified Discord member",
  usage: "add|remove user:<member> rank:<role>",
  options: rankingOptions("user"),
  autocomplete: autocompleteRank,
  run: (_client, interaction) => runRanking(interaction),
};
