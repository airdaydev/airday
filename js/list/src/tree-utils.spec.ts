import { describe, test, expect } from "vitest";
import { createUniqueId } from "solid-js";
import { map } from "./tree-utils";

class Node {
  id = createUniqueId();
  children: Node[];
  constructor(children: Node[] = []) {
    this.children = children;
  }
}

const treeGen = (maxLength: number = 5) => {
  const root = new Node();
  function genChildren(parentNode: Node, depth: number) {
    const children = [];
    if (depth > 0) {
      const seed = Math.round(maxLength * Math.random());
      for (let i = 0; i < seed; i++) {
        children.push(new Node());
      }
    }
    children.forEach((child) => genChildren(child, depth - 1));
    parentNode.children = children;
  }
  genChildren(root, maxLength);
  return root;
};

describe("Tree map depth works", () => {
  test("depth of 5", () => {
    let has0Depth = false;
    let maxResult = 0;
    const maxDepth = 5;
    const tree = treeGen(maxDepth);
    map(tree, (node, _, depth) => {
      if (depth === 0 && has0Depth === false) has0Depth = true;
      maxResult = Math.max(maxResult, depth);
      return node;
    });
    expect(has0Depth).toBe(true);
    expect(maxResult).toBe(5);
  });
});
