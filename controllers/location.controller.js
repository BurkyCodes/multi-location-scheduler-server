import Location from "../models/Location.js";
import { createCrudController } from "./crud.controller.js";

const locationController = createCrudController(Location);

export const createLocation = locationController.createOne;
export const getLocations = locationController.getAll;
export const getLocationById = locationController.getById;
export const updateLocation = locationController.updateById;
export const deleteLocation = locationController.deleteById;
