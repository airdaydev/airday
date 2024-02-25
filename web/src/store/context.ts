import { createContext } from 'solid-js';
import { SessionStore } from './session';

export const sessionContext = createContext<SessionStore>();
