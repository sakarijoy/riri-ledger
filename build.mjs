import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { Script } from "node:vm";

const input = new URL("./dist/", import.meta.url);
const pwa = new URL("./pwa/", import.meta.url);
const output = new URL("./docs/", import.meta.url);
const read = (dir, name) => readFile(new URL(name, dir), "utf8");
const write = (name, text) => writeFile(new URL(name, output), text);

const [html, css, app, assets, worker] = await Promise.all([
  read(input, "index.html"),
  read(input, "style.css"),
  read(input, "app.js"),
  read(input, "assets.js"),
  read(pwa, "sw.js"),
]);

for (const code of [app, assets]) {
  new Script(code);
  if (/<\/script/i.test(code)) throw new Error("Cannot embed a script containing a closing script tag.");
}

const offline = html
  .replace("  <title>", '  <meta name="robots" content="noindex">\n  <title>')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
  .replace(/  <script defer src="(?:app|assets)\.js"><\/script>\r?\n/g, "")
  .replace("</body>", () => `<script>\n${app}\n</script>\n<script>\n${assets}\n</script>\n</body>`);

const version = createHash("sha256").update(offline).update(worker).digest("hex").slice(0, 16);
const online = offline.replace("</head>", [
  `  <meta name="ledger-version" content="${version}">`,
  '  <link rel="manifest" href="manifest.webmanifest">',
  '  <link rel="icon" type="image/png" href="icon-192.png">',
  '  <link rel="apple-touch-icon" sizes="180x180" href="icon-180.png">',
  "</head>",
].join("\n"));

await mkdir(output, { recursive: true });
await Promise.all([
  write("index.html", online),
  write("offline.html", offline),
  write("version.json", JSON.stringify({ version }) + "\n"),
  write("sw.js", worker.replace("__LEDGER_VERSION__", version)),
  write(".nojekyll", ""),
  ...["manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"]
    .map((name) => copyFile(new URL(name, pwa), new URL(name, output))),
]);
console.log(version);
