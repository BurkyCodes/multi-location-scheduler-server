import { Router } from "express";
import {
  getAuthenticatedProfile,
  getUserDetailsById,
  gmsRegistration,
  requestResetPasswordOtp,
  requestUnlockAccountOtp,
  resendOtp,
  resetPassword,
  unlockAccount,
  userLogin,
  verifyPhoneNumber,
} from "../controllers/auth.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/gms", gmsRegistration);
router.post("/login", userLogin);
router.post("/verify-number", verifyPhoneNumber);
router.post("/resend-otp", resendOtp);
router.post("/reset-password", requestResetPasswordOtp);
router.patch("/reset-password", resetPassword);
router.post("/unlock-account", requestUnlockAccountOtp);
router.patch("/unlock-account", unlockAccount);
router.get("/profile", checkAuthentication, getAuthenticatedProfile);
router.get("/user/:user_id/:garage_id", checkAuthentication, getUserDetailsById);

export default router;
