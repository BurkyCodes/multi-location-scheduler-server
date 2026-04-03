import { Router } from "express";
import {
  createCertification,
  deleteCertification,
  getCertificationById,
  getCertifications,
  updateCertification,
} from "../controllers/certification.controller.js";

const router = Router();

router.post("/", createCertification);
router.get("/", getCertifications);
router.get("/:id", getCertificationById);
router.patch("/:id", updateCertification);
router.delete("/:id", deleteCertification);

export default router;
