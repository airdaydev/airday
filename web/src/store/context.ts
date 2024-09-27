import { createContext } from "solid-js";
import { SunlistSession } from "./main";

export const sunlistSession = new SunlistSession();
export const sessionContext = createContext<SunlistSession>(sunlistSession);
