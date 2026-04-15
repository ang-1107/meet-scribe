import { getFirebaseAdminAuth } from "@/lib/firebase/admin";

const DEV_TOKEN_PREFIX = "DEV:";

function getTokenFromRequest(request, allowQueryToken = false) {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) {
    return bearerMatch[1].trim();
  }

  if (allowQueryToken) {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get("token");
    if (queryToken) {
      return queryToken.trim();
    }
  }

  return "";
}

function allowDevAuth() {
  if (process.env.FIREBASE_ALLOW_DEV_AUTH !== undefined) {
    return process.env.FIREBASE_ALLOW_DEV_AUTH === "true";
  }
  return process.env.NODE_ENV !== "production";
}

function parseDevToken(token) {
  if (!token.startsWith(DEV_TOKEN_PREFIX)) {
    return null;
  }

  const uid = token.slice(DEV_TOKEN_PREFIX.length).trim();
  if (!uid) {
    return null;
  }

  return {
    uid,
    provider: "dev"
  };
}

export async function requireAuth(request, options = {}) {
  const allowQueryToken = options.allowQueryToken === true;
  const token = getTokenFromRequest(request, allowQueryToken);

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Missing authentication token."
    };
  }

  if (allowDevAuth()) {
    const dev = parseDevToken(token);
    if (dev) {
      return {
        ok: true,
        user: dev
      };
    }
  }

  const adminAuth = getFirebaseAdminAuth();
  if (!adminAuth) {
    return {
      ok: false,
      status: 500,
      error: "Firebase Admin is not configured on the server."
    };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      ok: true,
      user: {
        uid: decoded.uid,
        email: decoded.email || "",
        provider: "firebase"
      }
    };
  } catch {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired authentication token."
    };
  }
}
