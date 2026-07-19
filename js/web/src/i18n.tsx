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
    close: string;
    menu: string;
    copy: string;
    delete: string;
    restore: string;
    cancel: string;
    confirm: string;
    open: string;
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
    inbox: string;
    focus: string;
    done: string;
    bin: string;
    deleteList: string;
    deleteListConfirm: (name: string) => string;
    renameList: string;
    newList: string;
    connected: string;
    disconnected: string;
    offline: string;
    synced: string;
    syncing: string;
    lastSynced: (rel: string) => string;
    seqLabel: (n: string) => string;
    itemsListsCount: (items: number, lists: number) => string;
    undo: string;
    redo: string;
    settings: string;
    website: string;
    logOut: string;
    exportJson: string;
    exportFailed: string;
    importJson: string;
    importSucceeded: (items: number, lists: number) => string;
    importFailed: string;
  };
  workspace: {
    emptyBin: string;
    emptyBinConfirm: string;
    createWithSpace: string;
    emptyState: string;
    notes: string;
    hasNotes: string;
    markDone: string;
    markNotDone: string;
    duplicate: string;
    moveToBin: string;
    moveToList: string;
    /** Accessible name for the Done view's display-options popover trigger. */
    doneOptions: string;
    /** Switch label (Done options popover) toggling the origin-list badge. */
    showDoneList: string;
    /** Done-view header button that opens the modal to record a completed
     *  item directly (defaults to Inbox). */
    log: string;
    /** Title-field placeholder / indicator shown when the creation modal is
     *  logging an already-completed item. */
    logCompleted: string;
    /** Accessible name for the list-icon picker trigger in the header. */
    listIcon: string;
    /** Label for the button that clears a list's custom icon. */
    removeIcon: string;
    /** Placeholder for the free-form emoji input in the icon picker. */
    iconInputPlaceholder: string;
  };
  board: {
    viewAsBoard: string;
    viewAsList: string;
    /** Header labels for the three fixed board lanes (spec/board.md). */
    backlogLane: string;
    liveLane: string;
    doneLane: string;
    addItem: string;
    /** Accessible name for the list/board view-mode segmented control. */
    viewMode: string;
    /** Short segment labels for that control. */
    list: string;
    board: string;
    /** Switch label (view-mode popover) toggling the Done lane on/off. */
    showDoneColumn: string;
  };
  due: {
    /** Section label / accessible name for the due-date control. */
    label: string;
    /** Badge label when the due date is before today. */
    overdue: string;
    /** Badge + quick-action label for today's date. */
    today: string;
    /** Badge + quick-action label for tomorrow's date. */
    tomorrow: string;
    /** Quick action that removes the due date. */
    clear: string;
    /** Context-menu action that removes the due date. */
    remove: string;
    /** Context-menu action that opens the calendar to pick a date. */
    setDate: string;
    /** Title of the calendar modal. */
    dialogTitle: string;
    /** Accessible label for the calendar's previous-month button. */
    prevMonth: string;
    /** Accessible label for the calendar's next-month button. */
    nextMonth: string;
  };
  order: {
    /** Submenu label for the item-ordering actions. */
    label: string;
    /** Move the target item(s) to the top of the list. */
    moveToTop: string;
    /** Move the target item(s) to the bottom of the list. */
    moveToBottom: string;
  };
  shortcuts: {
    title: string;
    newItem: string;
    editItem: string;
    openItem: string;
    toggleDone: string;
    toggleFocus: string;
    duplicate: string;
    copy: string;
    undo: string;
    redo: string;
    bin: string;
    switchList: string;
    switchLane: string;
    find: string;
    showShortcuts: string;
  };
  find: {
    placeholder: string;
    noMatches: string;
    typeToFind: string;
  };
  focus: {
    /** Add-to-focus context-menu action. */
    add: string;
    /** Remove-from-focus × affordance / context menu. */
    remove: string;
    /** Static Focus-membership badge shown on pinned list rows. */
    badge: string;
    /** Flat Focus view lifecycle toggles (no lanes — spec/focus.md). */
    markLive: string;
    markBacklog: string;
    /** Empty-state hint shown when the Focus lens has no visible refs. */
    empty: string;
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
    showListCounts: string;
    localOnlyAccount: string;
    loginToSeeDevices: string;
    email: string;
    thisDevice: string;
    lastSeen: string;
    deviceActions: string;
    renameDevice: string;
    revoke: string;
    revoking: string;
    revokeDeviceConfirm: (name: string) => string;
    failedToRenameDevice: string;
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
      close: "Cerrar",
      menu: "Menú",
      copy: "Copiar",
      delete: "Eliminar",
      restore: "Restaurar",
      cancel: "Cancelar",
      confirm: "Confirmar",
      open: "Abrir",
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
      inbox: "Bandeja de entrada",
      focus: "Enfoque",
      done: "Hecho",
      bin: "Papelera",
      deleteList: "Eliminar",
      deleteListConfirm: (name) =>
        `¿Eliminar «${name}»? Sus elementos se moverán a la papelera.`,
      renameList: "Renombrar",
      newList: "+ Nueva lista",
      connected: "Conectado",
      disconnected: "Desconectado",
      offline: "Sin conexión",
      synced: "Sincronizado",
      syncing: "Sincronizando",
      lastSynced: (rel) => `Sincronizado ${rel}`,
      seqLabel: (n) => `seq #${n}`,
      itemsListsCount: (items, lists) =>
        `${items} elemento${items === 1 ? "" : "s"}, ${lists} lista${lists === 1 ? "" : "s"}`,
      undo: "Deshacer",
      redo: "Rehacer",
      settings: "Ajustes",
      website: "Sitio web de Airday",
      logOut: "Cerrar sesión",
      exportJson: "Exportar JSON",
      exportFailed: "No se pudo exportar",
      importJson: "Importar JSON",
      importSucceeded: (items, lists) =>
        `Importado: ${items} elemento${items === 1 ? "" : "s"}, ${lists} lista${lists === 1 ? "" : "s"}`,
      importFailed: "No se pudo importar el archivo",
    },
    workspace: {
      emptyBin: "Vaciar papelera",
      emptyBinConfirm: "¿Seguro que quieres borrar permanentemente los elementos de la papelera?",
      createWithSpace: "Pulsa Espacio para crear un elemento nuevo",
      emptyState: "Todavía no hay nada.",
      notes: "Notas",
      hasNotes: "Tiene notas",
      markDone: "Marcar como hecho",
      markNotDone: "Marcar como no hecho",
      duplicate: "Duplicar",
      moveToBin: "Mover a la papelera",
      moveToList: "Mover a la lista",
      doneOptions: "Opciones de visualización",
      showDoneList: "Mostrar lista",
      log: "Registrar",
      logCompleted: "Registrar elemento completado",
      listIcon: "Icono de la lista",
      removeIcon: "Quitar icono",
      iconInputPlaceholder: "Emoji",
    },
    board: {
      viewAsBoard: "Vista de tablero",
      viewAsList: "Vista de lista",
      backlogLane: "Pendiente",
      liveLane: "En curso",
      doneLane: "Hecho",
      addItem: "Añadir elemento",
      viewMode: "Modo de vista",
      list: "Lista",
      board: "Tablero",
      showDoneColumn: "Carril Hecho",
    },
    due: {
      label: "Fecha de vencimiento",
      overdue: "Vencido",
      today: "Hoy",
      tomorrow: "Mañana",
      clear: "Borrar",
      remove: "Quitar fecha",
      setDate: "Elegir fecha…",
      dialogTitle: "Establecer fecha de vencimiento",
      prevMonth: "Mes anterior",
      nextMonth: "Mes siguiente",
    },
    order: {
      label: "Ordenar",
      moveToTop: "Mover al principio",
      moveToBottom: "Mover al final",
    },
    shortcuts: {
      title: "Atajos de teclado",
      newItem: "Nuevo elemento",
      editItem: "Editar elemento",
      openItem: "Abrir elemento",
      toggleDone: "Marcar como hecho",
      toggleFocus: "Añadir o quitar de Enfoque",
      duplicate: "Duplicar",
      copy: "Copiar",
      undo: "Deshacer",
      redo: "Rehacer",
      bin: "Mover a la papelera",
      switchList: "Cambiar de vista",
      switchLane: "Cambiar de carril",
      find: "Buscar",
      showShortcuts: "Mostrar atajos",
    },
    find: {
      placeholder: "Buscar",
      noMatches: "Sin resultados",
      typeToFind: "Escribe para buscar",
    },
    focus: {
      add: "Enfoque",
      remove: "Quitar de Enfoque",
      badge: "Enfoque",
      markLive: "Marcar en curso",
      markBacklog: "Marcar como pendiente",
      empty:
        "Enfoque está vacío. Añade un elemento nuevo aquí, o haz clic derecho en uno existente y elige «Añadir a Enfoque», para organizar en qué estás trabajando.",
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
      showListCounts: "Mostrar contadores de listas",
      localOnlyAccount:
        "Estás usando una cuenta solo local. Usa Iniciar sesión o Crear cuenta desde el menú de la cuenta para hacer copia de seguridad de tus datos y sincronizar entre dispositivos.",
      loginToSeeDevices: "Inicia sesión para ver los dispositivos vinculados a tu cuenta.",
      email: "Correo",
      thisDevice: "Este dispositivo",
      lastSeen: "Última vez visto",
      deviceActions: "Acciones del dispositivo",
      renameDevice: "Renombrar",
      revoke: "Revocar",
      revoking: "Revocando…",
      revokeDeviceConfirm: (name) =>
        `¿Revocar «${name}»? Tendrá que volver a iniciar sesión para sincronizar.`,
      failedToRenameDevice: "No se pudo renombrar el dispositivo",
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
      close: "Close",
      menu: "Menu",
      copy: "Copy",
      delete: "Delete",
      restore: "Restore",
      cancel: "Cancel",
      confirm: "Confirm",
      open: "Open",
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
      inbox: "Inbox",
      focus: "Focus",
      done: "Done",
      bin: "Bin",
      deleteList: "Delete",
      deleteListConfirm: (name) =>
        `Delete “${name}”? Its items will be moved to the bin.`,
      renameList: "Rename",
      newList: "+ Add list",
      connected: "Connected",
      disconnected: "Disconnected",
      offline: "Offline",
      synced: "Synced",
      syncing: "Syncing",
      lastSynced: (rel) => `Synced ${rel}`,
      seqLabel: (n) => `seq #${n}`,
      itemsListsCount: (items, lists) =>
        `${items} item${items === 1 ? "" : "s"}, ${lists} list${lists === 1 ? "" : "s"}`,
      undo: "Undo",
      redo: "Redo",
      settings: "Settings",
      website: "Airday website",
      logOut: "Log out",
      exportJson: "Export JSON",
      exportFailed: "Could not export",
      importJson: "Import JSON",
      importSucceeded: (items, lists) =>
        `Imported ${items} item${items === 1 ? "" : "s"}, ${lists} list${lists === 1 ? "" : "s"}`,
      importFailed: "Could not import file",
    },
    workspace: {
      emptyBin: "Empty",
      emptyBinConfirm: "Are you sure you want to permanently erase items in the bin?",
      createWithSpace: "Press Space to create a new item",
      emptyState: "Nothing here yet.",
      notes: "Notes",
      hasNotes: "Has notes",
      markDone: "Mark as done",
      markNotDone: "Mark as not done",
      duplicate: "Duplicate",
      moveToBin: "Move to bin",
      moveToList: "Move to list",
      doneOptions: "Display options",
      showDoneList: "Show list",
      log: "Log",
      logCompleted: "Log completed item",
      listIcon: "List icon",
      removeIcon: "Remove icon",
      iconInputPlaceholder: "Emoji",
    },
    board: {
      viewAsBoard: "Board view",
      viewAsList: "List view",
      backlogLane: "Backlog",
      liveLane: "In progress",
      doneLane: "Done",
      addItem: "Add item",
      viewMode: "View mode",
      list: "List",
      board: "Board",
      showDoneColumn: "Done lane",
    },
    due: {
      label: "Due date",
      overdue: "Overdue",
      today: "Today",
      tomorrow: "Tomorrow",
      clear: "Clear",
      remove: "Remove date",
      setDate: "Set date…",
      dialogTitle: "Set due date",
      prevMonth: "Previous month",
      nextMonth: "Next month",
    },
    order: {
      label: "Order",
      moveToTop: "Move to top",
      moveToBottom: "Move to bottom",
    },
    shortcuts: {
      title: "Keyboard shortcuts",
      newItem: "New item",
      editItem: "Edit item",
      openItem: "Open item",
      toggleDone: "Toggle done",
      toggleFocus: "Toggle focus",
      duplicate: "Duplicate",
      copy: "Copy",
      undo: "Undo",
      redo: "Redo",
      bin: "Move to bin",
      switchList: "Switch view",
      switchLane: "Switch lane",
      find: "Find",
      showShortcuts: "Show shortcuts",
    },
    find: {
      placeholder: "Find",
      noMatches: "No matches",
      typeToFind: "Type to find",
    },
    focus: {
      add: "Focus",
      remove: "Remove from Focus",
      badge: "Focus",
      markLive: "Mark as in progress",
      markBacklog: "Mark as backlog",
      empty:
        "Nothing in Focus yet. Add a new item here, or right-click an existing one and choose “Add to Focus”, to line up what you're working on.",
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
      showListCounts: "Show list counts",
      localOnlyAccount:
        "You're using a local-only account. Use Sign in or Sign up from the account menu to back up your data and sync across devices.",
      loginToSeeDevices: "Log in to see devices linked to your account.",
      email: "Email",
      thisDevice: "This device",
      lastSeen: "Last seen",
      deviceActions: "Device actions",
      renameDevice: "Rename",
      revoke: "Revoke",
      revoking: "Revoking…",
      revokeDeviceConfirm: (name) =>
        `Revoke “${name}”? It will need to sign in again to sync.`,
      failedToRenameDevice: "Failed to rename device",
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
