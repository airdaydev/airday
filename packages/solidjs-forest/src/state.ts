import {
  Signal, createSignal, createUniqueId,
} from 'solid-js';
import { qperf } from './utils';
import { DndContext } from './dnd-context';
import { GenericNode, map, walk, filter } from './tree-utils';

export interface NodeSignalProps {
  id: string;
  isSelected: boolean;
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
      isSelected: this.isSelected,
    }
  }
  triggerUpdate() {
    this.uiSignal?.[1](() => this.toJSON());
  }
  get isSelected() {
    return this.root?.selection.has(this);
  }
  select(recursive?: boolean, additive?: boolean) {
    this.root.selectOne(this);
  }
  deselect() {
    this.root.deselect(this);
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
  onSelectionChange?: (node: Set<Node>) => void;
  loader?: (node: GenericNode<any>) => Node;
  dndContext?: DndContext;
}

// Combined tree -> Window tree (UI)
// TODO: Rename this as Store, considering it has no children object therefore is not a root node
export class TreeState {
  id: string;
  isRoot = true;
  childrenSignal = createSignal<Node[]>([]);
  idMap = new Map<string, Node>;
  mutate = false;
  selection = new Set<Node>;
  maxDepth = 10;
  expanded = true;
  loader?: (node: GenericNode<any>) => Node;
  onSelectionChange?: (node: Set<Node>) => void;
  constructor(opts: TreeStateOpts = {}) {
    this.id = createUniqueId();
    this.onSelectionChange = opts.onSelectionChange;
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
    set.forEach((node) => {
      this.selection.delete(node);
      node.deselect();
    });
  }
  selectOne(node: Node) {
    this.selection.forEach((node) => {
      this.selection.delete(node);
      node.triggerUpdate();
    });
    this.selection.add(node);
    node.triggerUpdate();
    if (this.onSelectionChange) this.onSelectionChange(this.selection);
  }
  deselect(node: Node) {
    // deselect
    if (this.onSelectionChange) this.onSelectionChange(this.selection);
  }
  deselectAll() {
    this.selection.forEach((node) => node.deselect());
    this.selection.clear();
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
  // TODO: memoise
  // TODO: cache for each node
  count(expandedOnly?: boolean) {
    let count = 0;
    walk(this.mutableRoot, (node) => {
      count++;
      if (expandedOnly && !node.expanded) return true;
      return false;
    }, undefined);
    return count;
  }
}
