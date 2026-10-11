/* ============================================================
   Firebase Cloud Functions — Backend
   ------------------------------------------------------------
   Endpoints:
     POST /auth/telegram        → verify initData, mint custom token
     POST /ad/session           → create unique ymid session
     GET  /ad/session/:id       → check reward status
     GET  /postback             → Monetag postback → credit coins
   ============================================================ */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");

admin.initializeApp();

const db = admin.database();
const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

/* ------------------------------------------------------------
   HELPER: Telegram initData verify (HMAC-SHA256)
   ------------------------------------------------------------
   Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
   ------------------------------------------------------------ */
function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("hash missing");

  params.delete("hash");

  // Sorted data_check_string
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // secret_key = HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // computed_hash = HMAC_SHA256(secret_key, data_check_string)
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) {
    throw new Error("Invalid initData signature");
  }

  // auth_date freshness check (24 hours)
  const authDate = parseInt(params.get("auth_date"), 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400) {
    throw new Error("initData expired");
  }

  const user = JSON.parse(params.get("user"));
  return user;
}

/* ------------------------------------------------------------
   1. TELEGRAM AUTH
   ------------------------------------------------------------ */
app.post("/auth/telegram", async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ error: "initData missing" });

    const botToken = functions.config().telegram?.bot_token
      || process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return res.status(500).json({ error: "BOT_TOKEN not configured" });

    const user = verifyTelegramInitData(initData, botToken);
    const uid = `tg_${user.id}`;

    // Firebase custom token mint
    const customToken = await admin.auth().createCustomToken(uid);

    // Upsert user profile
    await db.ref(`users/${uid}/profile`).update({
      telegramId: user.id,
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      username: user.username || "",
      photo_url: user.photo_url || "",
      lastLogin: Date.now(),
    });

    // Initialize coins if missing
    const coinsSnap = await db.ref(`users/${uid}/coins`).get();
    if (!coinsSnap.exists()) {
      await db.ref(`users/${uid}/coins`).set(0);
    }

    res.json({ customToken, uid, user });
  } catch (e) {
    console.error("auth error:", e);
    res.status(401).json({ error: e.message });
  }
});

/* ------------------------------------------------------------
   2. CREATE AD SESSION — unique ymid
   ------------------------------------------------------------ */
app.post("/ad/session", async (req, res) => {
  try {
    const idToken = (req.headers.authorization || "").replace("Bearer ", "");
    if (!idToken) return res.status(401).json({ error: "No token" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // Unique ymid — 32 hex chars
    const ymid = crypto.randomBytes(16).toString("hex");
    const sessionId = crypto.randomBytes(12).toString("hex");

    await db.ref(`ad_sessions/${ymid}`).set({
      sessionId,
      uid,
      status: "pending",
      createdAt: Date.now(),
      zoneId: req.body.zoneId || "12008763",
    });

    res.json({ sessionId, ymid, zoneId: req.body.zoneId || "12008763" });
  } catch (e) {
    console.error("session error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------
   3. CHECK REWARD STATUS
   ------------------------------------------------------------ */
app.get("/ad/session/:sessionId", async (req, res) => {
  try {
    const idToken = (req.headers.authorization || "").replace("Bearer ", "");
    const decoded = await admin.auth().verifyIdToken(idToken);

    const snap = await db
      .ref("ad_sessions")
      .orderByChild("sessionId")
      .equalTo(req.params.sessionId)
      .once("value");

    if (!snap.exists()) return res.status(404).json({ error: "not found" });

    let session;
    snap.forEach((child) => { session = child.val(); });

    if (session.uid !== decoded.uid) {
      return res.status(403).json({ error: "forbidden" });
    }

    res.json({
      status: session.status,
      coins: session.coins || 5,
      reason: session.reason || null,
    });
  } catch (e) {
    console.error("status error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------
   4. MONETAG POSTBACK — yahan coins credit hote hain
   ------------------------------------------------------------
   Monetag postback URL (dashboard mein set karo):
     https://us-central1-bizzsite-64a49.cloudfunctions.net/api/postback?ymid={ymid}&zone={zone_id}&event={event_type}&value={reward_event_type}
   ------------------------------------------------------------ */
app.get("/postback", async (req, res) => {
  try {
    const { ymid, value, event } = req.query;

    console.log("[POSTBACK]", { ymid, value, event, query: req.query });

    if (!ymid) return res.status(400).send("ymid missing");

    const sessionRef = db.ref(`ad_sessions/${ymid}`);
    const snap = await sessionRef.get();
    if (!snap.exists()) return res.status(404).send("unknown ymid");

    const session = snap.val();

    // ✅ DUPLICATE PROTECTION — ek ymid par sirf ek baar credit
    if (session.status === "credited") {
      console.log("[POSTBACK] already credited:", ymid);
      return res.status(200).send("already credited");
    }

    // Sirf "valued" events par reward do
    if (value && value !== "valued") {
      await sessionRef.update({ status: "rejected", reason: "non-valued event" });
      return res.status(200).send("non-valued");
    }

    const uid = session.uid;
    const REWARD = 5;

    // Atomic increment
    await db.ref(`users/${uid}/coins`).transaction((cur) => (cur || 0) + REWARD);

    await sessionRef.update({
      status: "credited",
      coins: REWARD,
      creditedAt: Date.now(),
    });

    console.log("[POSTBACK] credited", REWARD, "coins to", uid);
    res.status(200).send("ok");
  } catch (e) {
    console.error("postback error:", e);
    res.status(500).send("error");
  }
});

/* ------------------------------------------------------------
   EXPORT
   ------------------------------------------------------------ */
exports.api = functions.https.onRequest(app);
