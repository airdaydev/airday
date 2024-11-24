import { Signal, createSignal, createUniqueId } from "solid-js";
import { GenericNode, map, walk, filter } from "./tree-utils";

export interface NodeSignalProps {
  id: string;
  expanded: boolean;
}

export class Node {
  id: string;
  children: Node[] = [];
  isRoot: boolean = false;
  depth = 0; // cached
  maxDepth = 5;
  expanded = false;
  parent: Node | null = null;
  root?: TreeState;
  uiSignal?: Signal<NodeSignalProps> | undefined;
  signalSubscriptions = 0;
  constructor(node?: GenericNode<any>) {
    this.id = node?.id || createUniqueId();
  }
  // TODO: Consider maintaining an index
  getIndex() {
    if (!this.root) throw new Error("node root not found");
    const index = this.root.childrenSignal[0]().findIndex(
      (node) => node === this,
    );
    return index < 0 ? 0 : index;
  }
  get accessor() {
    if (!this.uiSignal) this.uiSignal = createSignal(this.toJSON());
    this.signalSubscriptions++;
    return this.uiSignal[0];
  }
  get localIndex() {
    return this.parent?.children.findIndex((c) => c === this);
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
      depth: this.depth,
      expanded: this.expanded,
    };
  }
  triggerUpdate() {
    this.uiSignal?.[1](() => this.toJSON());
  }
  toggleExpansion() {
    if (this.expanded) this.collapse();
    else this.expand();
  }
  collapse(recursive = false) {
    this.expanded = false;
    if (recursive) {
      map<Node, Node>(this, (node) => {
        node.expanded = false;
        return node;
      });
    }
    this.triggerUpdate();
    this.root?.refresh();
  }
  expand(recursive = false) {
    this.expanded = true;
    if (recursive) {
      map<Node, Node>(this, (node) => {
        node.expanded = true;
        return node;
      });
    }
    this.triggerUpdate();
    this.root?.refresh();
  }
  setDepth(depth: number = 1) {
    this.depth = depth;
    map<Node, Node>(this, (node, _, intDepth) => {
      node.depth = depth + intDepth;
      node.triggerUpdate();
      return node;
    });
  }
}

export class RootNode extends Node {
  isRoot = true;
  expanded = true;
  children: Node[] = [];
}

interface ListStateContextOpts {
  onDelete?: (set: Set<Node>) => void;
  onMove?: (
    set: Set<Node>,
    srcState: TreeState,
    destState: TreeState,
    dstPosition: [Node | null, Number],
  ) => void;
}

export class ListStateContext {
  trees = new Set<TreeState>();
  onDelete?: (set: Set<Node>) => void;
  onMove?: (
    set: Set<Node>,
    srcState: TreeState,
    destState: TreeState,
    dstPosition: [Node | null, Number],
  ) => void;
  constructor(opts: ListStateContextOpts = {}) {
    this.onMove = opts.onMove;
    this.onDelete = opts.onDelete;
  }
  createTree(opts: Omit<TreeStateOpts, "context"> = {}) {
    const tree = new TreeState({ ...opts, context: this });
    this.trees.add(tree);
    return tree;
  }
}

interface TreeStateOpts {
  mutate?: boolean;
  loader?: (node: GenericNode<any>) => Node;
  context?: ListStateContext;
}

