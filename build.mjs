// Builds independence-wizard.min.html from independence-wizard.html.
//
//   node build.mjs           write the min file
//   node build.mjs --check   exit 1 if the committed min file is not what the source builds to
//
// The source is the one file to edit. The min file is generated: never patch it by hand.
// Inline <style> and <script> blocks are minified with esbuild (top-level names are kept, so
// anything the page or the host reaches by name still works); comments and indentation are
// stripped from the markup between them.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { transformSync } from "esbuild";

const SOURCE = new URL("./independence-wizard.html", import.meta.url);
const TARGET = new URL("./independence-wizard.min.html", import.meta.url);

export function build(html) {
  // Stamp a short hash of the source so a published copy can be told apart (shown in the header and in the record).
  const stamp = createHash("sha256").update(html).digest("hex").slice(0, 8);
  html = html.replace('var BUILD = "dev";', `var BUILD = "${stamp}";`);
  const blocks = [];
  // Pull each <style>/<script> body out first, so the markup pass cannot touch it.
  const shell = html.replace(/<(style|script)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (_, tag, attrs = "", body) => {
    if (/\ssrc=/.test(attrs)) return `<${tag}${attrs}></${tag}>`;
    const out = tag === "style"
      ? transformSync(body, { loader: "css", minify: true }).code.trim()
      : transformSync(body, { loader: "js", minify: true, target: "es2018", legalComments: "none" }).code.trim();
    blocks.push(out);
    return `<${tag}${attrs}>\u0000${blocks.length - 1}\u0000</${tag}>`;
  });

  const markup = shell
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return markup.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]) + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = build(readFileSync(SOURCE, "utf8"));
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(TARGET, "utf8"); } catch { /* missing counts as stale */ }
    if (current !== built) {
      console.error("independence-wizard.min.html is out of date. Run: npm run build");
      process.exit(1);
    }
    console.log("independence-wizard.min.html is up to date.");
  } else {
    writeFileSync(TARGET, built);
    console.log(`Wrote independence-wizard.min.html (${built.length} bytes).`);
  }
}
