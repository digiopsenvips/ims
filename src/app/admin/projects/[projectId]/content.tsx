'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Project, Product } from '@prisma/client';
import { updateProject, deactivateProject } from '@/actions/projects';
import { deactivateProduct } from '@/actions/products';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TrashIcon, ChevronLeftIcon } from 'lucide-react';

interface Props {
  project: Project & { products: Product[] };
}

export default function ProjectDetailContent({ project: initialProject }: Props) {
  const [project, setProject] = useState(initialProject);
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(project.code);
  const [description, setDescription] = useState(project.description || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await updateProject({
        id: project.id,
        name: name.trim(),
        code: code.trim(),
        description: description.trim() || null,
      });
      setProject({ ...project, name, code, description });
      setEditMode(false);
      setSuccess('Project updated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project');
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!confirm('Are you sure you want to deactivate this project?')) return;

    setLoading(true);
    setError(null);

    try {
      await deactivateProject(project.id);
      setProject({ ...project, isActive: false });
      setSuccess('Project deactivated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate project');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm('Are you sure you want to deactivate this product?')) return;

    setLoading(true);
    setError(null);

    try {
      await deactivateProduct(productId);
      setProject({
        ...project,
        products: project.products.map((p) =>
          p.id === productId ? { ...p, isActive: false } : p
        ),
      });
      setSuccess('Product deactivated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/projects" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to Projects
      </Link>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-slate-600">Code: {project.code}</p>
        </div>
        <div className="flex gap-2">
          {editMode ? (
            <>
              <Button variant="outline" onClick={() => setEditMode(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditMode(true)}>
                Edit
              </Button>
              {project.isActive && (
                <Button variant="destructive" onClick={handleDeactivate} disabled={loading}>
                  Deactivate
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          {success}
        </div>
      )}

      {editMode ? (
        <div className="mb-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div>
            <label className="block text-sm font-medium text-slate-700">Project Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              disabled={loading}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Project Code</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g., TAH"
              disabled={loading}
              className="mt-1 font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Project description (optional)"
              disabled={loading}
              className="mt-1"
            />
          </div>
        </div>
      ) : (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6">
          {project.description ? (
            <p className="text-slate-700">{project.description}</p>
          ) : (
            <p className="italic text-slate-500">No description provided</p>
          )}
        </div>
      )}

      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Products</h2>
          <Link href={`/admin/products/new?projectId=${project.id}`}>
            <Button size="sm">Add Product</Button>
          </Link>
        </div>

        <div className="space-y-2">
          {project.products.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-slate-600">No products in this project yet.</p>
            </div>
          ) : (
            project.products.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
              >
                <div>
                  <p className="font-medium">{product.name}</p>
                  <p className="text-sm text-slate-500 font-mono">{product.productCode}</p>
                </div>
                <div className="flex items-center gap-3">
                  {!product.isActive && (
                    <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
                      Inactive
                    </span>
                  )}
                  {product.isActive && (
                    <button
                      onClick={() => handleDeleteProduct(product.id)}
                      disabled={loading}
                      className="text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
