import { v } from "suretype";
import { APISchema } from "./utils";

export const v_session_cookie = v.object({
  id: v.string().required(),
  expires: v.string().format("date-time").required(),
  refreshExpires: v.string().format("date-time").required(),
  userId: v.string().required(),
});

export const v_session_bearer = v.object({
  sessionToken: v.string().required(),
  refreshToken: v.string().required(),
});

export const passwordAuthSchema = APISchema(
  v.object({
    email: v.string().required(),
    password: v.string().required(),
  }),
);

export const passwordAuthCookieRes = APISchema(v_session_cookie);
