import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebAppInitData } from "./webapp-auth";

const BOT_TOKEN = "123456:TEST-bot-token";

function sign(fields: Record<string, string>, token = BOT_TOKEN): string {
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const NOW = 1_800_000_000;
const user = JSON.stringify({ id: 2080644490, first_name: "Miftah" });

describe("verifyWebAppInitData", () => {
  it("accepts data signed with the bot token and returns the user", async () => {
    const data = sign({ auth_date: String(NOW - 60), user, query_id: "AAH" });
    expect(await verifyWebAppInitData(data, BOT_TOKEN, NOW)).toEqual({ id: 2080644490, firstName: "Miftah" });
  });

  it("rejects data signed with another token, tampered data and missing hash", async () => {
    const forged = sign({ auth_date: String(NOW), user }, "999:other");
    expect(await verifyWebAppInitData(forged, BOT_TOKEN, NOW)).toBeNull();

    const tampered = sign({ auth_date: String(NOW), user }).replace("2080644490", "1111111111");
    expect(await verifyWebAppInitData(tampered, BOT_TOKEN, NOW)).toBeNull();

    expect(await verifyWebAppInitData(`auth_date=${NOW}&user=${encodeURIComponent(user)}`, BOT_TOKEN, NOW)).toBeNull();
    expect(await verifyWebAppInitData("", BOT_TOKEN, NOW)).toBeNull();
  });

  it("rejects data older than 24 hours", async () => {
    const old = sign({ auth_date: String(NOW - 25 * 3600), user });
    expect(await verifyWebAppInitData(old, BOT_TOKEN, NOW)).toBeNull();
  });
});
