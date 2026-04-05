import Skill from "../models/Skill.js";
import StaffSkill from "../models/StaffSkill.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createCrudController } from "./crud.controller.js";
import { sendUserNotification } from "../services/notificationEvents.service.js";

const skillController = createCrudController(Skill);
const staffSkillController = createCrudController(StaffSkill, {
  populate: "user_id skill_id verified_by",
});

export const createSkill = skillController.createOne;
export const getSkills = skillController.getAll;
export const getSkillById = skillController.getById;
export const updateSkill = skillController.updateById;
export const deleteSkill = skillController.deleteById;

export const createStaffSkill = asyncHandler(async (req, res) => {
  const staffSkill = await StaffSkill.create(req.body);
  const populated = await StaffSkill.findById(staffSkill._id).populate(
    "user_id skill_id verified_by"
  );

  await sendUserNotification({
    user_id: populated.user_id?._id || populated.user_id,
    title: "New skill added",
    message: "A new skill has been assigned to your profile.",
    category: "skill_assigned",
    priority: "normal",
    data: {
      staff_skill_id: populated._id.toString(),
      skill_id: (populated.skill_id?._id || populated.skill_id || "").toString(),
    },
  });

  return res.status(201).json({ success: true, data: populated });
});
export const getStaffSkills = staffSkillController.getAll;
export const getStaffSkillById = staffSkillController.getById;
export const updateStaffSkill = staffSkillController.updateById;
export const deleteStaffSkill = staffSkillController.deleteById;
