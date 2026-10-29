import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Project, Product } from '../types';
import {
  FolderTree,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  X,
  Pencil,
  Gift,
  ArrowRight,
  Archive,
  ArchiveRestore,
  Search,
  RotateCcw,
  Package,
} from 'lucide-react';

export const ProjectsProductsPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'RETIRED' | 'ALL'>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState<string>('');
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

  // Delete Confirmation Modal State
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const confirmDeleteProduct = async () => {
    if (!productToDelete) return;
    setIsDeleting(true);

    try {
      const res = await api.delete(`/products/${productToDelete.id}`);
      setStatusMessage({
        type: 'success',
        text: res?.message || `Product '${productToDelete.name}' deleted successfully.`,
      });
      setProductToDelete(null);
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Cannot delete product' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleArchiveProduct = async (prod: Product) => {
    const action = prod.isArchived ? 'restore' : 'retire';
    const confirmMsg = prod.isArchived
      ? `Reactivate product '${prod.name}' (${prod.id})? It will appear in active product listings again.`
      : `Retire product '${prod.name}' (${prod.id})? It will be safely hidden from active sales and events, but all historical sales, line items, and receipts will remain permanently intact.`;

    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      await api.put(`/products/${prod.id}`, {
        isArchived: !prod.isArchived,
      });
      setStatusMessage({
        type: 'success',
        text: `Product '${prod.name}' (${prod.id}) has been ${prod.isArchived ? 'restored to active products' : 'safely retired'}.`,
      });
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || `Failed to ${action} product` });
    }
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);

    try {
      const res = await api.delete(`/projects/${projectToDelete.id}`);
      setStatusMessage({
        type: 'success',
        text: res?.message || `Project '${projectToDelete.name}' deleted successfully.`,
      });
      setSelectedProjectId('all');
      setProjectToDelete(null);
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to delete project' });
    } finally {
      setIsDeleting(false);
    }
  };

  // Status and project-based product filtering
  const activeProductsCount = useMemo(() => products.filter(p => !p.isArchived).length, [products]);
  const retiredProductsCount = useMemo(() => products.filter(p => !!p.isArchived).length, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (selectedProjectId !== 'all' && p.projectId !== selectedProjectId) {
        return false;
      }
      if (statusFilter === 'ACTIVE' && p.isArchived) return false;
      if (statusFilter === 'RETIRED' && !p.isArchived) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesId = p.id.toLowerCase().includes(query);
        const matchesProject = (p.project?.name || '').toLowerCase().includes(query);
        if (!matchesName && !matchesId && !matchesProject) return false;
      }

      return true;
    });
  }, [products, selectedProjectId, statusFilter, searchQuery]);

  return (
    <div className="space-y-5 w-full max-w-[1600px] mx-auto pb-12">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/70 flex items-center justify-center font-black shadow-xs shrink-0">
            <FolderTree className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Products
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Catalog management for Tahsin & Upcycle initiatives with auto-generated coded IDs.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
          <Link
            to="/combos?action=create"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
          >
            <Gift className="w-3.5 h-3.5 text-emerald-600" />
            <span>Create Combo Offer</span>
          </Link>

          <button
            onClick={() => setShowProjectModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
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
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Combos Promotional Notice Banner */}
      <div className="p-3.5 sm:p-4 bg-emerald-50/50 border border-emerald-200/70 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2 bg-emerald-100/70 text-emerald-700 rounded-xl shrink-0 border border-emerald-200/60">
            <Gift className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                Looking to create a Combo Deal or Multi-Buy Offer?
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                NEW
              </span>
            </div>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Combos are dynamic promotional bundles that automatically deduct individual component products from your live stall inventory when sold.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <Link
            to="/combos?action=create"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Combo Offer</span>
          </Link>
          <Link
            to="/combos"
            className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <span>View All Combos</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Notifications */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
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

      {/* Search and Project Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        {/* Top Filter Bar: Search + Status Tabs */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by product name, auto ID (e.g. TAH-001), or project..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Right Status Filter Tabs: Active | Retired | All */}
          <div className="flex items-center gap-1.5 self-start md:self-auto flex-wrap">
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs">
              <button
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-white text-emerald-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({activeProductsCount})
              </button>
              <button
                onClick={() => setStatusFilter('RETIRED')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  statusFilter === 'RETIRED'
                    ? 'bg-white text-amber-800 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Retired ({retiredProductsCount})
              </button>
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({products.length})
              </button>
            </div>

            {selectedProjectId !== 'all' && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const proj = projects.find(p => p.id === selectedProjectId);
                    if (proj) handleOpenEditProject(proj);
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title={`Rename ${projects.find(p => p.id === selectedProjectId)?.name} project`}
                >
                  <Pencil className="w-3 h-3 text-slate-500" />
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const proj = projects.find(p => p.id === selectedProjectId);
                    if (proj) setProjectToDelete(proj);
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="Delete project"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Project Filter Pills */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none flex-1">
            <button
              onClick={() => setSelectedProjectId('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                selectedProjectId === 'all'
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
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
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                    selectedProjectId === p.id
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {p.name} ({count})
                </button>
              );
            })}
          </div>

          <div className="text-xs text-slate-500 font-medium shrink-0">
            Showing <strong className="text-slate-900">{filteredProducts.length}</strong> of{' '}
            <strong className="text-slate-900">{products.length}</strong> products
          </div>
        </div>
      </div>

      {/* Products Table Container */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[960px] border-collapse">
            <thead className="bg-slate-50/90 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th scope="col" className="px-4 py-3.5 whitespace-nowrap w-[130px]">Auto Product ID</th>
                <th scope="col" className="px-4 py-3.5 min-w-[200px]">Product Name</th>
                <th scope="col" className="px-4 py-3.5 whitespace-nowrap w-[140px]">Project</th>
                <th scope="col" className="px-4 py-3.5 whitespace-nowrap w-[110px]">Status</th>
                <th scope="col" className="px-4 py-3.5 text-right whitespace-nowrap w-[120px]">Base Price (₹)</th>
                <th scope="col" className="px-4 py-3.5 text-right whitespace-nowrap w-[130px]">Stock On Hand</th>
                <th scope="col" className="px-4 py-3.5 text-center whitespace-nowrap w-[110px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center text-slate-400">
                    <Package className="w-6 h-6 mx-auto mb-2 animate-bounce text-slate-400" />
                    <p className="font-medium text-slate-600">Loading catalog products...</p>
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="max-w-sm mx-auto space-y-2">
                      <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-1">
                        <Search className="w-5 h-5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">No matching products</h3>
                      <p className="text-xs text-slate-500">
                        No catalog items match your selected project, status, or search query.
                      </p>
                      {(searchQuery || selectedProjectId !== 'all' || statusFilter !== 'ACTIVE') && (
                        <div className="pt-2">
                          <button
                            onClick={() => {
                              setSearchQuery('');
                              setSelectedProjectId('all');
                              setStatusFilter('ACTIVE');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reset Filters</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map(prod => (
                  <tr
                    key={prod.id}
                    className={`transition-colors hover:bg-slate-50/70 ${
                      prod.isArchived ? 'bg-slate-50/40 opacity-80' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5 whitespace-nowrap align-middle">
                      <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200/80 text-xs inline-block tracking-tight whitespace-nowrap shadow-2xs">
                        {prod.id}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-900 min-w-[200px] align-middle">
                      <div className="flex items-center gap-2">
                        <span className="line-clamp-2 leading-snug">{prod.name}</span>
                        {prod.isArchived && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200 rounded whitespace-nowrap shrink-0">
                            Retired
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap align-middle">
                      <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/80 inline-block whitespace-nowrap">
                        {prod.project?.name || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap align-middle">
                      {prod.isArchived ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Retired
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-slate-900 whitespace-nowrap font-mono align-middle">
                      {prod.basePrice !== null && prod.basePrice !== undefined
                        ? `₹${Number(prod.basePrice).toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-slate-900 whitespace-nowrap font-mono align-middle">
                      <span
                        className={
                          (prod.inventory?.quantityOnHand ?? 0) <= 5
                            ? 'text-amber-800'
                            : 'text-slate-900'
                        }
                      >
                        {prod.inventory ? prod.inventory.quantityOnHand : 0}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center whitespace-nowrap align-middle">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleOpenEditProduct(prod)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="Edit product name and price"
                          aria-label={`Edit ${prod.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleArchiveProduct(prod)}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            prod.isArchived
                              ? 'text-amber-600 hover:text-amber-800 hover:bg-amber-50'
                              : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                          }`}
                          title={
                            prod.isArchived
                              ? 'Restore / Reactivate product'
                              : 'Retire product (Hide from active sales & stalls)'
                          }
                          aria-label={prod.isArchived ? `Reactivate ${prod.name}` : `Retire ${prod.name}`}
                        >
                          {prod.isArchived ? (
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          ) : (
                            <Archive className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => setProductToDelete(prod)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Retire product while preserving history"
                          aria-label={`Delete ${prod.name}`}
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Create New Project</h3>
              <button
                onClick={() => setShowProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={projectNameInput}
                  onChange={e => setProjectNameInput(e.target.value)}
                  placeholder="e.g. Project Vridhi"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  A unique 3-letter project code prefix will be automatically assigned for product ID generation.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowProjectModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">Add Product Under Project</h3>
              </div>
              <button
                onClick={() => setShowProductModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
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
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
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
                  placeholder="e.g. Lavender Scented Candle"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
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
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  The product ID (e.g. TAH-016) will be <span className="font-semibold text-emerald-700">automatically generated</span> on save.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
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
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Edit Product</h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  ID: <span className="font-bold text-slate-800">{editingProduct.id}</span> • {editingProduct.project?.name}
                </p>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
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
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
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
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  disabled={isUpdatingProduct}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingProduct}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isUpdatingProduct ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Product Confirmation */}
      {productToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200/60">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Delete Product: {productToDelete.name}?
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  ID: {productToDelete.id}
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-50/60 border border-amber-200/60 rounded-xl text-xs text-amber-900 leading-relaxed mb-4">
              <strong>Safety Note:</strong> If this product has historical transactions (sales, combos, game rewards, or event stock allocations), it cannot be permanently deleted. The system will automatically and safely <strong>RETIRE</strong> it to preserve financial and inventory audit integrity.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteProduct}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isDeleting ? 'Processing...' : 'Proceed with Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Project Confirmation */}
      {projectToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200/60">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Delete Project: {projectToDelete.name}?
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Code Prefix: {projectToDelete.code}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Are you sure you want to delete project <strong>{projectToDelete.name}</strong>? Any products and inventory stock records created under this project will also be removed.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteProject}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Rename Project */}
      {editingProject && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Rename Project</h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  Code: <span className="font-bold text-slate-800">{editingProject.code}</span>
                </p>
              </div>
              <button
                onClick={() => setEditingProject(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
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
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProject(null)}
                  disabled={isUpdatingProject}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingProject}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
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
