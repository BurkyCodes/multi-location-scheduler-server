import { Router } from "express";
import {
  createCertification,
  deleteCertification,
  getCertificationById,
  getCertifications,
  updateCertification,
} from "../controllers/certification.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManagerOrAdmin } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/", checkAuthentication, requireManagerOrAdmin, createCertification);
router.get("/", checkAuthentication, getCertifications);
router.get("/:id", checkAuthentication, getCertificationById);
router.patch("/:id", checkAuthentication, requireManagerOrAdmin, updateCertification);
router.delete("/:id", checkAuthentication, requireManagerOrAdmin, deleteCertification);

export default router;
