import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readYamlFile = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf8");
  return YAML.parse(raw);
};

const loadYamlFolder = (folderPath) => {
  if (!fs.existsSync(folderPath)) return {};

  const files = fs
    .readdirSync(folderPath)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"));

  return files.reduce((acc, fileName) => {
    const fullPath = path.join(folderPath, fileName);
    const parsed = readYamlFile(fullPath) || {};
    return { ...acc, ...parsed };
  }, {});
};

export const buildSwaggerSpec = () => {
  const paths = loadYamlFolder(path.join(__dirname, "paths"));
  const schemaBundles = loadYamlFolder(path.join(__dirname, "schemas"));
  const tags = [
    ...new Set(
      Object.values(paths)
        .flatMap((pathItem) => Object.values(pathItem || {}))
        .flatMap((operation) => operation?.tags || [])
    ),
  ].map((name) => ({ name }));

  const schemas = schemaBundles.schemas || {};
  const responses = schemaBundles.responses || {};

  return {
    openapi: "3.0.3",
    info: {
      title: "ShiftSync API Documentation",
      version: "1.0.0",
      description: "OpenAPI documentation for ShiftSync backend.",
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 5000}`,
        description: "Local server",
      },
    ],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas,
      responses,
    },
  };
};
