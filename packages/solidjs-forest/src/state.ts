import {
  Signal, createSignal, createUniqueId, createMemo, Accessor,
} from 'solid-js';
import { qperf } from './utils';

export interface GenericNode<T extends GenericNode<any | undefined>> {
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
  isSelected = false;
  depth = 0; // cached
  expanded = true;
  parent?: Node;
  root?: RootNode;
  signal?: Signal<NodeSignalProps> | undefined;
  signalSubscriptions = 0;
  constructor(id?: string) {
    this.id = id || createUniqueId();
  }
  getNodeSignal() {
    if (!this.signal) this.signal = createSignal(this.toJSON());
    this.signalSubscriptions++;
    return this.signal[0];
  }
  unsubscribe() {
    this.signalSubscriptions--;
    if (this.signalSubscriptions === 0) {
      delete this.signal;
    }
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
    this.root?.selection.add(this);
    this.root?.onSelect(this.root.selection);
  }
  deselect() {
    this.isSelected = false;
    this.signal?.[1](() => this.toJSON());
    this.root?.selection.delete(this);
    this.root?.onSelect(this.root.selection);
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

interface RootNodeOpts {
  mutate?: boolean;
  onSelect?: (node: Set<Node>) => void;
}

// Combined tree -> Window tree (UI)
export class RootNode extends Node {
  isRoot = true;
  childrenSignal = createSignal<Node[]>([]);
  idMap = new Map<string, Node>;
  mutate = false;
  selection = new Set<Node>;
  signalIsDragging = createSignal(false);
  maxDepth = 10;
  expanded = true;
  animationMs = 50; // Set to 0 for no animation
  onSelect?: (node: Set<Node>) => void;
  constructor(opts: RootNodeOpts = {}) {
    super(createUniqueId());
    this.onSelect = opts.onSelect;
  }
  derivativeSet() {
    return createMemo(() => {

    });  
  }
  // TODO: Params e.g. start index, container height etc
  // Per instance, downstream signal
  getWindowedSignal(element: HTMLElement) {
    // scrolloffset * heights, so we need a cached count of all items or filtered items,
    // - dragged items - collapsed items
    // Dragged items are replaced with a diminishing block,
    // Deleting items???????
    // But the block cannot factor into the window calculation, the window is the end result
    
    // const totalHeight = visibleChildren.length * 22.2;
    // calculate & cache heights, filtering out contiguous blocks removed
    // if scrolloffset > total height, move scroll loc to Math.min(0, scrollOffset - containerHeight)
    // otherwise first index = scrolloffset - totalHeight/rowHeight
    // pull front padding + content (windows size should be bigger than needed in both directions if possible) + end padding
    // listen for scroll & resize events on container
    // Cache if possible to optimise
    return createMemo(() => {
      const visibleChildren: Node[] = [];
      let n = new Node();
      n.isRoot = true;
      n.children = this.childrenSignal[0]();
      const end = qperf('memo');
      walk<Node, Node>(n, (node) => {
        if (!node.isRoot && !(this.signalIsDragging[0]() && !node.isSelected)) {
          visibleChildren.push(node);
        }
        if (!node.expanded) return true;
      });
      end();
      let window = visibleChildren.slice(0, 100);
      return window;
    });
    // Animation notes:
    // We don't make the placeholder a genuine item
    // Maybe: Every item has the possibility of becoming a placeholder
    // Or: We insert the placeholder as needed (hmm?)
    // If the item is dragged below the current item on another item, that item is translated up
    // If the item is dragged above the current item on another item, that item is translated down
    // This has a small effect on the window that may need to be taken into account
    // i.e. is the placeholder present & where is it
  }
  delete(set: Set<Node>) {
    if (!set.size) return;
    if (this.mutate === false) {
      const filtered = filter<any>(this, (node) => {
        return !set.has(node);
      }).children;
      this.childrenSignal[1](() => filtered);
    }
    set.forEach((node) => {
      this.selection.delete(node);
      node.deselect();
    });
  }
  load(tree: GenericNode<any>) {
    const q = qperf('load');
    this.children = map<any, any>(
      tree,
      (rawNode, parent) => {
        const node = new Node(rawNode.id);
        node.root = this;
        node.parent = parent;
        // TODO: calc depth or level for display purposes
        this.idMap.set(node.id, node);
        return node;
      },
      this).children;
    this.childrenSignal[1](() => this.children);
    q();
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
