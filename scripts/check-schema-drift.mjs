import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rootSchema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const adminSchema = fs.readFileSync(path.join(root, "admin-panel/prisma/schema.prisma"), "utf8");
const queries = fs.readFileSync(path.join(root, "admin-panel/src/lib/queries.ts"), "utf8");

function parseModels(src) {
  const models = new Map();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}$/gm;
  let m;
  while ((m = re.exec(src))) {
    const fields = new Map();
    for (const line of m[2].split("\n")) {
      const f = line.trim().match(/^(\w+)\s+(\w+(?:\[\])?)(\??)/);
      if (f) fields.set(f[1], { type: f[2], optional: f[3] === "?" });
    }
    models.set(m[1], fields);
  }
  return models;
}

const rootModels = parseModels(rootSchema);
const adminModels = parseModels(adminSchema);
const ADMIN_ONLY_MODELS = new Set(["RateLimitBucket"]);
const problems = [];

for (const [model, fields] of adminModels) {
  const rf = rootModels.get(model);
  if (!rf) {
    if (!ADMIN_ONLY_MODELS.has(model)) {
      problems.push(`admin model ${model} has no root counterpart`);
    }
    continue;
  }
  for (const [field, def] of fields) {
    const rd = rf.get(field);
    if (!rd) {
      problems.push(`${model}.${field} is missing from the root schema`);
    } else if (rd.type !== def.type) {
      problems.push(`${model}.${field} type differs: root=${rd.type}, admin=${def.type}`);
    }
  }
}

const selectBlock = queries.match(/const STORE_CONFIG_SELECT\s*=\s*\{([\s\S]*?)\n\};/);
if (selectBlock) {
  const storeConfig = rootModels.get("StoreConfig");
  for (const m of selectBlock[1].matchAll(/^\s*(\w+):\s*true/gm)) {
    if (!storeConfig?.has(m[1])) {
      problems.push(`queries.ts selects StoreConfig.${m[1]} which is missing from the root schema`);
    }
  }
}

if (problems.length) {
  console.error("Schema drift detected:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("Schema drift guard: admin schema and queries.ts match the root schema.");
