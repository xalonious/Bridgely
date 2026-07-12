import { randomInt } from "node:crypto";

const READABLE_WORDS = Object.freeze([
  "amber", "anchor", "apple", "arrow", "atlas", "autumn", "bamboo", "beacon",
  "birch", "bloom", "breeze", "brook", "canyon", "cedar", "cherry", "cloud",
  "clover", "comet", "coral", "cosmos", "crystal", "dawn", "delta", "dove",
  "dream", "ember", "fern", "field", "finch", "forest", "frost", "garden",
  "glade", "glow", "harbor", "hazel", "honey", "island", "ivy", "jade",
  "juniper", "lagoon", "lake", "lantern", "leaf", "lilac", "lotus", "lunar",
  "maple", "meadow", "meteor", "mist", "moon", "moss", "mountain", "nova",
  "oasis", "ocean", "olive", "opal", "orchid", "pearl", "pine", "plum",
  "pond", "prism", "rain", "reef", "river", "robin", "rose", "sage",
  "shore", "silver", "sky", "snow", "solar", "sparrow", "spring", "star",
  "stone", "storm", "summit", "sunset", "thunder", "tulip", "valley", "violet",
  "willow", "winter", "wood", "zephyr",
]);

export function generateVerificationCode(wordCount = 4) {
  const available = [...READABLE_WORDS];
  const selected = [];

  for (let index = 0; index < wordCount; index += 1) {
    const selectionIndex = randomInt(available.length);
    selected.push(available.splice(selectionIndex, 1)[0]);
  }

  return selected.join("-");
}
