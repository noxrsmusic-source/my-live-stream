import { db } from "../_firebase.js";

export default async function handler(req, res) {
  try {
    const { ymid, value, event } = req.query;

    console.log("[POSTBACK]", { ymid, value, event, query: req.query });

    if (!ymid) return res.status(400).send("ymid missing");

    const sessionRef = db.ref(`ad_sessions/${ymid}`);
    const snap = await sessionRef.get();
    if (!snap.exists()) return res.status(404).send("unknown ymid");

    const session = snap.val();

    // ✅ DUPLICATE PROTECTION
    if (session.status === "credited") {
      console.log("[POSTBACK] already credited:", ymid);
      return res.status(200).send("already credited");
    }

    // Sirf valued events reward dete hain
    if (value && value !== "valued") {
      await sessionRef.update({ status: "rejected", reason: "non-valued" });
      return res.status(200).send("non-valued");
    }

    const REWARD = 5;
    const uid = session.uid;

    await db.ref(`users/${uid}/coins`).transaction((cur) => (cur || 0) + REWARD);

    await sessionRef.update({
      status: "credited",
      coins: REWARD,
      creditedAt: Date.now(),
    });

    console.log("[POSTBACK] credited", REWARD, "to", uid);
    res.status(200).send("ok");
  } catch (e) {
    console.error("postback error:", e);
    res.status(500).send("error");
  }
} 
