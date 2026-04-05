import express from "express";
import cors from "cors";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import apiRoutes from "./routes/index.js";
import { buildSwaggerSpec } from "./docs/swagger.js";
import notFoundHandler from "./middlewares/notFound.middleware.js";
import errorHandler from "./middlewares/error.middleware.js";

export const createApp = () => {
  const app = express();
  const swaggerSpec = buildSwaggerSpec();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan("dev"));

  app.use("/api", apiRoutes);
  app.get("/api/docs.json", (req, res) => res.json(swaggerSpec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
