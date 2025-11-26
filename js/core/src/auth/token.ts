import { verify } from "paseto-ts/v4";
import { Uuidv4 } from "../common/uuid";

interface TokenData {
  session_id: Uuidv4;
  user_id: Uuidv4;
  primary_library_id: Uuidv4;
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
