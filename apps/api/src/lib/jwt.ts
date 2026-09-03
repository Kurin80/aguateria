import { SignJWT, jwtVerify } from "jose";
import { loadEnv } from "../env.js";

export type AccessClaims = {
  sub: string;
  companyId: string;
  email: string;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(loadEnv().AUTH_SECRET);
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const env = loadEnv();
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
  if (!payload.sub || typeof payload.companyId !== "string" || typeof payload.email !== "string") {
    throw new Error("Token inválido");
  }
  return {
    sub: payload.sub,
    companyId: payload.companyId,
    email: payload.email,
  };
}
