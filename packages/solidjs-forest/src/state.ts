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
  dragOriginNode: boolean;
}

export class Node {
  id: string;
  children?: Node[] = [];
  isRoot = false;
  depth = 0; // cached
  expanded = true;
  parent?: Node;
  root?: RootNode;
  uiSignal?: Signal<NodeSignalProps> | undefined;
  signalSubscriptions = 0;
  dragOriginNode = false;
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
      dragOriginNode: this.dragOriginNode,
    }
  }
  triggerUpdate() {
    this.uiSignal?.[1](() => this.toJSON());
  }
  get isSelected() {
    return this.root?.selection.has(this);
  }
  setDragOriginState(isOrigin = true) {
    this.dragOriginNode = isOrigin;
    this.triggerUpdate();
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

interface RootNodeOpts {
  mutate?: boolean;
  onSelectionChange?: (node: Set<Node>) => void;
  loader?: (node: GenericNode<any>) => Node;
}

// Combined tree -> Window tree (UI)
// TODO: Rename this as Store, considering it has no children object therefore is not a root node
export class RootNode {
  id: string;
  isRoot = true;
  childrenSignal = createSignal<Node[]>([]);
  idMap = new Map<string, Node>;
  mutate = false;
  selection = new Set<Node>;
  dragSignal = createSignal(false);
  dragEl: HTMLElement | undefined;
  maxDepth = 10;
  expanded = true;
  dragOriginNode: Node | undefined; // The actual node that the user clicked on
  dragOriginNodeIndex: number | undefined;
  dragLastTouched = createSignal<number | undefined>();
  animationMs = 50; // Set to 0 for no animation
  loader?: (node: GenericNode<any>) => Node;
  onSelectionChange?: (node: Set<Node>) => void;
  constructor(opts: RootNodeOpts = {}) {
    this.id = createUniqueId();
    this.onSelectionChange = opts.onSelectionChange;
    this.loader = opts.loader;
  }
  get mutableRoot() {
    return { isRoot: true, children: this.childrenSignal[0]() }
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
      let index = 0;
      walk<Node, Node>(n, (node) => {
        // Keeping the node that user actually dragged in place
        const dragOriginNode = node === this.dragOriginNode;
        if (dragOriginNode) { // unset on drag end...?
          this.dragOriginNodeIndex = index;
          index++; 
        }
        if (!node.isRoot && !(this.dragSignal[0]() && node.isSelected && !dragOriginNode)) {
          index++;
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
  setDragLastTouchedIndex(nodeIndex: number | undefined) {
    this.dragLastTouched[1](nodeIndex);
  }
  startDrag(dragOriginNode: Node, ref: HTMLElement) {
    this.dragEl = ref.cloneNode(true);
    this.dragOriginNode = dragOriginNode;
    dragOriginNode.setDragOriginState(true)
    this.dragSignal[1](true);
  }
  stopDrag() {
    this.setDragLastTouchedIndex(undefined);
    this.dragOriginNode?.setDragOriginState(false)
    this.dragOriginNode = undefined;
    this.dragSignal[1](false);
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
