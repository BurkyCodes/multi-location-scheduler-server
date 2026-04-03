import ClockEvent from "../models/ClockEvent.js";
import { createCrudController } from "./crud.controller.js";

const clockController = createCrudController(ClockEvent, {
  populate: "user_id shift_id location_id",
});

export const createClockEvent = clockController.createOne;
export const getClockEvents = clockController.getAll;
export const getClockEventById = clockController.getById;
export const updateClockEvent = clockController.updateById;
export const deleteClockEvent = clockController.deleteById;
