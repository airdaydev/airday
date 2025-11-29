import { verify } from "paseto-ts/v4";
import { Uuidv4 } from "../common/uuid";

interface TokenData {
  s_id: Uuidv4;
  u_id: Uuidv4;
  l_id: Uuidv4;
}

export async function verifyToken(key: string, token: string) {
  const { payload, footer } = verify<TokenData>(key, token, {
    // assertion,
    maxDepth: 1,
    maxKeys: 6,
    validatePayload: true,
  });
  console.log(payload);
  return payload;
}
