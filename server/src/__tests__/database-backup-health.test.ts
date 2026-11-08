import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LATEST_BACKUP_CACHE_TTL_MS,
  createLatestBackupFinder,
} from "../services/database-backup-health.js";

const BASE_MS = Date.parse("2026-11-01T00:00:00.000Z");
const HOUR_MS = 3_600_000;

describe("createLatestBackupFinder", () => {
  let dir: string;
  let clockMs: number;
  const clock = () => clockMs;

  function writeBackup(name: string, mtimeMs: number, contents = "x") {
    const fullPath = path.join(dir, name);
    writeFileSync(fullPath, contents);
    utimesSync(fullPath, mtimeMs / 1000, mtimeMs / 1000);
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "paperclip-backup-health-"));
    clockMs = 1_000_000;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("scans synchronously on the first call and ignores non-backup files", () => {
    writeBackup("older.sql.gz", BASE_MS - HOUR_MS);
    writeBackup("latest.sql.gz", BASE_MS, "abc");
    writeBackup("notes.txt", BASE_MS + HOUR_MS);
    const findLatestBackup = createLatestBackupFinder({ clock });

    expect(findLatestBackup(dir, BASE_MS + 2 * HOUR_MS)).toEqual({
      name: "latest.sql.gz",
      path: path.join(dir, "latest.sql.gz"),
      mtime: new Date(BASE_MS).toISOString(),
      ageHours: 2,
      sizeBytes: 3,
    });
  });

  it("returns null for a missing directory or a directory without backups", () => {
    const findLatestBackup = createLatestBackupFinder({ clock });

    expect(findLatestBackup(path.join(dir, "missing"), BASE_MS)).toBeNull();
    expect(findLatestBackup(dir, BASE_MS)).toBeNull();
  });

  it("serves the cached result within the TTL and recomputes age from nowMs", async () => {
    writeBackup("first.sql.gz", BASE_MS);
    const findLatestBackup = createLatestBackupFinder({ clock });
    expect(findLatestBackup(dir, BASE_MS)?.name).toBe("first.sql.gz");

    writeBackup("second.sql.gz", BASE_MS + HOUR_MS);
    clockMs += LATEST_BACKUP_CACHE_TTL_MS / 2;
    expect(findLatestBackup(dir, BASE_MS)?.name).toBe("first.sql.gz");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const cached = findLatestBackup(dir, BASE_MS + 5 * HOUR_MS);
    expect(cached?.name).toBe("first.sql.gz");
    expect(cached?.ageHours).toBe(5);
  });

  it("refreshes asynchronously once the TTL has passed", async () => {
    writeBackup("first.sql.gz", BASE_MS);
    const findLatestBackup = createLatestBackupFinder({ clock });
    findLatestBackup(dir, BASE_MS);

    writeBackup("second.sql.gz", BASE_MS + HOUR_MS);
    clockMs += LATEST_BACKUP_CACHE_TTL_MS + 1;

    expect(findLatestBackup(dir, BASE_MS)?.name).toBe("first.sql.gz");
    await vi.waitFor(() => {
      expect(findLatestBackup(dir, BASE_MS + HOUR_MS)).toMatchObject({
        name: "second.sql.gz",
        ageHours: 0,
      });
    });
  });

  it("drops the cache after a failed refresh so the next call reports the error", async () => {
    writeBackup("first.sql.gz", BASE_MS);
    const findLatestBackup = createLatestBackupFinder({ clock });
    findLatestBackup(dir, BASE_MS);

    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, "not a directory");
    clockMs += LATEST_BACKUP_CACHE_TTL_MS + 1;

    expect(findLatestBackup(dir, BASE_MS)?.name).toBe("first.sql.gz");
    await vi.waitFor(() => {
      expect(() => findLatestBackup(dir, BASE_MS)).toThrow(/ENOTDIR/);
    });
  });
});
