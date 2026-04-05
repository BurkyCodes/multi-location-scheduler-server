import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";
import isValidPassword from "../utils/isValidPassword.js";

const LOGIN_ATTEMPT_LIMIT = 3;
const OTP_EXPIRY_MINUTES = 10;

const getTokenPayload = (user) => ({
  id: user._id,
  userOrgId: null,
});

const signAccessToken = (payload) =>
  jwt.sign(payload, process.env.LOGIN_SECRET, { expiresIn: "24h" });

const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.LOGIN_SECRET, { expiresIn: "30d" });

const generateOtp = () => `${Math.floor(100000 + Math.random() * 900000)}`;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const setUserOtp = (user, type) => {
  const otp = generateOtp();
  user.otp_code = otp;
  user.otp_type = type;
  user.otp_expires_at = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  return otp;
};

const clearUserOtp = (user) => {
  user.otp_code = undefined;
  user.otp_type = undefined;
  user.otp_expires_at = undefined;
};

export const gmsRegistration = asyncHandler(async (req, res) => {
  const { phone_number, country_code, name, email } = req.body;

  if (!phone_number) {
    return res.status(400).json({ message: "phone_number is required" });
  }

  const existingUser = await User.findOne({ phone_number });
  if (existingUser) {
    return res.status(409).json({ message: "User already exists" });
  }

  const user = new User({
    phone_number,
    country_code,
    name,
    email,
    status: "active",
  });

  const otp = setUserOtp(user, "verification");
  await user.save();

  return res.status(201).json({
    message: "Registration successful. Please verify your phone number.",
    otp,
    user_id: user._id,
  });
});

export const userLogin = asyncHandler(async (req, res) => {
  const { email, phone_number, password } = req.body;

  if ((!phone_number && !email) || !password) {
    return res.status(400).json({
      message: "Provide email or phone_number, and password",
    });
  }

  if (!process.env.LOGIN_SECRET) {
    return res.status(500).json({
      message: "LOGIN_SECRET is not configured",
    });
  }

  const existingUser = await User.findOne({
    ...(phone_number
      ? { phone_number }
      : { email: new RegExp(`^${escapeRegex(email)}$`, "i") }),
  }).select("+password");

  if (!existingUser) {
    return res.status(404).json({
      message: "User does not exist",
    });
  }

  if (existingUser.status === "deactivated") {
    return res.status(403).json({ message: "Your account is deactivated" });
  }

  if (existingUser.failed_attempts >= LOGIN_ATTEMPT_LIMIT) {
    return res.status(401).json({ message: "Your account is locked" });
  }

  // First login: set PIN/password (hashed) if not yet set.
  if (!existingUser.password || existingUser.is_pin_set === false) {
    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: "Password must be exactly 4 numeric digits",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    existingUser.password = hashedPassword;
    existingUser.is_pin_set = true;
    existingUser.failed_attempts = 0;

    const tokenPayload = getTokenPayload(existingUser);
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    existingUser.access_token = accessToken;
    existingUser.refresh_token = refreshToken;
    await existingUser.save();

    const userObject = existingUser.toObject();
    delete userObject.password;

    return res.status(200).json({
      message: "First login successful. PIN set securely.",
      user: userObject,
      accessToken,
      refreshToken,
    });
  }

  const isPasswordCorrect = await bcrypt.compare(password, existingUser.password);

  if (!isPasswordCorrect) {
    existingUser.failed_attempts += 1;
    const remainingAttempts = Math.max(
      LOGIN_ATTEMPT_LIMIT - existingUser.failed_attempts,
      0
    );

    if (existingUser.failed_attempts >= LOGIN_ATTEMPT_LIMIT) {
      await existingUser.save();
      return res.status(401).json({ message: "Your account has been locked" });
    }

    await existingUser.save();
    return res.status(401).json({
      message: `Invalid credentials. ${remainingAttempts} attempts remaining.`,
    });
  }

  existingUser.failed_attempts = 0;
  const tokenPayload = getTokenPayload(existingUser);
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);
  existingUser.access_token = accessToken;
  existingUser.refresh_token = refreshToken;
  await existingUser.save();

  const userObject = existingUser.toObject();
  delete userObject.password;

  return res.status(200).json({
    message: "Login successful",
    user: userObject,
    accessToken,
    refreshToken,
  });
});

export const userLogout = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);

  if (!user) {
    return res.status(404).json({ message: "User does not exist" });
  }

  user.access_token = null;
  user.refresh_token = null;
  await user.save();

  return res.status(200).json({ message: "Successfully logged out" });
});

