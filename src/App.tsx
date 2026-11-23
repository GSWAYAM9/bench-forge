import { useEffect, useState } from 'react';
import { Menu, Plus } from 'lucide-react';
import type { RepositorySnapshot, TaskPackage, ValidationReport } from './lib/types';
import { SidebarNav, type WorkspaceSection } from './components/SidebarNav';
import { PackagesCatalog } from './components/PackagesCatalog';
import { PackageInspector } from './components/PackageInspector';
import { PipelineGenerator } from './components/PipelineGenerator';
import { RepositoriesView } from './components/RepositoriesView';
import { MethodologyView } from './components/MethodologyView';

interface BootstrapPayload {
  repositories: RepositorySnapshot[];
  packages: TaskPackage[];
}

export default function App() {
  const [section, setSection] = useState<WorkspaceSection>('packages');
  const [repositories, setRepositories] = useState<RepositorySnapshot[]>([]);
  const [packages, setPackages] = useState<TaskPackage[]>([]);

  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('repo-cart-core');

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const loadBootstrap = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const resp = await fetch('/api/bootstrap');
      const data = (await resp.json()) as BootstrapPayload & { error?: string };
      if (!resp.ok || !Array.isArray(data.repositories)) {
        throw new Error(data.error ?? 'Failed to load BenchForge workspace');
      }
      setRepositories(data.repositories);
      setPackages(data.packages);
      if (data.repositories[0]) {
        setSelectedRepoId(data.repositories[0].id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to connect to BenchForge API');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBootstrap();
  }, []);

  const selectedPackage = selectedPackageId
    ? packages.find((p) => p.id === selectedPackageId) ?? null
    : null;
  const selectedPackageRepo = selectedPackage
    ? repositories.find((r) => r.id === selectedPackage.repoId) ?? null
    : null;

  const handleValidationUpdated = (pkgId: string, report: ValidationReport) => {
    setPackages((prev) =>
      prev.map((pkg) => (pkg.id === pkgId ? { ...pkg, lastValidation: report } : pkg)),
    );
  };

  const handlePackageCreated = (newPkg: TaskPackage) => {
    setPackages((prev) => [newPkg, ...prev]);
  };

  const handleExportPackage = (pkg: TaskPackage) => {
    const repo = repositories.find((r) => r.id === pkg.repoId);
    const exportPayload = {
      schemaVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      taskPackage: pkg,
      repositorySnapshot: repo
        ? {
            slug: repo.slug,
            versionTag: repo.versionTag,
            commitSha: repo.commitSha,
            entryFile: repo.entryFile,
            regressionTestPath: repo.regressionTestFile.path,
          }
        : undefined,
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${pkg.id.toLowerCase()}-${pkg.repoSlug}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const breadcrumbLabel = (() => {
    if (section === 'packages' && selectedPackage) {
      return `BenchForge / Task Packages / ${selectedPackage.id}`;
    }
    if (section === 'packages') return 'BenchForge / Task Packages';
    if (section === 'generator') return 'BenchForge / Pipeline Generator';
    if (section === 'repositories') {
      const repo = repositories.find((r) => r.id === selectedRepoId);
      return repo ? `BenchForge / Repositories / ${repo.name}` : 'BenchForge / Repositories';
    }
    return 'BenchForge / Methodology';
  })();

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <SidebarNav
        activeSection={section}
        onSelectSection={(next) => {
          setSection(next);
          if (next !== 'packages') setSelectedPackageId(null);
          else setSelectedPackageId(null);
        }}
        repositories={repositories}
        packageCount={packages.length}
        selectedRepoId={selectedRepoId}
        onQuickSelectRepo={(repoId) => {
          setSelectedRepoId(repoId);
          setSelectedPackageId(null);
          setSection('repositories');
        }}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar: Breadcrumb + Single Primary CTA */}
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="text-xs font-medium text-slate-600 truncate">
              {breadcrumbLabel}
            </span>
          </div>

          {section !== 'generator' && (
            <button
              type="button"
              onClick={() => {
                setSelectedPackageId(null);
                setSection('generator');
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                selectedPackage
                  ? 'text-slate-700 bg-white border border-slate-300 hover:bg-slate-50'
                  : 'text-white bg-blue-700 hover:bg-blue-800'
              }`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New Task Package</span>
            </button>
          )}
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-8">
          {isLoading ? (
            <div className="space-y-6" aria-busy="true" aria-label="Loading workspace">
              <div className="h-7 w-48 bg-slate-200 rounded animate-pulse" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse"
                  />
                ))}
              </div>
              <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
            </div>
          ) : loadError ? (
            <div
              role="alert"
              className="bg-white border border-red-200 rounded-lg p-6 max-w-lg space-y-3"
            >
              <h2 className="text-base font-semibold text-red-900">
                Unable to load Coding Task Factory
              </h2>
              <p className="text-sm text-slate-600">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadBootstrap()}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800"
              >
                Retry Connection
              </button>
            </div>
          ) : (
            <>
              {section === 'packages' && !selectedPackage && (
                <PackagesCatalog
                  packages={packages}
                  repositories={repositories}
                  onSelectPackage={(pkgId) => setSelectedPackageId(pkgId)}
                  onOpenGenerator={() => setSection('generator')}
                  onExportPackage={handleExportPackage}
                />
              )}

              {section === 'packages' && selectedPackage && selectedPackageRepo && (
                <PackageInspector
                  key={selectedPackage.id}
                  pkg={selectedPackage}
                  repo={selectedPackageRepo}
                  onBack={() => setSelectedPackageId(null)}
                  onValidationUpdated={handleValidationUpdated}
                  onExportPackage={handleExportPackage}
                />
              )}

              {section === 'generator' && (
                <PipelineGenerator
                  repositories={repositories}
                  existingPackages={packages}
                  initialRepoId={selectedRepoId}
                  onPackageCreated={handlePackageCreated}
                  onInspectPackage={(pkgId) => {
                    setSelectedPackageId(pkgId);
                    setSection('packages');
                  }}
                  onExportPackage={handleExportPackage}
                />
              )}

              {section === 'repositories' && (
                <RepositoriesView
                  repositories={repositories}
                  selectedRepoId={selectedRepoId}
                  onSelectRepo={(repoId) => setSelectedRepoId(repoId)}
                  onGenerateForRepo={(repoId) => {
                    setSelectedRepoId(repoId);
                    setSection('generator');
                  }}
                />
              )}

              {section === 'methodology' && <MethodologyView />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
