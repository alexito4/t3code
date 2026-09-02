import { useNavigate } from "@tanstack/react-router";
import { CloudIcon, ContainerIcon } from "lucide-react";
import { useMemo } from "react";

import { isElectron } from "../../env";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useThreadShells } from "../../state/entities";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useSettingsProjectGroups } from "../settings/ProjectSettingsPanel";
import { ProjectFavicon } from "../ProjectFavicon";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

interface ProjectStats {
  activeThreadCount: number;
  lastActivityAt: string | null;
}

const EMPTY_STATS: ProjectStats = { activeThreadCount: 0, lastActivityAt: null };

/** Derives per-project thread counts and last-activity by matching thread shells against each
 * group's member project refs, in a single pass rather than one query per row. */
function useProjectStatsByKey(
  groups: readonly SidebarProjectSnapshot[],
): ReadonlyMap<string, ProjectStats> {
  const threads = useThreadShells();
  return useMemo(() => {
    const projectKeyByRef = new Map<string, string>();
    for (const group of groups) {
      for (const ref of group.memberProjectRefs) {
        projectKeyByRef.set(`${ref.environmentId}:${ref.projectId}`, group.projectKey);
      }
    }
    const stats = new Map<string, ProjectStats>();
    for (const thread of threads) {
      const projectKey = projectKeyByRef.get(`${thread.environmentId}:${thread.projectId}`);
      if (!projectKey) continue;
      const existing = stats.get(projectKey) ?? { activeThreadCount: 0, lastActivityAt: null };
      const activity = thread.latestUserMessageAt ?? thread.updatedAt;
      stats.set(projectKey, {
        activeThreadCount: existing.activeThreadCount + (thread.archivedAt === null ? 1 : 0),
        lastActivityAt:
          existing.lastActivityAt === null || activity > existing.lastActivityAt
            ? activity
            : existing.lastActivityAt,
      });
    }
    return stats;
  }, [groups, threads]);
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const groups = useSettingsProjectGroups();
  const statsByKey = useProjectStatsByKey(groups);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Projects breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1>Projects</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {groups.length === 0 ? (
              <Empty className="flex-1">
                <EmptyHeader className="max-w-md">
                  <EmptyTitle className="text-foreground text-xl">No projects yet</EmptyTitle>
                  <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                    Projects you add show up here once they have a thread.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {groups.map((group) => (
                  <ProjectRow
                    key={group.projectKey}
                    group={group}
                    stats={statsByKey.get(group.projectKey) ?? EMPTY_STATS}
                    onOpen={() =>
                      void navigate({
                        to: "/projects/$projectKey",
                        params: { projectKey: group.projectKey },
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function ProjectRow({
  group,
  stats,
  onOpen,
}: {
  group: SidebarProjectSnapshot;
  stats: ProjectStats;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
      >
        <ProjectFavicon
          environmentId={group.environmentId}
          cwd={group.workspaceRoot}
          faviconPath={group.faviconPath}
          className="size-8 shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{group.displayName}</span>
            {group.groupedProjectCount > 1 ? (
              <span className="shrink-0 text-secondary-label text-xs">
                {group.groupedProjectCount} environments
              </span>
            ) : null}
            {group.environmentPresence !== "local-only" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      aria-label={
                        group.allRemoteMembersAreDesktopLocal
                          ? "Local sandbox project"
                          : "Remote project"
                      }
                      className="inline-flex shrink-0 items-center text-icon-muted"
                    />
                  }
                >
                  {group.allRemoteMembersAreDesktopLocal ? (
                    <ContainerIcon className="size-3" />
                  ) : (
                    <CloudIcon className="size-3" />
                  )}
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {group.allRemoteMembersAreDesktopLocal
                    ? `Local sandbox: ${group.remoteEnvironmentLabels.join(", ")}`
                    : `Remote environment: ${group.remoteEnvironmentLabels.join(", ")}`}
                </TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
          <span className="truncate text-xs text-muted-foreground">{group.workspaceRoot}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
          <span>
            {stats.activeThreadCount} {stats.activeThreadCount === 1 ? "thread" : "threads"}
          </span>
          <span>
            {stats.lastActivityAt ? formatRelativeTimeLabel(stats.lastActivityAt) : "No activity"}
          </span>
        </div>
      </button>
    </li>
  );
}
