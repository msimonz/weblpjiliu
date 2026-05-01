import { createHmac, timingSafeEqual } from "crypto";

const ISS = "weblpjiliu-imp";
const EXP_SECONDS = 3600; // 1 hora

export function signImpToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ ...payload, iss: ISS, exp: Math.floor(Date.now() / 1000) + EXP_SECONDS })
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyImpToken(token, secret) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;

  let expected;
  try {
    expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  } catch {
    return null;
  }

  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }

  if (payload.iss !== ISS) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}
