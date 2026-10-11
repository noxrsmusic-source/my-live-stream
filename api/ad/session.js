import crypto from "crypto";
import admin, { db } from "../_firebase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const idToken = (req.headers.authorization || "").replace("Bearer ", "");
    if (!idToken) return res.status(401).json({ error: "No token" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const ymid = crypto.randomBytes(16).toString("hex");
    const sessionId = crypto.randomBytes(12).toString("hex");

    await db.ref(`ad_sessions/${ymid}`).set({
      sessionId,
      uid,
      status: "pending",
      createdAt: Date.now(),
      zoneId: req.body?.zoneId || "12008763",
    });

    res.status(200).json({
      sessionId,
      ymid,
      zoneId: req.body?.zoneId || "12008763",
    });
  } catch (e) {
    console.error("session error:", e);
    res.status(500).json({ error: e.message });
  }
}
