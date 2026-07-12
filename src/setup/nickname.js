import { DISCORD_NICKNAME_LIMIT } from "./constants.js";

const PLACEHOLDERS = Object.freeze([
  "discord_username",
  "discord_display_name",
  "roblox_username",
  "roblox_display_name",
]);


export function truncateNickname(value, limit = DISCORD_NICKNAME_LIMIT) {
  return Array.from(String(value ?? "")).slice(0, limit).join("");
}

export function renderNicknameTemplate(template, values = {}) {
  let rendered = String(template ?? "");

  for (const placeholder of PLACEHOLDERS) {
    const replacement = String(values[placeholder] ?? "").trim();
    rendered = rendered.replaceAll(`{${placeholder}}`, replacement);
  }

  rendered = rendered
    .replace(/\(\s*@?\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!rendered || rendered === "@") {
    rendered = [
      values.discord_display_name,
      values.discord_username,
      values.roblox_display_name,
      values.roblox_username,
      "Verified",
    ].find((value) => String(value ?? "").trim()) ?? "Verified";
  }

  return truncateNickname(rendered);
}
