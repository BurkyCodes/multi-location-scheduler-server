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

const router = Router();

router.post("/staff", createStaffSkill);
router.get("/staff/all", getStaffSkills);
router.get("/staff/:id", getStaffSkillById);
router.patch("/staff/:id", updateStaffSkill);
router.delete("/staff/:id", deleteStaffSkill);

router.post("/", createSkill);
router.get("/", getSkills);
router.get("/:id", getSkillById);
router.patch("/:id", updateSkill);
router.delete("/:id", deleteSkill);

export default router;
