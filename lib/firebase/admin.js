import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function normalizePrivateKey(value) {
  if (!value) {
    return "";
  }

  let key = String(value).trim();
  const hasDoubleQuotes = key.startsWith('"') && key.endsWith('"');
  const hasSingleQuotes = key.startsWith("'") && key.endsWith("'");
  const hasBackticks = key.startsWith("`") && key.endsWith("`");

  if (hasDoubleQuotes || hasSingleQuotes || hasBackticks) {
    key = key.slice(1, -1);
  }

  return key.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
}

function getServiceAccountFromEnv() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.private_key) {
        parsed.private_key = normalizePrivateKey(parsed.private_key);
      }
      return parsed;
    } catch {
      return null;
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyBase64 = process.env.FIREBASE_PRIVATE_KEY_BASE64;
  const privateKey = privateKeyBase64
    ? Buffer.from(privateKeyBase64, "base64").toString("utf8")
    : process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: normalizePrivateKey(privateKey)
  };
}

function getFirebaseAdminApp() {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  const serviceAccount = getServiceAccountFromEnv();
  if (!serviceAccount) {
    return null;
  }

  try {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  } catch {
    return null;
  }
}

export function getFirebaseAdminAuth() {
  const app = getFirebaseAdminApp();
  return app ? getAuth(app) : null;
}

export function getFirebaseAdminFirestore() {
  const app = getFirebaseAdminApp();
  return app ? getFirestore(app) : null;
}
