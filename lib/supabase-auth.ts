"use client";

import { getSupabaseAuthHeaders, getSupabaseStorageConfig } from "./supabase";

export interface SupabaseAuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface SupabaseAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  user: SupabaseAuthUser;
}

type SupabaseAuthApiUser = {
  id?: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

const AUTH_SESSION_KEY = "worker-settlement-supabase-auth-session-v1";
const SESSION_REFRESH_WINDOW_MS = 60 * 1000;

function isBrowser() {
  return typeof window !== "undefined";
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : "";
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = window.atob(padded);
  return decodeURIComponent(
    Array.from(binary)
      .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
}

function parseJwtPayload(accessToken: string) {
  if (!isBrowser()) return undefined;
  const [, payload] = accessToken.split(".");
  if (!payload) return undefined;
  try {
    return JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function userFromToken(accessToken: string): SupabaseAuthUser {
  const payload = parseJwtPayload(accessToken);
  const metadata = payload?.user_metadata && typeof payload.user_metadata === "object" ? (payload.user_metadata as Record<string, unknown>) : {};
  const email = stringFromUnknown(payload?.email) || stringFromUnknown(metadata.email);
  return {
    id: stringFromUnknown(payload?.sub),
    email,
    name: stringFromUnknown(metadata.full_name) || stringFromUnknown(metadata.name) || email || "Google 사용자",
    avatarUrl: stringFromUnknown(metadata.avatar_url) || stringFromUnknown(metadata.picture) || undefined
  };
}

function userFromAuthApi(accessToken: string, user?: SupabaseAuthApiUser): SupabaseAuthUser {
  if (!user) return userFromToken(accessToken);
  const metadata = user.user_metadata || {};
  const email = user.email || stringFromUnknown(metadata.email);
  return {
    id: user.id || userFromToken(accessToken).id,
    email,
    name: stringFromUnknown(metadata.full_name) || stringFromUnknown(metadata.name) || email || "Google 사용자",
    avatarUrl: stringFromUnknown(metadata.avatar_url) || stringFromUnknown(metadata.picture) || undefined
  };
}

function readStoredSession(): SupabaseAuthSession | undefined {
  if (!isBrowser()) return undefined;
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return undefined;
    const session = JSON.parse(raw) as Partial<SupabaseAuthSession>;
    if (!session.accessToken || !session.refreshToken || !session.expiresAt || !session.user) return undefined;
    return session as SupabaseAuthSession;
  } catch {
    return undefined;
  }
}

function writeStoredSession(session: SupabaseAuthSession) {
  if (!isBrowser()) return;
  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

export function clearSupabaseAuthSession() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(AUTH_SESSION_KEY);
}

async function fetchSupabaseAuthUser(accessToken: string) {
  const config = getSupabaseStorageConfig();
  const headers = getSupabaseAuthHeaders(config, accessToken);
  if (!config || !headers) return undefined;
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers,
    cache: "no-store"
  });
  if (!response.ok) return undefined;
  return (await response.json()) as SupabaseAuthApiUser;
}

function createSessionFromTokens(accessToken: string, refreshToken: string, expiresInSeconds: number, tokenType = "bearer"): SupabaseAuthSession {
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    tokenType,
    user: userFromToken(accessToken)
  };
}

async function enrichAndStoreSession(session: SupabaseAuthSession) {
  try {
    const user = await fetchSupabaseAuthUser(session.accessToken);
    const enriched = { ...session, user: userFromAuthApi(session.accessToken, user) };
    writeStoredSession(enriched);
    return enriched;
  } catch {
    writeStoredSession(session);
    return session;
  }
}

async function consumeSupabaseOAuthCallback() {
  if (!isBrowser() || !window.location.hash.includes("access_token=")) return undefined;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return undefined;
  const expiresInSeconds = Number(params.get("expires_in") || 3600);
  const tokenType = params.get("token_type") || "bearer";
  const session = createSessionFromTokens(accessToken, refreshToken, Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600, tokenType);
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  return enrichAndStoreSession(session);
}

async function refreshSupabaseAuthSession(session: SupabaseAuthSession) {
  const config = getSupabaseStorageConfig();
  if (!config) return undefined;
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: config.publishableKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: session.refreshToken })
  });
  if (!response.ok) {
    clearSupabaseAuthSession();
    return undefined;
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    user?: SupabaseAuthApiUser;
  };
  if (!payload.access_token || !payload.refresh_token) {
    clearSupabaseAuthSession();
    return undefined;
  }
  const refreshed = createSessionFromTokens(payload.access_token, payload.refresh_token, payload.expires_in || 3600, payload.token_type || "bearer");
  const enriched = { ...refreshed, user: userFromAuthApi(payload.access_token, payload.user) };
  writeStoredSession(enriched);
  return enriched;
}

export async function getSupabaseAuthSession() {
  const callbackSession = await consumeSupabaseOAuthCallback();
  if (callbackSession) return callbackSession;

  const session = readStoredSession();
  if (!session) return undefined;
  if (session.expiresAt <= Date.now() + SESSION_REFRESH_WINDOW_MS) return refreshSupabaseAuthSession(session);
  return session;
}

export function getCurrentSupabaseAccessToken() {
  const session = readStoredSession();
  if (!session || session.expiresAt <= Date.now()) return undefined;
  return session.accessToken;
}

export const supabaseAuth = {
  async signInWithOAuth({ provider }: { provider: "google" }) {
    if (!isBrowser()) return { error: new Error("브라우저에서만 로그인할 수 있습니다.") };
    const config = getSupabaseStorageConfig();
    if (!config) return { error: new Error("Supabase URL 또는 publishable key가 설정되지 않았습니다.") };
    const authorizeUrl = new URL(`${config.url}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", provider);
    authorizeUrl.searchParams.set("redirect_to", `${window.location.origin}${window.location.pathname}`);
    window.location.assign(authorizeUrl.toString());
    return { error: undefined };
  },

  async signOut(session?: SupabaseAuthSession | null) {
    const config = getSupabaseStorageConfig();
    if (config && session?.accessToken) {
      try {
        await fetch(`${config.url}/auth/v1/logout`, {
          method: "POST",
          headers: getSupabaseAuthHeaders(config, session.accessToken)
        });
      } catch {
        // The local session is cleared even if the remote logout request is unavailable.
      }
    }
    clearSupabaseAuthSession();
  }
};
