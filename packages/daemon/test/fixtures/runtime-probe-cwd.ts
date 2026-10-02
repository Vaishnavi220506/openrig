// A child-only cwd mutation: never change the test runner or daemon cwd.
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { execPreflightCommand } from "../../src/adapters/preflight-exec.js";
import { execCommand } from "../../src/adapters/tmux-exec.js";
import { rigPreflight } from "../../src/domain/rigspec-preflight.js";
import { rigspecImportRoutes } from "../../src/routes/rigspec.js";

const [root, mode, runtime] = process.argv.slice(2) as [string, string, string];
const work = path.join(root, "working");
fs.mkdirSync(work);
process.chdir(work);
if (mode === "deleted") fs.rmdirSync(work);
process.env.PATH = path.join(root, mode === "missing" ? "empty-bin" : "bin");
const rigRoot = path.join(root, "rig");
const yaml = `version: "0.2"
name: probe
pods:
  - id: dev
    label: Dev
    members:
      - id: impl
        agent_ref: local:agents/impl
        profile: default
        runtime: ${runtime}
        cwd: ${path.join(root, "seat")}
    edges: []
edges: []
`;
const fsOps = { exists: fs.existsSync, readFile: (p: string) => fs.readFileSync(p, "utf8") };
// The production startup executor, through the same core used by rig up.
const core = await rigPreflight({ rigSpecYaml: yaml, rigRoot, fsOps, exec: execPreflightCommand });
// The production synchronous executor, through the real route.
const app = new Hono();
app.use("*", async (c, next) => {
  c.set("podInstantiator" as never, { resolveSkillsRoot: () => undefined } as never);
  await next();
});
app.route("/api/rigs/import", rigspecImportRoutes);
const response = await app.request("/api/rigs/import/preflight", {
  method: "POST", headers: { "X-Rig-Root": rigRoot }, body: yaml,
});
// Non-version commands retain their current-directory semantics in both the
// dedicated and generic executor. Use only a synthetic executable here.
let nonVersion: string | null = null;
let generic: string | null = null;
if (mode === "stable") {
  nonVersion = (await execPreflightCommand("codex -p fixture mcp list")).trim();
  generic = (await execCommand("pi --version")).trim();
}
console.log(JSON.stringify({ core, route: await response.json(), status: response.status, nonVersion, generic, work }));
