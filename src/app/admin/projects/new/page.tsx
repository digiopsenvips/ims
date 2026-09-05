'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createProject } from '@/actions/projects';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeftIcon } from 'lucide-react';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const project = await createProject({
        name: name.trim(),
        code: code.trim(),
        description: description.trim() || null,
      });
      router.push(`/admin/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/admin/projects" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to Projects
      </Link>

      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Create Project</h1>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-slate-700">Project Name *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Tahsin"
            required
            disabled={loading}
            className="mt-1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Project Code *</label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g., TAH"
            required
            disabled={loading}
            className="mt-1 font-mono uppercase"
            maxLength={10}
          />
          <p className="mt-1 text-xs text-slate-500">Uppercase letters only, max 10 characters</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this project does (optional)"
            disabled={loading}
            className="mt-1"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <Link
            href="/admin/projects"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Project'}
          </Button>
        </div>
      </form>
    </div>
  );
}
