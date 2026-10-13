import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Paperclip, Play } from "lucide-react";
import type { CompanyArtifact } from "@/api/artifacts";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  artifactDownloadHref,
  artifactFilename,
  artifactMetaParts,
  artifactOpenHref,
  artifactOriginLabel,
} from "@/lib/artifact-display";
import { artifactStatus } from "@/lib/artifact-status";
import { ArtifactStatusChip } from "@/components/artifacts/ArtifactStatusChip";

interface ArtifactCardProps {
  artifact: CompanyArtifact;
}

/**
 * Stable, fixed-height preview region shared by every card variant. The fixed
 * aspect ratio is what keeps image / video / text / placeholder cards from
 * shifting layout as previews load (or fail to load).
 */
function PreviewFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden bg-accent/20", className)}>
      {children}
    </div>
  );
}

function PlaceholderPreview({ label }: { label?: string }) {
  return (
    <PreviewFrame className="flex items-center justify-center">
      <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50">
        <Paperclip className="h-7 w-7" aria-hidden="true" />
        {label ? <span className="text-(length:--text-micro) font-medium uppercase tracking-wide">{label}</span> : null}
      </div>
    </PreviewFrame>
  );
}

type PreviewArtifact = Pick<CompanyArtifact, "mediaKind" | "contentPath" | "title"> & Partial<Pick<CompanyArtifact, "source" | "previewText">>;

function ImagePreview({ artifact }: { artifact: PreviewArtifact }) {
  const [errored, setErrored] = useState(false);
  if (errored || !artifact.contentPath) {
    return <PlaceholderPreview label="Image" />;
  }
  return (
    <PreviewFrame>
      <img
        src={artifact.contentPath}
        alt={artifact.title}
        loading="lazy"
        decoding="async"
        width={480}
        height={270}
        className="h-full w-full object-cover"
        onError={() => setErrored(true)}
      />
    </PreviewFrame>
  );
}

function VideoPreview({ artifact }: { artifact: PreviewArtifact }) {
  const [errored, setErrored] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const thumbnailSeekRequested = useRef(false);
  const frameReadyFallbackTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (frameReadyFallbackTimer.current !== null) {
        window.clearTimeout(frameReadyFallbackTimer.current);
      }
    };
  }, []);
  if (errored || !artifact.contentPath) {
    return (
      <PreviewFrame className="flex items-center justify-center bg-black/80">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
          <Play className="h-5 w-5 translate-x-0.5 text-white" aria-hidden="true" />
        </div>
      </PreviewFrame>
    );
  }

  const markFrameReady = () => {
    if (frameReadyFallbackTimer.current !== null) {
      window.clearTimeout(frameReadyFallbackTimer.current);
      frameReadyFallbackTimer.current = null;
    }
    setFrameReady(true);
  };
  const scheduleFrameReadyFallback = () => {
    if (frameReadyFallbackTimer.current !== null) {
      window.clearTimeout(frameReadyFallbackTimer.current);
    }
    frameReadyFallbackTimer.current = window.setTimeout(markFrameReady, 3000);
  };
  const loadThumbnailFrame = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (thumbnailSeekRequested.current) return;
    thumbnailSeekRequested.current = true;
    const video = event.currentTarget;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const seekTarget = duration > 0 ? Math.min(1, duration / 4) : 0.05;
    try {
      if (Math.abs(video.currentTime - seekTarget) > 0.001) {
        video.currentTime = seekTarget;
        scheduleFrameReadyFallback();
      } else {
        markFrameReady();
      }
    } catch {
      markFrameReady();
    }
  };
  const handleLoadedData = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (thumbnailSeekRequested.current || event.currentTarget.currentTime > 0) {
      markFrameReady();
    }
  };

  return (
    <PreviewFrame className="bg-black">
      <video
        src={artifact.contentPath}
        preload="metadata"
        muted
        playsInline
        data-frame-ready={frameReady ? "true" : "false"}
        className={cn("h-full w-full object-contain transition-opacity", frameReady ? "opacity-100" : "opacity-0")}
        onLoadedMetadata={loadThumbnailFrame}
        onLoadedData={handleLoadedData}
        onSeeked={markFrameReady}
        onError={() => setErrored(true)}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55">
          <Play className="h-5 w-5 translate-x-0.5 text-white" aria-hidden="true" />
        </div>
      </div>
    </PreviewFrame>
  );
}

