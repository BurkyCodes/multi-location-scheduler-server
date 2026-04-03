import Skill from "../models/Skill.js";
import StaffSkill from "../models/StaffSkill.js";
import { createCrudController } from "./crud.controller.js";

const skillController = createCrudController(Skill);
const staffSkillController = createCrudController(StaffSkill, {
  populate: "user_id skill_id verified_by",
});

export const createSkill = skillController.createOne;
export const getSkills = skillController.getAll;
export const getSkillById = skillController.getById;
export const updateSkill = skillController.updateById;
export const deleteSkill = skillController.deleteById;

export const createStaffSkill = staffSkillController.createOne;
export const getStaffSkills = staffSkillController.getAll;
export const getStaffSkillById = staffSkillController.getById;
export const updateStaffSkill = staffSkillController.updateById;
export const deleteStaffSkill = staffSkillController.deleteById;
