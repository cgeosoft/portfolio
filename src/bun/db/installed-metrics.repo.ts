import { getDatabase } from "./database.js";

export interface InstalledMetricRow {
  id: string;
  version: string;
  source: "builtin" | "url";
  sourceUrl: string | null;
  sha256: string;
  manifestYaml: string;
  scopesGranted: string;
  verified: number;
  installedAt: string;
}

export function findAll(): InstalledMetricRow[] {
  return getDatabase().query("SELECT * FROM installed_metrics ORDER BY installedAt ASC").all() as InstalledMetricRow[];
}

export function findById(id: string): InstalledMetricRow | null {
  return (getDatabase().query("SELECT * FROM installed_metrics WHERE id = ?").get(id) as InstalledMetricRow | null) ?? null;
}

export function upsert(row: Omit<InstalledMetricRow, "installedAt">): InstalledMetricRow {
  getDatabase().run(
    `INSERT INTO installed_metrics (id, version, source, sourceUrl, sha256, manifestYaml, scopesGranted, verified, installedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       version = excluded.version,
       source = excluded.source,
       sourceUrl = excluded.sourceUrl,
       sha256 = excluded.sha256,
       manifestYaml = excluded.manifestYaml,
       scopesGranted = excluded.scopesGranted,
       verified = excluded.verified,
       installedAt = datetime('now')`,
    [row.id, row.version, row.source, row.sourceUrl, row.sha256, row.manifestYaml, row.scopesGranted, row.verified],
  );
  return findById(row.id)!;
}

export function remove(id: string): boolean {
  const result = getDatabase().run("DELETE FROM installed_metrics WHERE id = ?", [id]);
  return result.changes > 0;
}
