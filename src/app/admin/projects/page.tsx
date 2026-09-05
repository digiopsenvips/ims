import Link from 'next/link';
import { getAllProjects } from '@/actions/projects';
import { Button } from '@/components/ui/button';
import { PlusIcon } from 'lucide-react';

export default async function ProjectsPage() {
  const projects = await getAllProjects();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-slate-600">{projects.length} projects in the system</p>
        </div>
        <Link href="/admin/projects/new">
          <Button className="gap-2">
            <PlusIcon className="h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      <div className="space-y-3">
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-12 text-center">
            <p className="text-slate-600">No projects yet. Create your first project to get started.</p>
          </div>
        ) : (
          projects.map((project) => (
            <Link key={project.id} href={`/admin/projects/${project.id}`}>
              <div className="cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
                <div className="flex items-start justify-between p-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold">{project.name}</h2>
                      <span className="inline-block rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-medium text-slate-700">
                        {project.code}
                      </span>
                      {!project.isActive && (
                        <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="mt-2 text-sm text-slate-600">{project.description}</p>
                    )}
                  </div>
                  <div className="ml-4 text-right">
                    <div className="text-lg font-semibold">{project.products.length}</div>
                    <div className="text-xs text-slate-500">products</div>
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
