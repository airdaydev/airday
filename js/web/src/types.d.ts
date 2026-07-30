declare module "*.svg?raw" {
  const content: string;
  export default content;
}

declare module "*.png" {
  const url: string;
  export default url;
}

/* Vite emits the target as a content-hashed asset and resolves the import to
   its URL, rather than inlining the file into a JS chunk. Used for the
   vendored emoji dataset — see `emoji/data.ts` for why. */
declare module "*.json?url" {
  const url: string;
  export default url;
}
