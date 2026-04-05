import { Router } from "express";
import jwt from "jsonwebtoken";
import {
  registerRealtimeConnection,
  unregisterRealtimeConnection,
} from "../services/realtimeEvents.service.js";

const router = Router();

const resolveUserIdFromToken = (token) => {
  if (!token) return null;
  const isCustomAuth = token.length < 500;
  if (isCustomAuth) {
    const jwtsecret = process.env.LOGIN_SECRET;
    const decoded = jwt.verify(token, jwtsecret);
    return decoded?.id || null;
  }
  const decoded = jwt.decode(token);
  return decoded?.sub || null;
};

router.get("/stream", (req, res) => {
  const authHeader = req.headers.authorization;
  const headerToken =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
  const queryToken = req.query?.token ? String(req.query.token) : null;
  const token = headerToken || queryToken;

  try {
    const userId = resolveUserIdFromToken(token);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    registerRealtimeConnection(userId, res);
    res.write(`event: connected\n`);
    res.write(
      `data: ${JSON.stringify({
        connected: true,
        user_id: userId,
        at: new Date().toISOString(),
      })}\n\n`
    );

    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unregisterRealtimeConnection(userId, res);
      res.end();
    });

    return undefined;
  } catch {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
});

export default router;
