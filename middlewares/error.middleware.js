const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";

  if (res.headersSent) {
    return next(err);
  }

  return res.status(statusCode).json({
    success: false,
    message,
    error:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            name: err.name,
            details: err.errors || null,
            stack: err.stack,
          },
  });
};

export default errorHandler;
