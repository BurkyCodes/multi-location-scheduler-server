export const healthCheck = (req, res) => {
  res.json({
    success: true,
    message: "ShiftSync API is running",
    timestamp: new Date().toISOString(),
  });
};
