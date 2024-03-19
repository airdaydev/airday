import { createContext } from 'solid-js';
import { SessionStore } from './main';

export const sessionContext = createContext<SessionStore>(new SessionStore());