export class TreeState {
  id: string;
  isRoot = true;
  childrenSignal = createSignal<Node[]>([]);
  idMap = new Map<string, Node>();
  mutate = false;
  maxDepth = 10;
  expanded = true;
  loader?: (node: GenericNode<any>) => Node | false;
  onDelete?: (set: Set<Node>) => void;
  context?: ListStateContext;
  constructor(opts: TreeStateOpts = {}) {
    this.id = createUniqueId();
    this.loader = opts.loader;
    this.onDelete = this.onDelete;
    this.context = opts.context;
  }
  get mutableRoot(): RootNode {
    const root = new RootNode();
    root.children = this.childrenSignal[0]();
    root.isRoot = true;
    return root;
  }
  delete(set: Set<Node>) {
    const result = this.remove(set);
    this.onDelete?.(set);
    set.forEach((node) => this.idMap.delete(node.id));
    this.childrenSignal[1](() => result.filtered);
  }
  refresh() {
    this.childrenSignal[1]([...this.childrenSignal[0]()]);
  }
  // TODO: AI Written
  insertNode(newNode: Node, parentNode: Node | null, position: number) {
    if (!parentNode) {
      // Insert at root level
      const currentChildren = this.childrenSignal[0]();
      const updatedChildren = [
        ...currentChildren.slice(0, position),
        newNode,
        ...currentChildren.slice(position),
      ];
      this.childrenSignal[1](updatedChildren);
    } else {
      // Insert under a specific parent node
      const updatedTree = this.mutableRoot;
      const updateNode = (node: Node) => {
        if (node === parentNode) {
          node.children = [
            ...node.children.slice(0, position),
            newNode,
            ...node.children.slice(position),
          ];
          return node;
        }
        node.children = node.children.map(updateNode);
        return node;
      };
      const updatedChildren = updatedTree.children.map(updateNode);
      this.childrenSignal[1](updatedChildren);
    }

    // Update the new node's properties
    newNode.root = this;
    newNode.parent = parentNode;

    // Add the new node to the idMap
    this.idMap.set(newNode.id, newNode);
  }
  insertItems(nodes: Set<Node>, dstPosition: [Node | null, number]) {
    const transformNodes = Array.from(nodes).map((node) => {
      node.root = this;
      this.idMap.set(node.id, node);
      node.parent = dstPosition[0] || node.root;
      node.setDepth(dstPosition[0] ? dstPosition[0].depth + 1 : 1);
      node.triggerUpdate();
      return node;
    });

    const [parentNode, newPosition] = dstPosition;
    if (!parentNode) {
      // Add to root level
      const currentChildren = this.childrenSignal[0]();
      const updatedChildren = [
        ...currentChildren.slice(0, newPosition),
        ...Array.from(transformNodes),
        ...currentChildren.slice(newPosition),
      ];
      this.childrenSignal[1](updatedChildren);
    } else {
      // Add to a specific parent node
      const newChildren = [
        ...parentNode.children.slice(0, newPosition),
        ...Array.from(transformNodes),
        ...parentNode.children.slice(newPosition),
      ];
      const updatedTree = this.mutableRoot;
      parentNode.children = newChildren;
      const updatedChildren = updatedTree.children.map((node) => node); // is this needed?
      this.childrenSignal[1](updatedChildren);
    }
  }
  getNodesByIds(ids: Set<string>) {
    const nodeSet = new Set<Node>();
    for (const id of ids) {
      const node = this.idMap.get(id);
      if (node) {
        nodeSet.add(node);
      }
    }
    return nodeSet;
  }
  remove(set: Set<Node>) {
    if (!set || !set.size) {
      console.warn("Attempted to remove empty set of items");
    }
    const filtered = filter<any>(this.mutableRoot, (node) => {
      return !set.has(node);
    }).children;
    return {
      removed: set,
      filtered,
    };
  }
  take(set: Set<Node>) {
    set.forEach((item) => {
      this.idMap.delete(item.id);
    });
    const result = this.remove(set);
    this.childrenSignal[1](() => result.filtered);
    return set;
  }

  loadChildren(children: GenericNode<any>[]) {
    const loader = this.loader
      ? this.loader
      : (rawNode: any) => new Node(rawNode);
    const tree = map<any, any>(
      { children, isRoot: true },
      (rawNode, parent, depth) => {
        // a bit silly but important to realise the root node goes through the map function
        // so we need to treat it as a root node to then discard it.
        const node = rawNode.isRoot ? new RootNode() : loader(rawNode);
        if (!node) return new Node({ type: "invalid" });
        node.root = this;
        node.parent = parent.isRoot === true ? this : parent; // Discards temporary root
        node.depth = depth;
        this.idMap.set(node.id, node);
        return node;
      },
      this,
    );
    this.childrenSignal[1](() => tree.children);
  }
  count = (expandedOnly?: boolean) => {
    let count = 0;
    walk<Node, Node>(
      { isRoot: true, children: this.childrenSignal[0](), expanded: true },
      (node) => {
        count++;
        if (expandedOnly && !node.expanded) return true;
        return false;
      },
    );
    return count - 1; // accounts for root node
  };
}
