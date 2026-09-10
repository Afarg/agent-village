const fs = require("fs");
const path = require("path");

function readStateFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  return json;
}

function readAllStates(stateDir) {
  if (!fs.existsSync(stateDir)) return {};
  const files = fs
    .readdirSync(stateDir)
    .filter((f) => f.toLowerCase().endsWith(".json"));

  const result = {};
  for (const file of files) {
    const agentId = path.basename(file, ".json");
    try {
      result[agentId] = readStateFile(path.join(stateDir, file));
    } catch (err) {
      console.warn(`[agentState] failed to parse ${file}, keeping previous value if any: ${err.message}`);
    }
  }
  return result;
}

module.exports = { readStateFile, readAllStates };
