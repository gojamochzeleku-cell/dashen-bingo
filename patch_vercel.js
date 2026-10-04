const fs = require("fs");
const render = process.env.RENDER_API;
fs.writeFileSync("apps/web/vercel.json", JSON.stringify({
  buildCommand: "npm run build",
  outputDirectory: "dist",
  framework: "vite",
  rewrites: [
    { source: "/api/admin/:path*", destination: render + "/api/admin/:path*" },
    { source: "/(.*)", destination: "/index.html" }
  ]
}, null, 2));
console.log("✅ vercel.json proxies /api/admin ->", render);
