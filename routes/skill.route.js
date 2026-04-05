import { Router } from "express";
import {
  createSkill,
  createStaffSkill,
  deleteSkill,
  deleteStaffSkill,
  getSkillById,
  getSkills,
  getStaffSkillById,
  getStaffSkills,
  updateSkill,
  updateStaffSkill,
} from "../controllers/skill.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManagerOrAdmin } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/staff", checkAuthentication, requireManagerOrAdmin, createStaffSkill);
router.get("/staff/all", checkAuthentication, getStaffSkills);
router.get("/staff/:id", checkAuthentication, getStaffSkillById);
router.patch("/staff/:id", checkAuthentication, requireManagerOrAdmin, updateStaffSkill);
router.delete("/staff/:id", checkAuthentication, requireManagerOrAdmin, deleteStaffSkill);

router.post("/", checkAuthentication, requireManagerOrAdmin, createSkill);
router.get("/", checkAuthentication, getSkills);
router.get("/:id", checkAuthentication, getSkillById);
router.patch("/:id", checkAuthentication, requireManagerOrAdmin, updateSkill);
router.delete("/:id", checkAuthentication, requireManagerOrAdmin, deleteSkill);

export default router;
