interface DummyTreeOpts {
  idFunction: (path: number[]) => string;
  maxDepth: number;
  maxChildren: number;
  _path: number[];
}

const frutas = [
  "manzana",
  "plátano",
  "naranja",
  "fresa",
  "sandía",
  "piña",
  "mango",
  "papaya",
  "kiwi",
  "pera",
  "durazno",
  "cereza",
  "uva",
  "melón",
  "frambuesa",
  "mora",
  "arándano",
  "guayaba",
  "maracuyá",
  "coco",
];

function elegirFruta() {
  const seed = Math.floor(Math.random() * frutas.length);
  return frutas[seed];
}

const defaults: DummyTreeOpts = {
  idFunction: (path) => path.join("."),
  maxDepth: 3,
  maxChildren: 20,
  _path: [],
};

export function dummyChildren(opts?: Partial<DummyTreeOpts>) {
  let internalOpts: DummyTreeOpts = {
    ...defaults,
    ...opts,
  };
  function generateNodes(opts: DummyTreeOpts) {
    let seed = Math.random();
    const nodes = [];
    for (let i = 0; i < Math.ceil(seed * internalOpts.maxChildren); i++) {
      const node = {
        id: internalOpts.idFunction(internalOpts._path),
        content: elegirFruta(),
        children: [] as any[],
      };
      let path = [...internalOpts._path, i];
      if (opts.maxDepth > 1) {
        const children = generateNodes({
          idFunction: internalOpts.idFunction,
          maxChildren: internalOpts.maxChildren,
          maxDepth: opts.maxDepth - 1,
          _path: path,
        });
        node.children = children;
      }
      nodes.push(node);
    }
    return nodes;
  }
  return generateNodes(internalOpts);
}