function TextPreview({ artifact }: { artifact: PreviewArtifact }) {
  const preview = artifact.previewText?.trim();
  if (!preview) {
    return <PlaceholderPreview label={artifact.source === "document" ? "Document" : "Text"} />;
  }
  return (
    <PreviewFrame className="bg-card">
      <div className="absolute inset-0 overflow-hidden p-3">
        <p className="max-h-full overflow-hidden whitespace-pre-wrap break-words text-base leading-6 text-muted-foreground/75">
          {preview}
        </p>
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-card to-transparent" />
    </PreviewFrame>
  );
}

export function ArtifactPreview({ artifact }: { artifact: PreviewArtifact }) {
  switch (artifact.mediaKind) {
    case "image":
      return <ImagePreview key={artifact.contentPath} artifact={artifact} />;
    case "video":
      return <VideoPreview key={artifact.contentPath} artifact={artifact} />;
    case "text":
    case "document":
      return <TextPreview artifact={artifact} />;
    case "file":
      return <PlaceholderPreview label="File" />;
    case "empty":
    default:
      return <PlaceholderPreview />;
  }
}

/**
 * Always-visible file action (HIS-2659 item 4). Kept as a plain anchor so the
 * browser handles the download and the new-tab navigation natively.
 */
function FileAction({
  href,
  download,
  label,
  title,
  variant,
  size,
  className,
  children,
}: {
  href: string;
  download: boolean;
  label: string;
  title: string;
  variant: "default" | "outline";
  size: "sm" | "icon-sm";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a
        href={href}
        {...(download
          ? { download: "" }
          : { target: "_blank", rel: "noreferrer" })}
        aria-label={label}
        title={title}
      >
        {children}
      </a>
    </Button>
  );
}

/**
 * Artifact card (HIS-2659).
 *
 * The card is a navigation surface again, but as a *stretched overlay link*
 * instead of an outer `<Link>`: the always-visible Openen/Downloaden actions
 * must be real anchors, and anchors cannot be nested inside anchors. The
 * overlay keeps the whole card clickable and keyboard reachable while the
 * action row sits above it in the stacking order.
 */
export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const filename = artifactFilename(artifact);
  const openHref = artifactOpenHref(artifact);
  const downloadHref = artifactDownloadHref(artifact);
  const status = artifactStatus(artifact);
  const metaParts = artifactMetaParts(artifact);
  const origin = artifactOriginLabel(artifact);

  return (
    // design-allow(card-pattern): navigation card; uses a stretched overlay <Link>
    // so the visible file actions stay real anchors (no nested <a>).
    <article
      data-testid="artifact-card"
      data-media-kind={artifact.mediaKind}
      data-status-tone={status?.tone ?? "none"}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors",
        "hover:border-foreground/20 hover:shadow-md",
        "focus-within:ring-2 focus-within:ring-ring",
      )}
    >
      <Link
        to={artifact.href}
        disableIssueQuicklook
        data-artifact-overlay
        aria-label={`Openen: ${filename}`}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none"
      />

      <div className="relative">
        <ArtifactPreview artifact={artifact} />
        {status ? (
          <div className="pointer-events-none absolute left-2 top-2 z-10">
            <ArtifactStatusChip status={status} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3
          className="h-5 truncate text-sm font-medium leading-5 text-foreground/85"
          title={filename}
        >
          {filename}
        </h3>

        <p className="flex min-h-4 items-center gap-1.5 truncate text-(length:--text-micro) text-muted-foreground/65">
          {metaParts.map((part, index) => (
            <span key={part.key} className="flex items-center gap-1.5">
              {index > 0 ? <span aria-hidden="true" className="text-muted-foreground/50">·</span> : null}
              <span>{part.label}</span>
            </span>
          ))}
        </p>

        {origin ? (
          <p className="truncate text-(length:--text-micro) text-muted-foreground/55" title={origin}>
            {origin}
          </p>
        ) : null}

        {openHref || downloadHref ? (
          <div className="relative z-10 mt-1.5 flex items-center gap-1.5">
            {openHref ? (
              <FileAction
                href={openHref}
                download={false}
                label={`Openen: ${filename}`}
                title={`Openen: ${filename}`}
                variant="default"
                size="sm"
                className="flex-1 sm:flex-none"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Openen
              </FileAction>
            ) : null}
            {downloadHref ? (
              <FileAction
                href={downloadHref}
                download={downloadHref.startsWith("/")}
                label={`Downloaden: ${filename}`}
                title={`Downloaden: ${filename}`}
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Downloaden
              </FileAction>
            ) : null}
          </div>
        ) : null}
      </div>

    </article>
  );
}
