import { Signal, createMemo, createSignal, createUniqueId } from "solid-js";
import { qperf } from "./utils";
import { DndContext } from "./dnd-context";
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
    };
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

    // Update the source tree
    srcState.childrenSignal[1](result.filtered);

    // Add items to the destination tree
    const [parentNode, newPosition] = dstPosition;
    if (!parentNode) {
      // Add to root level
      const currentChildren = destState.childrenSignal[0]();
      const updatedChildren = [
        ...currentChildren.slice(0, newPosition),
        ...Array.from(nodes),
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
            ...Array.from(nodes),
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
  dndContext?: DndContext;
  context?: ListStateContext;
}

export class TreeState {
  id: string;
  isRoot = true;
  childrenSignal = createSignal<Node[]>([]);
  idMap = new Map<string, Node>(); // Not currently used
  mutate = false;
  maxDepth = 10;
  expanded = true;
  loader?: (node: GenericNode<any>) => Node;
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
    this.childrenSignal[1](() => result.filtered);
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
    const q = qperf("load");
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
      this,
    ).children;
    this.childrenSignal[1](() => children);
    q();
  }
  count(expandedOnly?: boolean) {
    return createMemo(() => {
      let count = 0;
      walk(
        { isRoot: true, children: this.childrenSignal[0]() },
        (node) => {
          count++;
          if (expandedOnly && !node.expanded) return true;
          return false;
        },
        undefined,
      );
      return count - 1; // accounts for root node
    });
  }
  moveItems(nodes: Set<Node>, parentNode: Node | null, newPosition: number) {
    const result = this.remove(nodes);
    if (!result.removed) {
      return;
    }
    if (!parentNode) {
      result.filtered.splice(newPosition, 0, ...nodes);
    }
    // Add back layers
    if (parentNode) {
      map<RootNode, any>(result.filtered, (node) => {
        if (node === parentNode) {
          node.children.splice(newPosition, 0, ...nodes);
          return node;
        }
        return node;
      });
    }
    this.childrenSignal[1](result.filtered);
  }
}
