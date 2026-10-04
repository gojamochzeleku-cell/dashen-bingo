const fs = require("fs"), path = require("path");
const root = "apps/web/src";
let patched = 0;

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(tsx|ts)$/.test(f) || f === "apiBase.ts") continue;
    
    let s = fs.readFileSync(p, "utf8");
    const rel = path.relative(path.dirname(p), root).replace(/\\/g, "/") || ".";
    const impPath = (rel.startsWith(".") ? rel : "./" + rel) + "/apiBase";
    
    if (s.includes("io()") || /fetch\((['"`])\/api\//.test(s)) {
      if (!s.includes("apiBase")) {
        s = "import { API_BASE } from \"" + impPath + "\";\n" + s;
      }
      s = s.split("io()").join("io(API_BASE)");
      s = s.replace(/fetch\((['"`])\/api\//g, "fetch(API_BASE + $1/api/");
      fs.writeFileSync(p, s);
      patched++;
      console.log("✅ patched", p);
    }
  }
}
walk(root);
console.log(patched ? "✅ " + patched + " frontend file(s) now use the cloud API" : "⚠️ no patterns found");
