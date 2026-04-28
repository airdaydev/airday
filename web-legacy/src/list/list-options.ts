import { createContext, createSignal, Signal } from "solid-js";

interface ListCtx {
  columnHeaders: Signal<boolean>;
}

const defaultListOptions = {
  columnHeaders: false,
  columns: ["check", "content", "sticker"],
  historical: false,
};

export interface ListOptions {
  columnHeaders: boolean;
  columns: string[];
  historical: boolean;
}

export const listOptions = (opts: Partial<ListOptions> = {}) => {
  const resolvedOpts = Object.assign({}, defaultListOptions, opts);
  return {
    columnHeaders: createSignal(resolvedOpts.columnHeaders),
    columns: createSignal(resolvedOpts.columns),
    historical: opts.historical,
  };
};

export const ListOptionsContext = createContext<ListCtx>(listOptions());
