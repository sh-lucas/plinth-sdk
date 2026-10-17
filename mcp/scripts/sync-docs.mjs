// Copy the DSL reference and the modelling guide from the server repo (../plinth/specs next to this repo).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specs = process.env.PLINTH_SPECS ?? join(here, "../../../plinth/specs");
const docs = join(here, "../docs");
mkdirSync(docs, { recursive: true });
for (const f of ["programs.md", "modelling.md"]) {
  copyFileSync(join(specs, f), join(docs, f));
  console.log(`copied ${f}`);
}
