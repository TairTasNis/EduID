import { createHmac, randomBytes } from "node:crypto";

const SECRET = process.env.SESSION_TOKEN_SECRET || "sush-gradio-captcha-session-key-2024";

export function encodeSessionToken(cookies) {
  const data = JSON.stringify(Object.fromEntries(cookies));
  const encoded = Buffer.from(data).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function decodeSessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex <= 0) return null;

  const encoded = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  const expected = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  if (signature !== expected) return null;

  try {
    const data = JSON.parse(Buffer.from(encoded, "base64url").toString());
    return new Map(Object.entries(data));
  } catch {
    return null;
  }
}
