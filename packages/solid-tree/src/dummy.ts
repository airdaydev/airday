interface DummyTreeOpts {
  idFunction: (path: number[]) => string;
  maxDepth: number;
  maxChildren: number;
  _path: number[];
}

const defaults: DummyTreeOpts = {
  idFunction: (path) => path.join('.'),
  maxDepth: 3,
  maxChildren: 50,
  _path: [],
}

export function dummyTree(opts?: Partial<DummyTreeOpts>) {
  let internalOpts: DummyTreeOpts = {
    ...defaults,
    ...opts,
  }
  let seed = Math.random();
  const node = { id: internalOpts.idFunction(internalOpts._path) || 'root', children: [] };
  if (internalOpts.maxDepth > 0) {
    for (let i = 0; i < seed * internalOpts.maxChildren; i++) {
      let path = [...internalOpts._path, i];
      const child = dummyTree({
        idFunction: internalOpts.idFunction,
        maxDepth: internalOpts.maxDepth - 1,
        _path: path,
      });
      node.children.push(child);
    }
  }
  return node;
}
