import { Uuidv4 } from "./uuid";

interface LibraryConstructorOpts {
  id?: Uuidv4;
  name?: string;
  remote?: boolean;
  primary?: boolean;
}

export class Library {
  readonly id: Uuidv4 = new Uuidv4();
  name: string = "Primary";
  remote = false; // Has not been synced yet
  primary = false;
  constructor(opts: LibraryConstructorOpts = {}) {
    if (opts.id) this.id = opts.id;
    if (opts.name) this.name = opts.name;
    if (opts.remote) this.remote = opts.remote;
    if (opts.primary) this.primary = opts.primary;
  }
}
