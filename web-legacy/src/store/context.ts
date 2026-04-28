import { createContext } from "solid-js";
import { AirSession } from "./main";

export const airSession = new AirSession();
export const sessionContext = createContext<AirSession>(airSession);
