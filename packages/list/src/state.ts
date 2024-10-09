import { Signal, createSignal, createUniqueId } from "solid-js";
import { GenericNode, map, walk, filter } from "./tree-utils";

export interface NodeSignalProps {
  id: string;
}

export class Node {
  id: string;
  children: Node[] = [];
  isRoot: boolean = false;
  depth = 0; // cached
  expanded = true;
  parent?: Node;
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
    };
  }
  triggerUpdate() {
    this.uiSignal?.[1](() => this.toJSON());
  }
  collapse(recursive = false) {
    this.expanded = false;
    if (recursive) {
      map<Node, Node>(this, (node) => {
        node.expanded = false;
        return node;
      });
    }
  }
  expand(recursive = false) {
    this.expanded = true;
    if (recursive) {
      map<Node, Node>(this, (node) => {
        node.expanded = true;
        return node;
      });
    }
  }
}

export class RootNode extends Node {
  isRoot = true;
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
  // TODO: consider deleting & recreating each item (cleaner)
  moveItems(
    nodes: Set<Node>,
    srcState: TreeState,
    destState: TreeState,
    dstPosition: [Node | null, number],
  ) {
    // Remove items from the source tree
    const result = srcState.remove(nodes);
    if (!result.removed) {
      return;
    }

    const transformNodes = Array.from(nodes).map((node) => {
      node.root = destState;
      // Remove from source idMap and add to destination idMap
      srcState.idMap.delete(node.id);
      destState.idMap.set(node.id, node);
      return node;
    });

    // Update the source tree
    srcState.childrenSignal[1](result.filtered);

    // Add items to the destination tree
    // TODO: We should probably clone these...
    const [parentNode, newPosition] = dstPosition;
    if (!parentNode) {
      // Add to root level
      const currentChildren = destState.childrenSignal[0]();
      const updatedChildren = [
        ...currentChildren.slice(0, newPosition),
        ...Array.from(transformNodes),
        ...currentChildren.slice(newPosition),
      ];
      destState.childrenSignal[1](updatedChildren);
    } else {
      // Add to a specific parent node
      const updatedTree = destState.mutableRoot;
      const updateNode = (node: Node) => {
        if (node === parentNode) {
          node.children = [
            ...node.children.slice(0, newPosition),
            ...Array.from(transformNodes),
            ...node.children.slice(newPosition),
          ];
          return node;
        }
        node.children = node.children.map(updateNode);
        return node;
      };
      const updatedChildren = updatedTree.children.map(updateNode);
      destState.childrenSignal[1](updatedChildren);
    }

    // Call the onMove callback if it exists
    if (this.onMove) {
      this.onMove(nodes, srcState, destState, dstPosition);
    }
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

  load(tree: GenericNode<any>) {
    const children = map<any, any>(
      tree,
      (rawNode, parent, depth) => {
        const node = this.loader ? this.loader(rawNode) : new Node(rawNode);
        if (!node) return new Node({ type: "invalid" });
        node.root = this;
        node.parent = parent;
        node.depth = depth;
        this.idMap.set(node.id, node);
        return node;
      },
      this,
    ).children;
    this.childrenSignal[1](() => children);
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
  moveItems(nodes: Set<Node>, parentNode: Node | null, newPosition: number) {
    const sortedNodes = Array.from(nodes).sort((nodeA, nodeB) => {
      return nodeA.getIndex() - nodeB.getIndex();
    });
    const result = this.remove(nodes);
    if (!result.removed) {
      return;
    }
    if (!parentNode) {
      result.filtered.splice(newPosition, 0, ...sortedNodes);
    }
    // Add back layers
    if (parentNode) {
      map<RootNode, any>(result.filtered, (node) => {
        if (node === parentNode) {
          node.children.splice(newPosition, 0, ...sortedNodes);
          return node;
        }
        return node;
      });
    }
    this.childrenSignal[1](result.filtered);
  }
}
