const fs = require("fs");
const path = require("path");
const { slugify } = require("./agentDefs");

// Surgical regex replace of just the `name:` line — preserves the rest of
// the file byte-for-byte (including the loosely-formatted multi-line
// `description:` block) rather than reserializing through the frontmatter
// parser, which could reflow/lose formatting.
function renameAgentFile(agentsDir, oldSourceFile, newName) {
  const oldPath = path.join(agentsDir, oldSourceFile);
  const raw = fs.readFileSync(oldPath, "utf8");
  if (!/^name:.*$/m.test(raw)) throw new Error("name: フィールドが見つかりませんでした");

  const newRaw = raw.replace(/^name:.*$/m, `name: ${newName}`);
  const newSlug = slugify(newName);
  if (!newSlug) throw new Error("有効な名前を入力してください");

  const newFile = `${newSlug}.md`;
  const newPath = path.join(agentsDir, newFile);

  if (newFile !== oldSourceFile && fs.existsSync(newPath)) {
    throw new Error(`同名のエージェントファイルが既に存在します: ${newFile}`);
  }

  fs.writeFileSync(oldPath, newRaw, "utf8");
  if (newFile !== oldSourceFile) {
    fs.renameSync(oldPath, newPath);
  }

  return { newSlug, newFile };
}

module.exports = { renameAgentFile };
