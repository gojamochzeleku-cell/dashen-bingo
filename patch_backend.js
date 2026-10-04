const fs = require("fs");
const p = "apps/api/src/server.ts";
let s = fs.readFileSync(p, "utf8");
const o = s;

s = s.replace(/new Server\(\s*(server|httpServer|app)\s*\)/g, "new Server($1, { cors: { origin: true } })");
s = s.replace(/cors:\s*{\s*origin:[^}]*}/g, "cors: { origin: true }");

if (/app\.use\(cors\(\)\)/.test(s)) {
  s = s.replace("app.use(cors())", "app.use(cors({ origin: true }))");
} else if (!/cors\(/.test(s)) {
  s = s.replace(/const app = express\(\);/, "const app = express();\napp.use(cors({ origin: true }));");
  if (!/import cors from/.test(s)) {
    s = "import cors from \"cors\";\n" + s;
  }
}

if (s !== o) {
  fs.writeFileSync(p, s);
  console.log("✅ backend CORS opened");
} else {
  console.log("⚠️ CORS pattern unchanged");
}
