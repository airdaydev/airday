import { describe, beforeEach, test, expect } from "vitest";
import { TreeState } from "./state";

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
    const children = [
      { id: "child1" },
      { id: "child2", children: [{ id: "grandchild" }] },
    ];

    treeState.loadChildren(children);

    expect(treeState.childrenSignal[0]()[0].parent).toBe(treeState);
    expect(treeState.childrenSignal[0]()[0].depth).toBe(1);
    expect(treeState.childrenSignal[0]()[1].children[0].depth).toBe(2);
    expect(treeState.childrenSignal[0]().length).toBe(2);
    expect(treeState.idMap.size).toBe(4); // root + 2 children + 1 grandchild
  });

  test("delete method removes nodes from the tree", () => {
    const children = [{ id: "child1" }, { id: "child2" }];

    treeState.loadChildren(children);

    const nodeToDelete = treeState.idMap.get("child1");
    treeState.delete(new Set([nodeToDelete]));

    expect(treeState.childrenSignal[0]().length).toBe(1);
  });

  test("count method returns correct number of nodes", () => {
    const children = [
      { id: "child1" },
      { id: "child2", children: [{ id: "grandchild" }] },
    ];

    treeState.loadChildren(children);

    const count = treeState.count();
    expect(count).toBe(3); // 2 children + 1 grandchild (root not counted)
  });

  test("moveItems method reorders nodes", () => {
    const children = [{ id: "child1" }, { id: "child2" }, { id: "child3" }];

    treeState.loadChildren(children);

    const nodesToMove = new Set([treeState.idMap.get("child1")]);
    treeState.moveItems(nodesToMove, null, 2);

    const newOrder = treeState.childrenSignal[0]().map((node) => node.id);
    expect(newOrder).toEqual(["child2", "child3", "child1"]);
  });
  test.only("moveItems nests & sets depth correctly", () => {
    const children = [
      { id: "child1", children: [{ id: "child:d1" }] },
      { id: "child2", children: [] },
    ];

    treeState.loadChildren(children);

    const nodesToMove = new Set([treeState.idMap.get("child1")]);
    const child2 = treeState.idMap.get("child2");
    treeState.take(nodesToMove);
    treeState.insertItems(nodesToMove, [child2, 0]);
    const t = treeState.idMap.get("child:d1");
    expect(t.depth).toEqual(3);
    expect(treeState.childrenSignal[0]()[0].children[0].children[0]).toEqual(t);
  });
});
