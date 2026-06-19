const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const nodePath = process.execPath;
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const out = fs.openSync(path.join(root, "dev-server.log"), "a");
const err = fs.openSync(path.join(root, "dev-server.err.log"), "a");

const child = spawn(nodePath, [nextBin, "dev", "-p", "3005", "-H", "127.0.0.1"], {
  cwd: root,
  detached: true,
  stdio: ["ignore", out, err],
  windowsHide: true
});

child.unref();
fs.writeFileSync(path.join(root, "dev-server.pid"), String(child.pid));
console.log(`Started dev server pid ${child.pid} at http://127.0.0.1:3005`);
