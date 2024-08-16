import { describe, beforeEach, test, expect } from "vitest";
import { TreeState, Node } from "./state";

describe("TreeState", () => {
  let treeState;

  beforeEach(() => {
    treeState = new TreeState();
  });

  test("constructor initializes with default values", () => {
    expect(treeState.id).toBeDefined();
    expect(treeState.isRoot).toBe(true);
    expect(treeState.childrenSignal[0]()).toEqual([]);
    expect(treeState.idMap.size).toBe(0);
    expect(treeState.mutate).toBe(false);
    expect(treeState.maxDepth).toBe(10);
    expect(treeState.expanded).toBe(true);
  });

  test("load method populates the tree", () => {
    const sampleTree = {
      id: "root",
      children: [
        { id: "child1" },
        { id: "child2", children: [{ id: "grandchild" }] },
      ],
    };

    treeState.load(sampleTree);

    expect(treeState.childrenSignal[0]().length).toBe(2);
    expect(treeState.idMap.size).toBe(4); // root + 2 children + 1 grandchild
  });

  test("delete method removes nodes from the tree", () => {
    const sampleTree = {
      id: "root",
      children: [{ id: "child1" }, { id: "child2" }],
    };

    treeState.load(sampleTree);

    const nodeToDelete = treeState.idMap.get("child1");
    treeState.delete(new Set([nodeToDelete]));

    expect(treeState.childrenSignal[0]().length).toBe(1);
  });

  test("count method returns correct number of nodes", () => {
    const sampleTree = {
      id: "root",
      children: [
        { id: "child1" },
        { id: "child2", children: [{ id: "grandchild" }] },
      ],
    };

    treeState.load(sampleTree);

    const count = treeState.count()();
    expect(count).toBe(3); // 2 children + 1 grandchild (root not counted)
  });

  test("moveLayersWithinTree method reorders nodes", () => {
    const sampleTree = {
      id: "root",
      children: [{ id: "child1" }, { id: "child2" }, { id: "child3" }],
    };

    treeState.load(sampleTree);

    const nodesToMove = [treeState.idMap.get("child1")];
    treeState.moveLayersWithinTree(nodesToMove, null, 2);

    const newOrder = treeState.childrenSignal[0]().map((node) => node.id);
    expect(newOrder).toEqual(["child2", "child3", "child1"]);
  });
});
