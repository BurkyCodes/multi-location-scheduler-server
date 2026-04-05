import { Router } from "express";
import {
  createAuditLog,
  getAuditLogs,
} from "../controllers/auditLog.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManagerOrAdmin } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/", checkAuthentication, requireManagerOrAdmin, createAuditLog);
router.get("/", checkAuthentication, requireManagerOrAdmin, getAuditLogs);

export default router;
