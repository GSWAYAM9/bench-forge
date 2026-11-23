import {
  BookOpen,
  FolderGit2,
  Layers,
  Play,
  X,
} from 'lucide-react';
import type { RepositorySnapshot } from '../lib/types';

export type WorkspaceSection = 'packages' | 'generator' | 'repositories' | 'methodology';

interface SidebarNavProps {
  activeSection: WorkspaceSection;
  onSelectSection: (section: WorkspaceSection) => void;
  repositories: RepositorySnapshot[];
  packageCount: number;
  selectedRepoId?: string;
  onQuickSelectRepo: (repoId: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: WorkspaceSection;
  label: string;
  icon: typeof Layers;
}> = [
  { id: 'packages', label: 'Task Packages', icon: Layers },
  { id: 'generator', label: 'Pipeline Generator', icon: Play },
  { id: 'repositories', label: 'Repositories', icon: FolderGit2 },
  { id: 'methodology', label: 'Methodology', icon: BookOpen },
];

export function SidebarNav({
  activeSection,
  onSelectSection,
  repositories,
  packageCount,
  selectedRepoId,
  onQuickSelectRepo,
  mobileOpen,
  onCloseMobile,
}: SidebarNavProps) {
  const navContent = (
    <div className="flex h-full flex-col bg-white border-r border-slate-200">
      <div className="flex h-14 items-center justify-between px-5 border-b border-slate-200">
        <button
          type="button"
          onClick={() => {
            onSelectSection('packages');
            onCloseMobile();
          }}
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          BenchForge
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="md:hidden p-2 text-slate-500 hover:text-slate-900 rounded-md"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="Workspace navigation" className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  onCloseMobile();
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-400'}`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </span>
                {item.id === 'packages' && (
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {packageCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200 px-3">
          <h2 className="text-xs font-medium text-slate-500 mb-3">Target Repositories</h2>
          <ul className="space-y-2">
            {repositories.map((repo) => {
              const isSelected = activeSection === 'repositories' && selectedRepoId === repo.id;
              return (
                <li key={repo.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onQuickSelectRepo(repo.id);
                      onCloseMobile();
                    }}
                    className={`w-full text-left py-1.5 px-2 -mx-2 rounded-md transition-colors ${
                      isSelected ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <div className="text-sm font-medium text-slate-900 truncate">{repo.name}</div>
                    <div className="text-xs font-mono text-slate-500 tabular-nums truncate">
                      {repo.versionTag} · {repo.commitSha}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </div>
  );

  return (
    <>
      <aside className="hidden md:block w-60 shrink-0 h-screen sticky top-0">{navContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-50 w-64 max-w-[80vw] h-full">{navContent}</div>
        </div>
      )}
    </>
  );
}
