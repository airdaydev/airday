import { Signal, createSignal, createUniqueId } from 'solid-js';

interface GenericNode<T extends GenericNode<any | undefined>> {
  children?: T[];
}

export interface NodeSignalProps {
  id: string;
  isSelected: boolean;
}

export class Node {
  id: string;
  children?: Node[] = [];
  isRoot = false;
  isSelected= false;
  depth = 0; // cached
  expanded = true;
  parent?: Node;
  root?: RootNode;
  signal?: Signal<NodeSignalProps> | undefined;
  signalSubscriptions = 0;
  constructor(id?: string) {
    this.id = id || createUniqueId();
  }
  getSignal() {
    if (!this.signal) this.signal = createSignal(this.toJSON());
    this.signalSubscriptions++;
    return this.signal[0];
  }
  unsubscribe() {

  }
  toJSON() {
    return {
      id: this.id,
      isSelected: this.isSelected,
    }
  }
  select(recursive?: boolean) {
    this.isSelected = true;
    this.signal?.[1](() => this.toJSON());
  }
  deselect() {
    this.isSelected = false;
    this.signal?.[1](() => this.toJSON());
  }
  collapse(recursive = false) {
    this.expanded = false;
    if (recursive) {
      map<Node, Node>(this, (node) => {
        node.expanded = true;
        return node;
      });
    }
  }
  // TODO: memoise
  // TODO: cache for each node
  count(expandedOnly?: boolean) {
    let count = 0;
    walk(this, (node) => {
      count++;
      if (expandedOnly && !node.expanded) return true;
      return false;
    }, undefined);
    return count;
  }
}

export class RootNode extends Node {
  isRoot = true;
  children: Node[] = [];
  idMap = new Map<string, Node>;
  selection = new Set<Node>;
  constructor(id?: string) {
    super(id);
  }
  load(rawNodes: GenericNode<any>) {
    this.children = map<any, any>(
      rawNodes,
      (rawNode, parent) => {
        const node = new Node(rawNode.id);
        node.root = this;
        node.parent = parent;
        this.idMap.set(node.id, node);
        return node;
      },
      this).children;
  }
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
  const stop = func(node, parent);
  if (stop) return;
  node.children?.map((child) => walk(child, func, parent));
}
