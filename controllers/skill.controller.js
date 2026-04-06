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
  const { user_id, skill_id } = req.body;

  if (!user_id || !skill_id) {
    return res.status(400).json({
      success: false,
      message: "user_id and skill_id are required",
    });
  }

  const existing = await StaffSkill.findOne({ user_id, skill_id }).populate(
    "user_id skill_id verified_by"
  );

  if (existing?.is_active) {
    const staffName =
      existing.user_id?.name || existing.user_id?.email || "This staff member";
    const skillName =
      existing.skill_id?.name || existing.skill_id?.code || "selected skill";
    return res.status(409).json({
      success: false,
      message: `${staffName} already has ${skillName} assigned.`,
    });
  }

  const staffSkill = existing
    ? await StaffSkill.findByIdAndUpdate(
        existing._id,
        {
          ...req.body,
          is_active: true,
        },
        { new: true, runValidators: true }
      )
    : await StaffSkill.create(req.body);

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

  return res.status(existing ? 200 : 201).json({
    success: true,
    message: existing ? "Existing staff skill was re-activated." : undefined,
    data: populated,
  });
});
export const getStaffSkills = staffSkillController.getAll;
export const getStaffSkillById = staffSkillController.getById;
export const updateStaffSkill = staffSkillController.updateById;
export const deleteStaffSkill = staffSkillController.deleteById;
