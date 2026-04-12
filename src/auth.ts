import * as vscode from "vscode";
import * as http from "http";
import * as crypto from "crypto";
import { URL } from "url";
import { FIREBASE_API_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } from "./constants.js";

const SECRET_KEY_ID_TOKEN = "hoverchart.idToken";
const SECRET_KEY_REFRESH_TOKEN = "hoverchart.refreshToken";
const SECRET_KEY_USER_ID = "hoverchart.userId";
const SECRET_KEY_TOKEN_EXPIRY = "hoverchart.tokenExpiry";

const REDIRECT_PORT = 9876;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

/**
 * Initiates a Google OAuth login flow by:
 * 1. Opening a browser window for Google sign-in.
 * 2. Capturing the OAuth code via a temporary localhost HTTP server.
 * 3. Exchanging the code for a Firebase ID token via the REST API.
 */
export async function login(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = FIREBASE_API_KEY;
  const clientId = GOOGLE_OAUTH_CLIENT_ID;

  const state = crypto.randomBytes(16).toString("hex");

  // PKCE: generate code_verifier and code_challenge
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Build the Google OAuth URL
  const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  oauthUrl.searchParams.set("client_id", clientId);
  oauthUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("scope", "openid email profile");
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("access_type", "offline");
  oauthUrl.searchParams.set("prompt", "consent");
  oauthUrl.searchParams.set("code_challenge", codeChallenge);
  oauthUrl.searchParams.set("code_challenge_method", "S256");

  // Start a temporary HTTP server to capture the OAuth redirect
  const code = await new Promise<string>((resolve, reject) => {
    let server: http.Server | null = null;

    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error("OAuth login timed out after 5 minutes."));
    }, 5 * 60 * 1000);

    server = http.createServer((req, res) => {
      if (!req.url) {
        return;
      }
      const reqUrl = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (reqUrl.pathname !== "/callback") {
        return;
      }

      const returnedState = reqUrl.searchParams.get("state");
      const authCode = reqUrl.searchParams.get("code");
      const error = reqUrl.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body><h2>Login ${error ? "failed" : "successful"}! You can close this tab.</h2></body></html>`
      );

      clearTimeout(timeout);
      server?.close();

      if (error) {
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (returnedState !== state) {
        reject(new Error("OAuth state mismatch – possible CSRF."));
        return;
      }
      if (!authCode) {
        reject(new Error("No OAuth code received."));
        return;
      }
      resolve(authCode);
    });

    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      vscode.env.openExternal(vscode.Uri.parse(oauthUrl.toString()));
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Exchange the auth code for a Firebase ID token via signInWithIdp
  // We need to first exchange the code for a Google ID token, then pass it to Firebase.
  // For OAuth code flow we exchange with tokeninfo endpoint first.
  const googleTokenResponse = await fetchJson<{
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (googleTokenResponse.error || !googleTokenResponse.id_token) {
    throw new Error(
      `Google token exchange failed: ${googleTokenResponse.error_description ?? googleTokenResponse.error ?? "no id_token"}`
    );
  }

  const firebaseResponse = await fetchJson<{
    idToken?: string;
    refreshToken?: string;
    localId?: string;
    error?: { message?: string };
  }>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postBody: `id_token=${googleTokenResponse.id_token}&providerId=google.com`,
        requestUri: REDIRECT_URI,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    }
  );

  if (firebaseResponse.error || !firebaseResponse.idToken) {
    throw new Error(
      `Firebase sign-in failed: ${firebaseResponse.error?.message ?? "no idToken"}`
    );
  }

  const expiryMs = Date.now() + 55 * 60 * 1000; // 55 min (tokens expire at 60 min)
  await Promise.all([
    context.secrets.store(SECRET_KEY_ID_TOKEN, firebaseResponse.idToken),
    context.secrets.store(
      SECRET_KEY_REFRESH_TOKEN,
      firebaseResponse.refreshToken ?? ""
    ),
    context.secrets.store(SECRET_KEY_USER_ID, firebaseResponse.localId ?? ""),
    context.secrets.store(SECRET_KEY_TOKEN_EXPIRY, String(expiryMs)),
  ]);

  vscode.window.showInformationMessage("Hoverchart: Logged in successfully.");
}

/**
 * Returns a valid Firebase ID token, refreshing it if necessary.
 * Returns `undefined` if not logged in.
 */
export async function getIdToken(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  const [idToken, refreshToken, expiryStr] = await Promise.all([
    context.secrets.get(SECRET_KEY_ID_TOKEN),
    context.secrets.get(SECRET_KEY_REFRESH_TOKEN),
    context.secrets.get(SECRET_KEY_TOKEN_EXPIRY),
  ]);

  if (!idToken) {
    return undefined;
  }

  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  if (Date.now() < expiry) {
    return idToken;
  }

  // Token expired – try to refresh it
  if (!refreshToken) {
    return undefined;
  }

  const apiKey = FIREBASE_API_KEY;

  try {
    const refreshed = await fetchJson<{
      id_token?: string;
      refresh_token?: string;
      user_id?: string;
      error?: { message?: string };
    }>(
      `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
      }
    );

    if (refreshed.error || !refreshed.id_token) {
      return undefined;
    }

    const newExpiry = Date.now() + 55 * 60 * 1000;
    await Promise.all([
      context.secrets.store(SECRET_KEY_ID_TOKEN, refreshed.id_token),
      context.secrets.store(
        SECRET_KEY_REFRESH_TOKEN,
        refreshed.refresh_token ?? refreshToken
      ),
      context.secrets.store(SECRET_KEY_TOKEN_EXPIRY, String(newExpiry)),
    ]);

    return refreshed.id_token;
  } catch {
    return undefined;
  }
}

/**
 * Returns the Firebase user ID of the currently authenticated user,
 * or `undefined` if not logged in.
 */
export async function getUserId(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  return context.secrets.get(SECRET_KEY_USER_ID);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${text}`);
  }
}
