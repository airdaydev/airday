import { v } from "suretype";
import { APISchema } from "./utils";

export const v_session_cookie = v.object({
  id: v.string().required(),
  expires: v.string().format("date-time").required(),
  refresh_expires: v.string().format("date-time").required(),
  user_id: v.string().required(),
  primary_library_id: v.string().required(),
});

export const v_session_bearer = v.object({
  session_token: v.string().required(),
  refresh_token: v.string().required(),
  session: v.object({
    id: v.string().minLength(36).maxLength(36),
    user_id: v.string().minLength(36).maxLength(36),
    primary_library: v.string().minLength(36).maxLength(36),
    client_meta: v.any(),
  }),
});

export const passwordAuthSchema = APISchema(
  v.object({
    email: v.string().required(),
    password: v.string().required(),
  }),
);

export const passwordAuthCookieRes = APISchema(v_session_cookie);
