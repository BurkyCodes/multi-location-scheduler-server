import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let initialized = false;

const getServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const json = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8");
    return JSON.parse(json);
  }

  const localPath = path.join(__dirname, "firebase-service-account.json");
  if (fs.existsSync(localPath)) {
    const json = fs.readFileSync(localPath, "utf8");
    return JSON.parse(json);
  }

  return null;
};

try {
  if (!admin.apps.length) {
    const serviceAccount = getServiceAccount();
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      initialized = true;
      console.log("Firebase Admin initialized");
    } else {
      console.warn(
        "Firebase Admin not initialized: set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH"
      );
    }
  } else {
    initialized = true;
  }
} catch (error) {
  console.warn("Firebase Admin initialization failed:", error.message);
}

export const isFirebaseReady = () => initialized && admin.apps.length > 0;
export default admin;
