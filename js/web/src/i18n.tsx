import { I18nProvider as KobalteI18nProvider, useLocale } from "@kobalte/core/i18n";
import {
  createContext,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";

export const APP_LOCALE = "es-ES";

type Messages = {
  common: {
    loading: string;
    add: string;
    close: string;
    menu: string;
    copy: string;
    delete: string;
    restore: string;
  };
  auth: {
    signIn: string;
    signUp: string;
    email: string;
    password: string;
    derivingKeys: string;
    noAccount: string;
    haveAccount: string;
    serverMissingDeviceCredential: string;
  };
  nav: {
    desk: string;
    done: string;
    bin: string;
    deleteList: string;
    newList: string;
    connected: string;
    disconnected: string;
    undo: string;
    redo: string;
    settings: string;
    website: string;
    logOut: string;
  };
  workspace: {
    emptyBin: string;
    createWithSpace: string;
    emptyState: string;
    notes: string;
    markDone: string;
    markNotDone: string;
    duplicate: string;
    moveToBin: string;
  };
  find: {
    placeholder: string;
    listBadge: string;
    itemBadge: string;
    noMatches: string;
    typeToFind: string;
  };
  settings: {
    appearance: string;
    account: string;
    devices: string;
    theme: string;
    auto: string;
    light: string;
    dark: string;
    localOnlyAccount: string;
    loginToSeeDevices: string;
    email: string;
    thisDevice: string;
    lastSeen: string;
    revoke: string;
    revoking: string;
    failedToRevokeDevice: string;
    failedToLoadDevices: string;
  };
  relative: {
    justNow: string;
    minutesAgo: (n: number) => string;
    hoursAgo: (n: number) => string;
    yesterdayAt: (time: string) => string;
    daysAgo: (n: number) => string;
  };
};

export const appMessages: Messages = {
  common: {
    loading: "Cargando…",
    add: "Añadir",
    close: "Cerrar",
    menu: "Menú",
    copy: "Copiar",
    delete: "Eliminar",
    restore: "Restaurar",
  },
  auth: {
    signIn: "Iniciar sesión",
    signUp: "Crear cuenta",
    email: "Correo",
    password: "Contraseña",
    derivingKeys: "Derivando claves…",
    noAccount: "¿No tienes cuenta? Crea una",
    haveAccount: "¿Ya tienes cuenta? Inicia sesión",
    serverMissingDeviceCredential: "el servidor no devolvió una credencial de dispositivo",
  },
  nav: {
    desk: "Escritorio",
    done: "Hecho",
    bin: "Papelera",
    deleteList: "Eliminar",
    newList: "+ Nueva lista",
    connected: "Conectado",
    disconnected: "Desconectado",
    undo: "Deshacer",
    redo: "Rehacer",
    settings: "Ajustes",
    website: "Sitio web de Airday",
    logOut: "Cerrar sesión",
  },
  workspace: {
    emptyBin: "Vaciar papelera",
    createWithSpace: "Pulsa Espacio para crear un elemento nuevo",
    emptyState: "Todavía no hay nada.",
    notes: "Notas",
    markDone: "Marcar como hecho",
    markNotDone: "Marcar como no hecho",
    duplicate: "Duplicar",
    moveToBin: "Mover a la papelera",
  },
  find: {
    placeholder: "Buscar",
    listBadge: "Lista",
    itemBadge: "Elemento",
    noMatches: "Sin resultados",
    typeToFind: "Escribe para buscar",
  },
  settings: {
    appearance: "Apariencia",
    account: "Cuenta",
    devices: "Dispositivos",
    theme: "Tema",
    auto: "Auto",
    light: "Claro",
    dark: "Oscuro",
    localOnlyAccount:
      "Estás usando una cuenta solo local. Usa Iniciar sesión o Crear cuenta desde el menú de la cuenta para hacer copia de seguridad de tus datos y sincronizar entre dispositivos.",
    loginToSeeDevices: "Inicia sesión para ver los dispositivos vinculados a tu cuenta.",
    email: "Correo",
    thisDevice: "Este dispositivo",
    lastSeen: "Última vez visto",
    revoke: "Revocar",
    revoking: "Revocando…",
    failedToRevokeDevice: "No se pudo revocar el dispositivo",
    failedToLoadDevices: "No se pudieron cargar los dispositivos",
  },
  relative: {
    justNow: "ahora mismo",
    minutesAgo: (n) => `hace ${n} min`,
    hoursAgo: (n) => `hace ${n} h`,
    yesterdayAt: (time) => `Ayer ${time}`,
    daysAgo: (n) => `hace ${n} día${n === 1 ? "" : "s"}`,
  },
};

const AppI18nContext = createContext<Messages>();

export function AppI18nProvider(props: { children: JSX.Element }) {
  return (
    <KobalteI18nProvider locale={APP_LOCALE}>
      <AppI18nContext.Provider value={appMessages}>
        {props.children}
      </AppI18nContext.Provider>
    </KobalteI18nProvider>
  );
}

export function useAppI18n(): {
  m: Messages;
  locale: Accessor<string>;
  direction: Accessor<"ltr" | "rtl">;
} {
  const m = useContext(AppI18nContext);
  if (!m) throw new Error("missing AppI18nProvider");
  const { locale, direction } = useLocale();
  return { m, locale, direction };
}
