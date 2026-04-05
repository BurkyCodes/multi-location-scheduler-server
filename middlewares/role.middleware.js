import User from "../models/User.js";

export const requireManager = async (req, res, next) => {
  const user = await User.findById(req.userId).populate({
    path: "role_id",
    select: "role",
  });

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (user.status !== "active" || user.is_active === false) {
    return res.status(403).json({
      success: false,
      message: "Only active managers can perform this action",
    });
  }

  if (user.role_id?.role !== "manager") {
    return res.status(403).json({
      success: false,
      message: "Only managers can perform this action",
    });
  }

  req.authUser = user;
  return next();
};

export const requireAdmin = async (req, res, next) => {
  const user = await User.findById(req.userId).populate({
    path: "role_id",
    select: "role",
  });

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (user.status !== "active" || user.is_active === false) {
    return res.status(403).json({
      success: false,
      message: "Only active admins can perform this action",
    });
  }

  if (user.role_id?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Only admins can perform this action",
    });
  }

  req.authUser = user;
  return next();
};

export const requireManagerOrAdmin = async (req, res, next) => {
  const user = await User.findById(req.userId).populate({
    path: "role_id",
    select: "role",
  });

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (user.status !== "active" || user.is_active === false) {
    return res.status(403).json({
      success: false,
      message: "Only active managers or admins can perform this action",
    });
  }

  if (!["manager", "admin"].includes(user.role_id?.role)) {
    return res.status(403).json({
      success: false,
      message: "Only managers or admins can perform this action",
    });
  }

  req.authUser = user;
  return next();
};
