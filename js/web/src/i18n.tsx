import { I18nProvider as KobalteI18nProvider, useLocale } from "@kobalte/core/i18n";
import {
  createContext,
  createMemo,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";

export type AppLanguage = "es" | "en";

const DEFAULT_LANGUAGE: AppLanguage = "en";
const COOKIE_NAME = "locale";
const MAX_AGE = 31536000;

function cookieAttrs(maxAge: number): string {
  return `path=/;max-age=${maxAge};SameSite=Lax`;
}

function readLanguage(): AppLanguage {
  try {
    const m = document.cookie.match(/(?:^|; )locale=(es|en)/);
    if (m?.[1] === "es" || m?.[1] === "en") return m[1];
  } catch {}
  return DEFAULT_LANGUAGE;
}

function writeLanguage(language: AppLanguage) {
  document.cookie = `${COOKIE_NAME}=${language};${cookieAttrs(MAX_AGE)}`;
}

const localeByLanguage: Record<AppLanguage, string> = {
  es: "es-ES",
  en: "en-US",
};

type Messages = {
  common: {
    loading: string;
    add: string;
    addItem: string;
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
    home: string;
    done: string;
    bin: string;
    deleteList: string;
    renameList: string;
    newList: string;
    connected: string;
    disconnected: string;
    allSynced: string;
    pendingChanges: string;
    lastSynced: (rel: string) => string;
    opLabel: (n: string) => string;
    itemsListsCount: (items: number, lists: number) => string;
    undo: string;
    redo: string;
    settings: string;
    website: string;
    logOut: string;
    export: string;
    exportBackup: string;
    exportJson: string;
    exportFailed: string;
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
    general: string;
    account: string;
    devices: string;
    language: string;
    languageSpanish: string;
    languageEnglish: string;
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
    secondsAgo: (n: number) => string;
    minutesAgo: (n: number) => string;
    hoursAgo: (n: number) => string;
    yesterdayAt: (time: string) => string;
    daysAgo: (n: number) => string;
  };
};

const messagesByLanguage: Record<AppLanguage, Messages> = {
  es: {
    common: {
      loading: "Cargando…",
      add: "Añadir",
      addItem: "Añadir elemento",
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
      home: "Inicio",
      done: "Hecho",
      bin: "Papelera",
      deleteList: "Eliminar",
      renameList: "Renombrar",
      newList: "+ Nueva lista",
      connected: "Conectado",
      disconnected: "Desconectado",
      allSynced: "Todo sincronizado",
      pendingChanges: "Cambios pendientes",
      lastSynced: (rel) => `Sincronizado ${rel}`,
      opLabel: (n) => `op #${n}`,
      itemsListsCount: (items, lists) =>
        `${items} elemento${items === 1 ? "" : "s"}, ${lists} lista${lists === 1 ? "" : "s"}`,
      undo: "Deshacer",
      redo: "Rehacer",
      settings: "Ajustes",
      website: "Sitio web de Airday",
      logOut: "Cerrar sesión",
      export: "Exportar",
      exportBackup: "Copia de seguridad (.bin)",
      exportJson: "JSON (.json)",
      exportFailed: "No se pudo exportar la copia de seguridad",
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
      general: "General",
      account: "Cuenta",
      devices: "Dispositivos",
      language: "Idioma",
      languageSpanish: "Español",
      languageEnglish: "English",
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
      secondsAgo: (n) => `hace ${n} s`,
      minutesAgo: (n) => `hace ${n} min`,
      hoursAgo: (n) => `hace ${n} h`,
      yesterdayAt: (time) => `Ayer ${time}`,
      daysAgo: (n) => `hace ${n} día${n === 1 ? "" : "s"}`,
    },
  },
  en: {
    common: {
      loading: "Loading…",
      add: "Add",
      addItem: "Add item",
      close: "Close",
      menu: "Menu",
      copy: "Copy",
      delete: "Delete",
      restore: "Restore",
    },
    auth: {
      signIn: "Sign in",
      signUp: "Sign up",
      email: "Email",
      password: "Password",
      derivingKeys: "Deriving keys…",
      noAccount: "Don't have an account? Sign up",
      haveAccount: "Have an account? Sign in",
      serverMissingDeviceCredential: "server did not return a device credential",
    },
    nav: {
      home: "Home",
      done: "Done",
      bin: "Bin",
      deleteList: "Delete",
      renameList: "Rename",
      newList: "+ New list",
      connected: "Connected",
      disconnected: "Disconnected",
      allSynced: "All synced",
      pendingChanges: "Pending changes",
      lastSynced: (rel) => `Synced ${rel}`,
      opLabel: (n) => `op #${n}`,
      itemsListsCount: (items, lists) =>
        `${items} item${items === 1 ? "" : "s"}, ${lists} list${lists === 1 ? "" : "s"}`,
      undo: "Undo",
      redo: "Redo",
      settings: "Settings",
      website: "Airday website",
      logOut: "Log out",
      export: "Export",
      exportBackup: "Backup (.bin)",
      exportJson: "JSON (.json)",
      exportFailed: "Could not export backup",
    },
    workspace: {
      emptyBin: "Empty bin",
      createWithSpace: "Press Space to create a new item",
      emptyState: "Nothing here yet.",
      notes: "Notes",
      markDone: "Mark as done",
      markNotDone: "Mark as not done",
      duplicate: "Duplicate",
      moveToBin: "Move to bin",
    },
    find: {
      placeholder: "Find",
      listBadge: "List",
      itemBadge: "Item",
      noMatches: "No matches",
      typeToFind: "Type to find",
    },
    settings: {
      general: "General",
      account: "Account",
      devices: "Devices",
      language: "Language",
      languageSpanish: "Español",
      languageEnglish: "English",
      theme: "Theme",
      auto: "Auto",
      light: "Light",
      dark: "Dark",
      localOnlyAccount:
        "You're using a local-only account. Use Sign in or Sign up from the account menu to back up your data and sync across devices.",
      loginToSeeDevices: "Log in to see devices linked to your account.",
      email: "Email",
      thisDevice: "This device",
      lastSeen: "Last seen",
      revoke: "Revoke",
      revoking: "Revoking…",
      failedToRevokeDevice: "Failed to revoke device",
      failedToLoadDevices: "Failed to load devices",
    },
    relative: {
      justNow: "just now",
      secondsAgo: (n) => `${n}s ago`,
      minutesAgo: (n) => `${n}m ago`,
      hoursAgo: (n) => `${n}h ago`,
      yesterdayAt: (time) => `Yesterday ${time}`,
      daysAgo: (n) => `${n} day${n === 1 ? "" : "s"} ago`,
    },
  },
};

type AppI18nContextValue = {
  language: Accessor<AppLanguage>;
  setLanguage: (language: AppLanguage) => void;
  localeCode: Accessor<string>;
  messages: Accessor<Messages>;
};

const AppI18nContext = createContext<AppI18nContextValue>();

export function AppI18nProvider(props: { children: JSX.Element }) {
  const [language, setLanguageSignal] = createSignal<AppLanguage>(readLanguage());
  const localeCode = createMemo(() => localeByLanguage[language()]);
  const messages = createMemo(() => messagesByLanguage[language()]);

  const setLanguage = (language: AppLanguage) => {
    setLanguageSignal(language);
    writeLanguage(language);
  };

  return (
    <AppI18nContext.Provider
      value={{
        language,
        setLanguage,
        localeCode,
        messages,
      }}
    >
      <KobalteI18nProvider locale={localeCode()}>
        {props.children}
      </KobalteI18nProvider>
    </AppI18nContext.Provider>
  );
}

export function useAppI18n(): {
  m: Accessor<Messages>;
  language: Accessor<AppLanguage>;
  setLanguage: (language: AppLanguage) => void;
  locale: Accessor<string>;
  direction: Accessor<"ltr" | "rtl">;
} {
  const ctx = useContext(AppI18nContext);
  if (!ctx) throw new Error("missing AppI18nProvider");
  const { locale, direction } = useLocale();
  return {
    m: ctx.messages,
    language: ctx.language,
    setLanguage: ctx.setLanguage,
    locale,
    direction,
  };
}
