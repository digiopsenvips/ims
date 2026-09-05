import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Project, Product } from '../types';
import {
  FolderTree,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Layers,
  Sparkles,
  X,
  Pencil,
} from 'lucide-react';

export const ProjectsProductsPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Modals
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');

  const [showProductModal, setShowProductModal] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState('');
  const [productNameInput, setProductNameInput] = useState('');
  const [basePriceInput, setBasePriceInput] = useState('');

  // Edit Product Modal State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editProdName, setEditProdName] = useState('');
  const [editProdPrice, setEditProdPrice] = useState('');
  const [isUpdatingProduct, setIsUpdatingProduct] = useState(false);

  // Edit Project Modal State
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editProjName, setEditProjName] = useState('');
  const [isUpdatingProject, setIsUpdatingProject] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenEditProduct = (prod: Product) => {
    setEditingProduct(prod);
    setEditProdName(prod.name);
    setEditProdPrice(prod.basePrice !== null && prod.basePrice !== undefined ? String(prod.basePrice) : '');
  };

  const handleSaveEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !editProdName.trim()) return;

    setIsUpdatingProduct(true);
    setStatusMessage(null);

    try {
      const res = await api.put(`/products/${editingProduct.id}`, {
        name: editProdName.trim(),
        basePrice: editProdPrice !== '' ? parseFloat(editProdPrice) : null,
      });

      setStatusMessage({
        type: 'success',
        text: res?.message || `Product '${editProdName}' updated successfully!`,
      });
      setEditingProduct(null);
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to update product' });
    } finally {
      setIsUpdatingProduct(false);
    }
  };

  const handleOpenEditProject = (proj: Project) => {
    setEditingProject(proj);
    setEditProjName(proj.name);
  };

  const handleSaveEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !editProjName.trim()) return;

    setIsUpdatingProject(true);
    setStatusMessage(null);

    try {
      const res = await api.put(`/projects/${editingProject.id}`, {
        name: editProjName.trim(),
      });

      setStatusMessage({
        type: 'success',
        text: res?.message || `Project '${editProjName}' updated successfully!`,
      });
      setEditingProject(null);
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to update project' });
    } finally {
      setIsUpdatingProject(false);
    }
  };

  const fetchData = async () => {
    try {
      const [prjRes, prodRes] = await Promise.all([
        api.get('/projects'),
        api.get('/products'),
      ]);
      if (prjRes?.projects) setProjects(prjRes.projects);
      if (prodRes?.products) setProducts(prodRes.products);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to fetch catalog data' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectNameInput.trim()) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await api.post('/projects', { name: projectNameInput });
      setStatusMessage({
        type: 'success',
        text: `Project '${res.project.name}' created with code '${res.project.code}'.`,
      });
      setProjectNameInput('');
      setShowProjectModal(false);
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create project' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProjectId || !productNameInput.trim()) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await api.post(`/projects/${targetProjectId}/products`, {
        name: productNameInput,
        basePrice: basePriceInput ? parseFloat(basePriceInput) : undefined,
      });

      setStatusMessage({
        type: 'success',
        text: `Product '${res.product.name}' created with Auto-Generated ID: ${res.product.id}!`,
      });

      setProductNameInput('');
      setBasePriceInput('');
      setShowProductModal(false);
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create product' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProduct = async (productId: string, productName: string) => {
    if (!window.confirm(`Are you sure you want to delete product '${productName}' (${productId})?`)) {
      return;
    }

    try {
      await api.delete(`/products/${productId}`);
      setStatusMessage({ type: 'success', text: `Product '${productName}' deleted successfully.` });
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Cannot delete product' });
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const proj = projects.find(p => p.id === projectId);
    const projName = proj ? proj.name : 'this project';

    if (!window.confirm(`Are you sure you want to delete project '${projName}'? Any products and stock under it will also be deleted.`)) {
      return;
    }

    try {
      const res = await api.delete(`/projects/${projectId}`);
      setStatusMessage({ type: 'success', text: res?.message || `Project '${projName}' deleted successfully.` });
      setSelectedProjectId('all');
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to delete project' });
    }
  };

  const filteredProducts =
    selectedProjectId === 'all'
      ? products
      : products.filter(p => p.projectId === selectedProjectId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-slate-800" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Projects & Products
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage product lines (Tahsin, Upcycle) with auto-generated product IDs (e.g. TAH-001, UPC-001)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProjectModal(true)}
            className="px-3 py-2 text-xs font-semibold rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Project</span>
          </button>

          <button
            onClick={() => {
              if (projects.length > 0 && !targetProjectId) {
                setTargetProjectId(projects[0].id);
              }
              setShowProductModal(true);
            }}
            className="px-3.5 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-md text-xs flex items-center justify-between border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Project Filter Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedProjectId('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
              selectedProjectId === 'all'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All Projects ({products.length})
          </button>
          {projects.map(p => {
            const count = products.filter(prod => prod.projectId === p.id).length;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
                  selectedProjectId === p.id
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {p.name} ({count})
              </button>
            );
          })}
        </div>

        {selectedProjectId !== 'all' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const proj = projects.find(p => p.id === selectedProjectId);
                if (proj) handleOpenEditProject(proj);
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              title={`Rename ${projects.find(p => p.id === selectedProjectId)?.name} project`}
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Rename Project</span>
            </button>
            <button
              onClick={() => handleDeleteProject(selectedProjectId)}
              className="px-3 py-1.5 text-xs font-semibold rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              title={`Delete ${projects.find(p => p.id === selectedProjectId)?.name} project`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete "{projects.find(p => p.id === selectedProjectId)?.name}"</span>
            </button>
          </div>
        )}
      </div>

      {/* Products Table */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Auto Product ID</th>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3 text-right">Base Price (₹)</th>
                <th className="px-4 py-3 text-right">Stock On Hand</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No products found under this project. Click "Add Product" above to create one.
                  </td>
                </tr>
              ) : (
                filteredProducts.map(prod => (
                  <tr key={prod.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      {prod.id}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {prod.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 border border-slate-200">
                        {prod.project?.name || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      {prod.basePrice !== null && prod.basePrice !== undefined
                        ? `₹${Number(prod.basePrice).toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {prod.inventory ? prod.inventory.quantityOnHand : 0}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleOpenEditProduct(prod)}
                          className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                          title="Edit product name and price"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(prod.id, prod.name)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                          title="Delete product"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create Project */}
      {showProjectModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-md max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Create New Project</h3>
              <button
                onClick={() => setShowProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Project Name (e.g. Tahsin, Upcycle)
                </label>
                <input
                  type="text"
                  required
                  value={projectNameInput}
                  onChange={e => setProjectNameInput(e.target.value)}
                  placeholder="Enter project name"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  A unique 3-letter prefix (e.g., TAH, UPC) will be automatically assigned for product ID generation.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProjectModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm"
                >
                  {isSubmitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Product */}
      {showProductModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-md max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Add Product Under Project</h3>
              </div>
              <button
                onClick={() => setShowProductModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Select Project
                </label>
                <select
                  required
                  value={targetProjectId}
                  onChange={e => setTargetProjectId(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Prefix: {p.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Product Name
                </label>
                <input
                  type="text"
                  required
                  value={productNameInput}
                  onChange={e => setProductNameInput(e.target.value)}
                  placeholder="e.g. Tahsin Lavender Candle"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Base / Reference Price (₹, optional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={basePriceInput}
                  onChange={e => setBasePriceInput(e.target.value)}
                  placeholder="e.g. 250.00"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  The product ID (e.g. TAH-004) will be <span className="font-semibold text-emerald-700">automatically generated</span> on save.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm"
                >
                  {isSubmitting ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Product */}
      {editingProduct && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Edit Product</h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  ID: <span className="font-bold text-slate-800">{editingProduct.id}</span> • {editingProduct.project?.name}
                </p>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditProduct} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Product Name
                </label>
                <input
                  type="text"
                  required
                  value={editProdName}
                  onChange={e => setEditProdName(e.target.value)}
                  placeholder="e.g. Scrunchie"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Base / Reference Price (₹, optional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editProdPrice}
                  onChange={e => setEditProdPrice(e.target.value)}
                  placeholder="e.g. 150.00"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  disabled={isUpdatingProduct}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingProduct}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {isUpdatingProduct ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Rename Project */}
      {editingProject && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Rename Project</h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  Code: <span className="font-bold text-slate-800">{editingProject.code}</span>
                </p>
              </div>
              <button
                onClick={() => setEditingProject(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditProject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={editProjName}
                  onChange={e => setEditProjName(e.target.value)}
                  placeholder="e.g. Tahsin"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProject(null)}
                  disabled={isUpdatingProject}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingProject}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {isUpdatingProject ? 'Saving...' : 'Rename Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
