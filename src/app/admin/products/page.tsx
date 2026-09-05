import Link from 'next/link';
import { getAllProducts } from '@/actions/products';
import { getAllProjects } from '@/actions/projects';
import { Button } from '@/components/ui/button';
import { PlusIcon } from 'lucide-react';

export default async function ProductsPage() {
  const products = await getAllProducts();
  const projects = await getAllProjects();

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Admin</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-slate-600">{products.length} products across all projects</p>
        </div>
        <Link href="/admin/products/new">
          <Button className="gap-2">
            <PlusIcon className="h-4 w-4" />
            New Product
          </Button>
        </Link>
      </div>

      <div className="space-y-3">
        {products.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-12 text-center">
            <p className="text-slate-600">No products yet. Create your first product to get started.</p>
          </div>
        ) : (
          products.map((product) => {
            const project = projectMap.get(product.projectId);
            return (
              <div
                key={product.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between p-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold">{product.name}</h2>
                      <span className="inline-block rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-medium text-slate-700">
                        {product.productCode}
                      </span>
                      {!product.isActive && (
                        <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    {project && (
                      <p className="mt-2 text-sm text-slate-600">
                        Project:{' '}
                        <Link href={`/admin/projects/${project.id}`} className="font-medium hover:underline">
                          {project.name}
                        </Link>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
