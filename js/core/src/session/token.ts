import { verify } from "paseto-ts/v4";
import { Uuidv4 } from "../common/uuid";

interface TokenData {
  s_id: string;
  u_id: string;
  l_id: string;
}

export async function verifyToken(key: string, token: string) {
  const { payload, footer } = verify<TokenData>(key, token, {
    maxDepth: 2,
    maxKeys: 10,
    validatePayload: true,
  });
  if (!payload.exp) throw new Error("No expiry");
  const expiry = new Date(payload.exp);
  const sessionId = Uuidv4.fromString(payload.s_id);
  const userId = Uuidv4.fromString(payload.u_id);
  const primaryLibraryId = Uuidv4.fromString(payload.l_id);
  return { payload, sessionId, userId, primaryLibraryId, expiry };
}
