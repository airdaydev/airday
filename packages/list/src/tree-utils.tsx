export interface GenericNode<T extends GenericNode<any | undefined>> {
  children?: T[];
}

export function map<T extends GenericNode<any>, O extends GenericNode<any>>(
  node: T, func: (node: T, parent?: O) => O, parent?: O,
) {
  const modified = func(node, parent);
  modified.children = node.children?.map((child) =>
    map(child, func, modified));
  return modified;
}

export function walk<T extends GenericNode<any>, O extends GenericNode<any>>(
  node: T, func: (node: T, parent?: O) => boolean | void, parent?: O,
) {
  const skipChildren = func(node, parent);
  if (skipChildren) return;
  node.children?.map((child) => walk(child, func, parent));
}

export function filter<T extends GenericNode<any>>(node: T, filterFunc: (tree: T) => boolean): T {
  if (node.children) {
    const filtered = node.children.filter(filterFunc);
    const filterRecursive = filtered.map((child) => filter(child, filterFunc));
    node.children = filterRecursive;
    return node;
  }
  return node;
}
