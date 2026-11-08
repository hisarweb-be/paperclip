import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type DatabaseBackupHealthWarningCode =
  | "database_backup_check_failed"
  | "database_backup_last_failure"
  | "database_backup_missing"
  | "database_backup_stale";

export type DatabaseBackupHealthWarning = {
  code: DatabaseBackupHealthWarningCode;
  message: string;
};

export type DatabaseBackupHealthStatus = {
  enabled: boolean;
  status: "ok" | "warning";
  backupDir: string;
  maxAgeHours: number;
  latestBackup: {
    name: string;
    path: string;
    mtime: string;
    ageHours: number;
    sizeBytes: number;
  } | null;
  lastFailure: {
    path: string;
    mtime: string;
    message: string;
  } | null;
  warnings: DatabaseBackupHealthWarning[];
};

export type InspectDatabaseBackupHealthOptions = {
  enabled: boolean;
  backupDir: string;
  maxAgeHours: number;
  alertFile?: string;
  alertFiles?: string[];
  now?: Date;
};

function roundHours(value: number): number {
  return Math.round(value * 10) / 10;
}

function alertFileCandidates(opts: InspectDatabaseBackupHealthOptions) {
  return [...new Set([
    opts.alertFile,
    ...(opts.alertFiles ?? []),
    join(opts.backupDir, "db-backup-to-s3.failure"),
    resolve(opts.backupDir, "..", "db-backup-to-s3.failure"),
  ].filter((value): value is string => Boolean(value)))];
}

function readLastFailure(alertFiles: string[]) {
  const failures = alertFiles
    .filter((alertFile) => existsSync(alertFile))
    .map((alertFile) => {
      const stat = statSync(alertFile);
      const message = readFileSync(alertFile, "utf8").trim().split(/\r?\n/)[0] ||
        "Database backup failure marker is present.";
      return {
        path: alertFile,
        mtime: new Date(stat.mtimeMs).toISOString(),
        mtimeMs: stat.mtimeMs,
        message,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const latest = failures[0];
  if (!latest) return null;
  return {
    path: latest.path,
    mtime: latest.mtime,
    message: latest.message,
  };
}

type RawLatestBackup = {
  name: string;
  path: string;
  mtimeMs: number;
  sizeBytes: number;
};

function toLatestBackup(
  raw: RawLatestBackup | null,
  nowMs: number,
): DatabaseBackupHealthStatus["latestBackup"] {
  if (!raw) return null;
  return {
    name: raw.name,
    path: raw.path,
    mtime: new Date(raw.mtimeMs).toISOString(),
    ageHours: roundHours((nowMs - raw.mtimeMs) / 3_600_000),
    sizeBytes: raw.sizeBytes,
  };
}

function scanLatestBackupSync(backupDir: string): RawLatestBackup | null {
  if (!existsSync(backupDir)) return null;

  const candidates = readdirSync(backupDir)
    .filter((name) => name.endsWith(".sql.gz"))
    .map((name) => {
      const fullPath = join(backupDir, name);
      const stat = statSync(fullPath);
      return { fullPath, name, stat };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const latest = candidates[0];
  if (!latest) return null;

  return {
    name: basename(latest.fullPath),
    path: latest.fullPath,
    mtimeMs: latest.stat.mtimeMs,
    sizeBytes: latest.stat.size,
  };
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

// Stats one file at a time so a large backup directory on a slow mount does not
// flood the libuv thread pool. Files removed between readdir and stat are skipped.
async function scanLatestBackup(backupDir: string): Promise<RawLatestBackup | null> {
  let names: string[];
  try {
    names = await readdir(backupDir);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }

  let latest: RawLatestBackup | null = null;
  for (const name of names) {
    if (!name.endsWith(".sql.gz")) continue;
    const fullPath = join(backupDir, name);
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = { name, path: fullPath, mtimeMs: fileStat.mtimeMs, sizeBytes: fileStat.size };
    }
  }
  return latest;
}

/** Minimum time between background rescans of a backup directory. */
export const LATEST_BACKUP_CACHE_TTL_MS = 60_000;

export type LatestBackupFinderOptions = {
  ttlMs?: number;
  /** Clock used for cache expiry; independent of the `nowMs` used for backup age. */
  clock?: () => number;
};

type LatestBackupCacheEntry = {
  raw: RawLatestBackup | null;
  refreshedAt: number;
  refreshing: boolean;
};

/**
 * Returns a latest-backup lookup that scans synchronously only on the first call per
 * directory. Later calls are served from a cache that is refreshed in the background at
 * most once per `ttlMs`, so health requests no longer block the event loop on a
 * readdir plus a stat of every backup file. Age is recomputed from `nowMs` on every
 * call. A failed refresh drops the cache entry, so the next call scans synchronously
 * again and surfaces the error.
 */
export function createLatestBackupFinder(opts: LatestBackupFinderOptions = {}) {
  const ttlMs = opts.ttlMs ?? LATEST_BACKUP_CACHE_TTL_MS;
  const clock = opts.clock ?? Date.now;
  const cache = new Map<string, LatestBackupCacheEntry>();

  const refresh = (backupDir: string, entry: LatestBackupCacheEntry) => {
    entry.refreshing = true;
    void scanLatestBackup(backupDir)
      .then(
        (raw) => {
          if (cache.get(backupDir) !== entry) return;
          entry.raw = raw;
          entry.refreshedAt = clock();
        },
        () => {
          if (cache.get(backupDir) === entry) cache.delete(backupDir);
        },
      )
      .finally(() => {
        entry.refreshing = false;
      });
  };

  return function findLatestBackup(backupDir: string, nowMs: number) {
    let entry = cache.get(backupDir);
    if (!entry) {
      entry = { raw: scanLatestBackupSync(backupDir), refreshedAt: clock(), refreshing: false };
      cache.set(backupDir, entry);
    } else if (!entry.refreshing && clock() - entry.refreshedAt >= ttlMs) {
      refresh(backupDir, entry);
    }
    return toLatestBackup(entry.raw, nowMs);
  };
}

const findLatestBackup = createLatestBackupFinder();

export function inspectDatabaseBackupHealth(
  opts: InspectDatabaseBackupHealthOptions,
): DatabaseBackupHealthStatus {
  const warnings: DatabaseBackupHealthWarning[] = [];
  const now = opts.now ?? new Date();
  const maxAgeHours = Math.max(1, opts.maxAgeHours);

  let latestBackup: DatabaseBackupHealthStatus["latestBackup"] = null;
  let lastFailure: DatabaseBackupHealthStatus["lastFailure"] = null;

  try {
    latestBackup = findLatestBackup(opts.backupDir, now.getTime());
    lastFailure = readLastFailure(alertFileCandidates(opts));

    if (!latestBackup) {
      warnings.push({
        code: "database_backup_missing",
        message: `No .sql.gz database backups found in ${opts.backupDir}.`,
      });
    } else if (latestBackup.ageHours > maxAgeHours) {
      warnings.push({
        code: "database_backup_stale",
        message: `Latest database backup is ${latestBackup.ageHours}h old, exceeding ${maxAgeHours}h.`,
      });
    }

    if (lastFailure) {
      warnings.push({
        code: "database_backup_last_failure",
        message: lastFailure.message,
      });
    }
  } catch (error) {
    warnings.push({
      code: "database_backup_check_failed",
      message: `Database backup health check failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return {
    enabled: opts.enabled,
    status: warnings.length > 0 ? "warning" : "ok",
    backupDir: opts.backupDir,
    maxAgeHours,
    latestBackup,
    lastFailure,
    warnings,
  };
}
