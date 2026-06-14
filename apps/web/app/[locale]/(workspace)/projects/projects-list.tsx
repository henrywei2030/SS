'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, FolderClosed, Search, Pencil } from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateProjectDialog, type EditableProject } from './create-project-dialog';
import { cn } from '@/lib/utils';

export function ProjectsList(): React.ReactElement {
  const t = useTranslations();
  const params = useParams<{ locale: string }>();
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [editProject, setEditProject] = React.useState<EditableProject | null>(null);

  const { data, isLoading, refetch } = trpc.project.list.useQuery({
    search: search || undefined,
  });

  return (
    <div className="animate-in-fade">
      {/* Header — 极简 */}
      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-[20px] font-semibold tracking-tight">Projects</h1>
        <span className="rounded bg-[hsl(var(--color-secondary))] px-1.5 py-0.5 text-[11px] text-[hsl(var(--color-muted-foreground))]">
          {data?.length ?? 0}
        </span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--color-muted-foreground))]" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 pl-7"
          />
        </div>
        <Button onClick={() => setOpen(true)} size="default" className="gap-1.5">
          <Plus className="size-3.5" />
          New
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <ProjectListSkeleton />
      ) : data && data.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[hsl(var(--color-border))]">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_120px_100px_140px_160px_80px_44px] gap-3 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-2 text-[11px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            <div>Name</div>
            <div>Type</div>
            <div>Aspect</div>
            <div>Updated</div>
            <div>Team</div>
            <div className="text-right">Stats</div>
            <div />
          </div>

          {/* Table rows */}
          <div className="row-divider">
            {data.map((p) => (
              <Link
                key={p.id}
                href={`/${params.locale}/projects/${p.id}`}
                className="group grid grid-cols-[1fr_120px_100px_140px_160px_80px_44px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[hsl(var(--color-card))] focus:bg-[hsl(var(--color-card))] focus:outline-none"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--color-success))]" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{p.name}</div>
                    {p.description && (
                      <div className="truncate text-[11px] text-[hsl(var(--color-muted-foreground))]">
                        {p.description}
                      </div>
                    )}
                  </div>
                </div>
                <Badge variant="default">{t(`enums.projectType.${p.type}`)}</Badge>
                <span className="font-mono text-[12px] text-[hsl(var(--color-muted-foreground))]">
                  {p.aspect}
                </span>
                <span className="text-[12px] text-[hsl(var(--color-muted-foreground))]">
                  {timeAgo(p.updatedAt as unknown as Date)}
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="flex -space-x-1">
                    {p.members.slice(0, 3).map((m) => (
                      <Avatar
                        key={m.user.id}
                        className="h-5 w-5 border border-[hsl(var(--color-background))]"
                      >
                        <AvatarFallback className="text-[9px]">
                          {m.user.displayName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                  {p._count.members > 3 && (
                    <span className="text-[11px] text-[hsl(var(--color-muted-foreground))]">
                      +{p._count.members - 3}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 font-mono text-[11px] text-[hsl(var(--color-muted-foreground))]">
                  <span title="集">{p._count.episodes}E</span>
                  <span className="opacity-30">·</span>
                  <span title="资产">{p._count.assets}A</span>
                </div>
                <button
                  type="button"
                  title="编辑项目"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditProject({
                      id: p.id,
                      name: p.name,
                      type: p.type,
                      aspect: p.aspect,
                      description: p.description,
                      styleId: p.styleId,
                    });
                  }}
                  className="flex size-7 items-center justify-center rounded-md text-[hsl(var(--color-muted-foreground))] opacity-0 transition hover:bg-[hsl(var(--color-secondary))] hover:text-[hsl(var(--color-foreground))] focus:opacity-100 focus:outline-none group-hover:opacity-100"
                >
                  <Pencil className="size-3.5" />
                </button>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <Empty onCreate={() => setOpen(true)} />
      )}

      <CreateProjectDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={() => {
          void refetch();
          setOpen(false);
        }}
      />
      <CreateProjectDialog
        open={!!editProject}
        project={editProject}
        onOpenChange={(v) => {
          if (!v) setEditProject(null);
        }}
        onCreated={() => {
          void refetch();
          setEditProject(null);
        }}
      />
    </div>
  );
}

function ProjectListSkeleton(): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-[hsl(var(--color-border))]">
      <div className="row-divider">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_120px_100px_140px_160px_80px_44px] items-center gap-3 px-3 py-2.5"
          >
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-12 ml-auto" />
            <Skeleton className="h-4 w-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ onCreate }: { onCreate: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[hsl(var(--color-border))] py-16 text-center">
      <FolderClosed className={cn('size-8 text-[hsl(var(--color-muted-foreground))]')} />
      <p className="mt-4 text-[13px] text-[hsl(var(--color-muted-foreground))]">
        No projects yet
      </p>
      <Button onClick={onCreate} className="mt-4 gap-1.5">
        <Plus className="size-3.5" />
        Create project
      </Button>
    </div>
  );
}

function timeAgo(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}
