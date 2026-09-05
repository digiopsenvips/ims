'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createProduct } from '@/actions/products';
import { getAllProjects } from '@/actions/projects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeftIcon } from 'lucide-react';
import type { Project } from '@prisma/client';

export default function NewProductPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const data = await getAllProjects();
        setProjects(data);
      } catch {
        setError('Failed to load projects');
      }
    };
    loadProjects();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await createProduct({
        name: name.trim(),
        productCode: productCode.trim(),
        projectId,
      });
      router.push('/admin/products');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/admin/products" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to Products
      </Link>

      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Create Product</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-slate-700">Project *</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
            disabled={loading}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} ({project.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Product Name *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Bamboo Pen"
            required
            disabled={loading}
            className="mt-1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Product Code *</label>
          <Input
            value={productCode}
            onChange={(e) => setProductCode(e.target.value.toUpperCase())}
            placeholder="e.g., PEN001"
            required
            disabled={loading}
            className="mt-1 font-mono uppercase"
          />
          <p className="mt-1 text-xs text-slate-500">Uppercase letters and numbers only</p>
        </div>

        <div className="flex gap-3 pt-4">
          <Link
            href="/admin/products"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={loading || !projectId}>
            {loading ? 'Creating...' : 'Create Product'}
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
