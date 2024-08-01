import {
  Signal, createMemo, createSignal, createUniqueId,
} from 'solid-js';
import { qperf } from './utils';
import { DndContext } from './dnd-context';
import { GenericNode, map, walk, filter } from './tree-utils';

export interface NodeSignalProps {
  id: string;
}

export class Node {
  id: string;
  children?: Node[] = [];
  isRoot = false;
  depth = 0; // cached
  expanded = true;
  parent?: Node;
  root?: TreeState;
  uiSignal?: Signal<NodeSignalProps> | undefined;
  signalSubscriptions = 0;
  constructor(node?: GenericNode<any>) {
    this.id = node?.id || createUniqueId();
  }
  get accessor() {
    if (!this.uiSignal) this.uiSignal = createSignal(this.toJSON());
    this.signalSubscriptions++;
    return this.uiSignal[0];
  }
  unsubscribe() {
    this.signalSubscriptions--;
    if (this.signalSubscriptions === 0) {
      delete this.uiSignal;
    }
  }
  toJSON() {
    return {
      ...(this.serialise && this.serialise()),
      id: this.id,
    }
  }
  triggerUpdate() {
    this.uiSignal?.[1](() => this.toJSON());
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
}

interface TreeStateOpts {
  mutate?: boolean;
  loader?: (node: GenericNode<any>) => Node;
  dndContext?: DndContext;
}

export class TreeState {
  id: string;
  isRoot = true;
  childrenSignal = createSignal<Node[]>([]);
  idMap = new Map<string, Node>;
  mutate = false;
  maxDepth = 10;
  expanded = true;
  loader?: (node: GenericNode<any>) => Node;
  constructor(opts: TreeStateOpts = {}) {
    this.id = createUniqueId();
    this.loader = opts.loader;
  }
  get mutableRoot() {
    return { isRoot: true, children: this.childrenSignal[0]() }
  }
  delete(set: Set<Node>) {
    if (!set.size) return;
    if (this.mutate === false) {
      const filtered = filter<any>(this.mutableRoot, (node) => {
        return !set.has(node);
      }).children;
      this.childrenSignal[1](() => filtered);
    }
  }
  load(tree: GenericNode<any>) {
    const q = qperf('load');
    const children = map<any, any>(
      tree,
      (rawNode, parent) => {
        const node = this.loader ? this.loader(rawNode) : new Node(rawNode);
        node.root = this;
        node.parent = parent;
        // TODO: calc depth or level for display purposes
        this.idMap.set(node.id, node);
        return node;
      },
      this).children;
    this.childrenSignal[1](() => children);
    q();
  }
  count(expandedOnly?: boolean) {
    return createMemo(() => {
      let count = 0;
      walk({ isRoot: true, children: this.childrenSignal[0]() }, (node) => {
        count++;
        if (expandedOnly && !node.expanded) return true;
        return false;
      }, undefined);
      return count - 1; // accounts for root node
    });
  }
}

