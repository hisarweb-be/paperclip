export type CompanyArtifactSource = "document" | "attachment" | "work_product";

export type CompanyArtifactMediaKind = "image" | "video" | "text" | "document" | "file" | "empty";

export type CompanyArtifactGroupBy = "none" | "task" | "parent_task";

/**
 * Ordering accepted by the company artifacts list. The server sorts on
 * `createdAt` and breaks ties on the artifact id, which is also the cursor key
 * pair, so paging stays stable while artifacts are updated.
 */
export type CompanyArtifactSort = "createdAt:desc" | "createdAt:asc";

export interface CompanyArtifactIssueSummary {
  id: string;
  identifier: string;
  title: string;
}

export interface CompanyArtifactProjectSummary {
  id: string;
  name: string;
}

export interface CompanyArtifactAgentSummary {
  id: string;
  name: string;
}

export interface CompanyArtifact {
  id: string;
  source: CompanyArtifactSource;
  mediaKind: CompanyArtifactMediaKind;
  title: string;
  previewText: string | null;
  contentType: string | null;
  contentPath: string | null;
  openPath: string | null;
  downloadPath: string | null;
  issue: CompanyArtifactIssueSummary;
  project: CompanyArtifactProjectSummary | null;
  createdByAgent: CompanyArtifactAgentSummary | null;
  /** Creation time; the server sorts and pages artifact lists on this field. */
  createdAt: string;
  updatedAt: string;
  href: string;
  /**
   * Source-specific fields the server always returns (nullable when the source
   * has no such value). They stay optional in this type so an older server
   * response stays assignable while the API rolls out.
   */
  byteSize?: number | null;
  originalFilename?: string | null;
  summary?: string | null;
  status?: string | null;
  reviewState?: string | null;
  healthStatus?: string | null;
  isPrimary?: boolean | null;
  provider?: string | null;
  createdByRunId?: string | null;
  issueId?: string;
  projectId?: string | null;
}

export interface CompanyArtifactGroup {
  id: string;
  groupBy: Exclude<CompanyArtifactGroupBy, "none">;
  issue: CompanyArtifactIssueSummary;
  title: string;
  count: number;
  mediaKinds: CompanyArtifactMediaKind[];
  previewArtifacts: CompanyArtifact[];
  /** Creation time of the newest artifact in the group; the group cursor key. */
  createdAt?: string;
  updatedAt: string;
  href: string;
}

export interface CompanyArtifactsResponse {
  artifacts: CompanyArtifact[];
  groups?: CompanyArtifactGroup[];
  selectedGroup?: CompanyArtifactGroup | null;
  nextCursor: string | null;
}
