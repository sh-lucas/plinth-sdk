// Shared test fixture (contract: "Test environment"). Examples import it by relative path.
import { PlinthClient, isConflict } from "../src/index.js";

export const hasServer = Boolean(process.env.PLINTH_URL && process.env.PLINTH_EMAIL && process.env.PLINTH_PASSWORD);
export const isLocal = process.env.PLINTH_E2E_LOCAL === "1";

export interface Fixture {
  url: string;
  email: string;
  password: string;
  admin: PlinthClient;
  runid: string;
  /** Organizational root, e.g. `sdk-e2e`. */
  root: string;
  /** Organizational child `<root>-<runid>`. Create every test domain under it. */
  org: string;
  /** Prefix a name with the run id: `id("points")` -> `<runid>-points`. */
  id(name: string): string;
}

const base36 = () => Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join("");

export async function createFixture(): Promise<Fixture> {
  const url = process.env.PLINTH_URL!;
  const email = process.env.PLINTH_EMAIL!;
  const password = process.env.PLINTH_PASSWORD!;
  const root = process.env.PLINTH_E2E_ROOT ?? "sdk-e2e";
  const runid = base36();
  const admin = new PlinthClient({ baseUrl: url, credentials: { email, password } });
  try {
    await admin.domains.create({ id: root, name: root, kind: "group" });
  } catch (err) {
    if (!isConflict(err)) throw err;
  }
  const org = `${root}-${runid}`;
  await admin.domains.create({ id: org, name: org, kind: "group", parent: root });
  return { url, email, password, admin, runid, root, org, id: (name) => `${runid}-${name}` };
}

/** Scalar points domain under the run's org, with the `credit` and `redeem` templates and one bucket. */
export async function createPointsModel(fx: Fixture, name = "points") {
  const domain = fx.id(name);
  await fx.admin.domains.create({ id: domain, name: "Points", kind: "points", unit: "point", parent: fx.org });
  const nodes = (guard: boolean) => [
    { id: "account", op: "bucket" },
    { id: "amount", op: "input", value_type: "integer", min: 1 },
    ...(guard
      ? [
          { id: "available", op: "balance", scope: { bucket: "account" } },
          { id: "enough", op: "compare", operator: "gte", left: "available", right: "amount" },
          { id: "guard", op: "require", condition: "enough", code: "INSUFFICIENT_POINTS" },
        ]
      : []),
    { id: "move", op: "post", bucket: "account", amount: "amount", direction: guard ? "out" : "in" },
  ];
  const credit = fx.id(`${name}-credit`);
  const redeem = fx.id(`${name}-redeem`);
  await fx.admin.templates.publish({ id: credit, domain, name: "Credit points", nodes: nodes(false) });
  await fx.admin.templates.publish({ id: redeem, domain, name: "Redeem points", nodes: nodes(true) });
  return { domain, credit, redeem };
}
