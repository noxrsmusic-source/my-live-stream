import crypto from "crypto";
import admin, { db } from "../_firebase.js";

/* ------------------------------------------------------------
   Telegram initData verify (HMAC-SHA256)
   ------------------------------------------------------------ */
function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("hash missing");

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) {
    throw new Error("Invalid initData signature");
  }

  // 24h freshness
  const authDate = parseInt(params.get("auth_date"), 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400) {
    throw new Error("initData expired");
  }

  return JSON.parse(params.get("user"));
}

/* ------------------------------------------------------------
   Endpoint
   ------------------------------------------------------------ */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { initData } = req.body || {};
    if (!initData) return res.status(400).json({ error: "initData missing" });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return res.status(500).json({ error: "BOT_TOKEN missing" });

    const user = verifyTelegramInitData(initData, botToken);
    const uid = `tg_${user.id}`;

    const customToken = await admin.auth().createCustomToken(uid);

    await db.ref(`users/${uid}/profile`).update({
      telegramId: user.id,
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      username: user.username || "",
      photo_url: user.photo_url || "",
      lastLogin: Date.now(),
    });

    const coinsSnap = await db.ref(`users/${uid}/coins`).get();
    if (!coinsSnap.exists()) {
      await db.ref(`users/${uid}/coins`).set(0);
    }

    res.status(200).json({ customToken, uid, user });
  } catch (e) {
    console.error("auth error:", e);
    res.status(401).json({ error: e.message });
  }
}
