import { Uuidv4 } from "./uuid";

interface LibraryConstructorOpts {
  id: Uuidv4;
  name: string;
  remote: boolean;
  primary: true;
}

export class Library {
  readonly id: Uuidv4 = new Uuidv4();
  name: string = "Primary";
  remote = false; // Has not been synced yet
  primary = true;
  constructor(opts?: LibraryConstructorOpts) {
    if (opts) {
      this.id = opts.id;
      this.name = opts.name;
      this.remote = opts.remote;
      this.primary = opts.primary;
    }
  }
}
