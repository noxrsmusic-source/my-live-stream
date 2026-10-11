import admin, { db } from "../_firebase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const idToken = (req.headers.authorization || "").replace("Bearer ", "");
    if (!idToken) return res.status(401).json({ error: "No token" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const sessionId = req.query.sessionId;

    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const snap = await db
      .ref("ad_sessions")
      .orderByChild("sessionId")
      .equalTo(sessionId)
      .once("value");

    if (!snap.exists()) return res.status(404).json({ error: "not found" });

    let session;
    snap.forEach((child) => { session = child.val(); });

    if (session.uid !== decoded.uid) {
      return res.status(403).json({ error: "forbidden" });
    }

    res.status(200).json({
      status: session.status,
      coins: session.coins || 5,
      reason: session.reason || null,
    });
  } catch (e) {
    console.error("status error:", e);
    res.status(500).json({ error: e.message });
  }
}