export const verifyPhoneNumber = asyncHandler(async (req, res) => {
  const { phone_number, otp } = req.body;

  if (!phone_number || !otp) {
    return res.status(400).json({ message: "phone_number and otp are required" });
  }

  const user = await User.findOne({ phone_number }).select(
    "+otp_code +otp_type +otp_expires_at"
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const otpValid =
    user.otp_type === "verification" &&
    user.otp_code === otp &&
    user.otp_expires_at &&
    user.otp_expires_at > new Date();

  if (!otpValid) {
    return res.status(409).json({ message: "Invalid or expired OTP" });
  }

  user.is_phone_verified = true;
  clearUserOtp(user);
  await user.save();

  return res.status(200).json({ message: "Phone number verified successfully" });
});

export const resendOtp = asyncHandler(async (req, res) => {
  const { phone_number, type } = req.body;
  const allowedTypes = ["verification", "reset_password", "unlock_account"];

  if (!phone_number || !type) {
    return res.status(400).json({ message: "phone_number and type are required" });
  }

  if (!allowedTypes.includes(type)) {
    return res.status(400).json({ message: "Invalid OTP type" });
  }

  const user = await User.findOne({ phone_number }).select(
    "+otp_code +otp_type +otp_expires_at"
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const otp = setUserOtp(user, type);
  await user.save();

  return res.status(200).json({
    message: `Use the otp sent to ${phone_number}`,
    otp,
  });
});

export const requestResetPasswordOtp = asyncHandler(async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) {
    return res.status(400).json({ message: "phone_number is required" });
  }

  const user = await User.findOne({ phone_number }).select(
    "+otp_code +otp_type +otp_expires_at"
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const otp = setUserOtp(user, "reset_password");
  await user.save();

  return res.status(200).json({
    message: "OTP sent successfully",
    otp,
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { phone_number, otp, new_password } = req.body;

  if (!phone_number || !otp || !new_password) {
    return res
      .status(400)
      .json({ message: "phone_number, otp and new_password are required" });
  }

  if (!isValidPassword(new_password)) {
    return res.status(400).json({
      message: "new_password must be exactly 4 numeric digits",
    });
  }

  const user = await User.findOne({ phone_number }).select(
    "+password +otp_code +otp_type +otp_expires_at"
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const otpValid =
    user.otp_type === "reset_password" &&
    user.otp_code === otp &&
    user.otp_expires_at &&
    user.otp_expires_at > new Date();

  if (!otpValid) {
    return res.status(409).json({ message: "Invalid or expired OTP" });
  }

  user.password = await bcrypt.hash(new_password, 12);
  user.is_pin_set = true;
  user.failed_attempts = 0;
  clearUserOtp(user);
  await user.save();

  return res.status(200).json({
    message: "Password reset successfully",
    user: {
      _id: user._id,
      phone_number: user.phone_number,
      name: user.name,
      email: user.email,
    },
  });
});

export const requestUnlockAccountOtp = asyncHandler(async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) {
    return res.status(400).json({ message: "phone_number is required" });
  }

  const user = await User.findOne({ phone_number }).select(
    "+otp_code +otp_type +otp_expires_at"
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const otp = setUserOtp(user, "unlock_account");
  await user.save();

  return res.status(200).json({
    message: "OTP sent successfully",
    otp,
  });
});

export const unlockAccount = asyncHandler(async (req, res) => {
  const { phone_number, otp } = req.body;
  if (!phone_number || !otp) {
    return res.status(400).json({ message: "phone_number and otp are required" });
  }

  const user = await User.findOne({ phone_number }).select(
    "+otp_code +otp_type +otp_expires_at"
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const otpValid =
    user.otp_type === "unlock_account" &&
    user.otp_code === otp &&
    user.otp_expires_at &&
    user.otp_expires_at > new Date();

  if (!otpValid) {
    return res.status(409).json({ message: "Invalid or expired OTP" });
  }

  user.failed_attempts = 0;
  clearUserOtp(user);
  await user.save();

  return res.status(200).json({
    message: "Account unlocked successfully",
    user: {
      _id: user._id,
      phone_number: user.phone_number,
      name: user.name,
      email: user.email,
    },
  });
});

export const getAuthenticatedProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).populate({
    path: "role_id",
    select: "role",
  });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.status(200).json({
    message: "User profile retrieved successfully",
    user,
  });
});

export const getUserDetailsById = asyncHandler(async (req, res) => {
  const { user_id, garage_id } = req.params;
  const { fromDate, toDate } = req.query;

  const requester = await User.findById(req.userId).populate({
    path: "role_id",
    select: "role",
  });
  if (!requester) {
    return res.status(404).json({ message: "User not found" });
  }

  const requesterRole = requester.role_id?.role;
  if (!["admin", "manager"].includes(requesterRole) && String(req.userId) !== String(user_id)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const user = await User.findById(user_id);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.status(200).json({
    user,
    garage: { garage_id },
    filters: { fromDate: fromDate || null, toDate: toDate || null },
    vehicles: [],
    invoices: [],
    engagements: [],
    summary: {
      total_vehicles: 0,
      total_invoices: 0,
      total_engagements: 0,
    },
  });
});
