import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { createFullTestDb, createTestApp } from "./helpers/test-app.js";
import type { RigSpec } from "../src/domain/types.js";

describe("persisted pod-aware launch recipes", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("survives a node reload and selects the member for a fresh launch", async () => {
    db = createFullTestDb();
    const setup = createTestApp(db);
    const rig = setup.rigRepo.createRig("recipe-rig");
    db.prepare("INSERT INTO pods (id, rig_id, namespace, label) VALUES (?, ?, ?, ?)")
      .run("pod-recipe", rig.id, "dev", "Development");

    const rigRoot = "/workspace/recipe-rig";
    const rigSpec: RigSpec = {
      version: "0.2",
      name: "recipe-rig",
      pods: [{
        id: "dev",
        label: "Development",
        members: [{
          id: "impl",
          agentRef: "local:agents/impl",
          profile: "default",
          runtime: "claude-code",
          cwd: ".",
        }],
        edges: [],
      }],
      edges: [],
    };
    const node = setup.rigRepo.addNode(rig.id, "dev.impl", {
      runtime: "claude-code",
      podId: "pod-recipe",
      launchRecipe: { version: 1, rigRoot, rigSpec },
    });

    expect(setup.rigRepo.getNodeLaunchRecipe(node.id)).toEqual({ version: 1, rigRoot, rigSpec });

    const launchBinding = vi.spyOn(setup.podInstantiator, "launchBinding")
      .mockResolvedValue({ status: "launched" });
    const result = await setup.podInstantiator.launchPersistedFresh(rig.id, node.id);

    expect(result).toEqual({ status: "launched" });
    expect(launchBinding).toHaveBeenCalledWith(expect.objectContaining({
      rigId: rig.id,
      rigRoot,
      qualifiedId: "dev.impl",
      nodeId: node.id,
      member: expect.objectContaining({ id: "impl", agentRef: "local:agents/impl" }),
      pod: expect.objectContaining({ id: "dev", label: "Development" }),
    }));
  });

  it("keeps saved seat choices authoritative over the recipe defaults", async () => {
    db = createFullTestDb();
    const setup = createTestApp(db);
    const rig = setup.rigRepo.createRig("saved-choice-rig");
    db.prepare("INSERT INTO pods (id, rig_id, namespace, label) VALUES (?, ?, ?, ?)")
      .run("pod-saved-choice", rig.id, "dev", "Development");

    const node = setup.rigRepo.addNode(rig.id, "dev.impl", {
      runtime: "codex",
      model: "saved-model",
      effort: "saved-effort",
      codexConfigProfile: "saved-profile",
      cwd: "/saved/cwd",
      podId: "pod-saved-choice",
      launchRecipe: {
        version: 1,
        rigRoot: "/workspace/saved-choice-rig",
        rigSpec: {
          version: "0.2",
          name: "saved-choice-rig",
          pods: [{
            id: "dev",
            label: "Development",
            members: [{
              id: "impl",
              agentRef: "local:agents/impl",
              profile: "default",
              runtime: "codex",
              model: "recipe-model",
              effort: "recipe-effort",
              codexConfigProfile: "recipe-profile",
              cwd: ".",
            }],
            edges: [],
          }],
          edges: [],
        },
      },
    });

    const launchBinding = vi.spyOn(setup.podInstantiator, "launchBinding")
      .mockResolvedValue({ status: "launched" });
    await setup.podInstantiator.launchPersistedFresh(rig.id, node.id);

    expect(launchBinding.mock.calls[0]?.[0].member).toEqual(expect.objectContaining({
      model: "saved-model",
      effort: "saved-effort",
      codexConfigProfile: "saved-profile",
      cwd: "/saved/cwd",
    }));
  });

  it("rejects malformed stored specs without throwing", async () => {
    db = createFullTestDb();
    const setup = createTestApp(db);
    const rig = setup.rigRepo.createRig("malformed-recipe-rig");
    const node = setup.rigRepo.addNode(rig.id, "dev.impl", { runtime: "codex" });
    db.prepare("UPDATE nodes SET launch_recipe_json = ? WHERE id = ?")
      .run(JSON.stringify({ version: 1, rigRoot: "/workspace", rigSpec: { version: "0.2", name: "broken", pods: {} } }), node.id);

    expect(setup.rigRepo.getNodeLaunchRecipe(node.id)).toBeNull();
  });
});
