import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

function getClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  };
}

export function isFirebaseClientConfigured() {
  const config = getClientConfig();
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

export function getFirebaseClientAuth() {
  if (!isFirebaseClientConfigured()) {
    return null;
  }

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(getClientConfig());
  return getAuth(app);
}
