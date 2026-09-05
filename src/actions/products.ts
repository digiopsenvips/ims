'use server';

import { prisma } from '@/lib/prisma';
import { requirePermission, getCurrentSessionUser } from '@/lib/authz';
import { recordAuditEvent } from '@/lib/audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const createProductSchema = z.object({
  projectId: z.string().uuid('Invalid project ID'),
  name: z.string().min(1, 'Product name is required'),
  productCode: z
    .string()
    .min(1, 'Product code is required')
    .regex(/^[A-Z0-9]+$/, 'Product code must contain only uppercase letters and numbers'),
});

const updateProductSchema = createProductSchema.partial().extend({
  id: z.string().uuid('Invalid product ID'),
});

export async function createProduct(data: z.infer<typeof createProductSchema>) {
  await requirePermission('products.create');

  const parsed = createProductSchema.parse(data);

  const project = await prisma.project.findUnique({
    where: { id: parsed.projectId },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const existingCode = await prisma.product.findUnique({
    where: { productCode: parsed.productCode },
  });

  if (existingCode) {
    throw new Error(`Product code "${parsed.productCode}" is already in use`);
  }

  const user = await getCurrentSessionUser();

  const product = await prisma.product.create({
    data: {
      name: parsed.name,
      productCode: parsed.productCode,
      projectId: parsed.projectId,
    },
  });

  await recordAuditEvent({
    action: 'PRODUCT_CREATED',
    entityType: 'PRODUCT',
    entityId: product.id,
    newData: {
      name: product.name,
      productCode: product.productCode,
      projectId: product.projectId,
    },
    metadata: { createdBy: user?.id ?? 'system' },
  });

  revalidatePath('/admin/products');
  revalidatePath(`/admin/projects/${parsed.projectId}`);
  return product;
}

export async function updateProduct(data: z.infer<typeof updateProductSchema>) {
  await requirePermission('products.edit');

  const parsed = updateProductSchema.parse(data);
  const { id, ...updateData } = parsed;

  const product = await prisma.product.findUnique({
    where: { id },
  });

  if (!product) {
    throw new Error('Product not found');
  }

  if (updateData.projectId && updateData.projectId !== product.projectId) {
    const newProject = await prisma.project.findUnique({
      where: { id: updateData.projectId },
    });
    if (!newProject) {
      throw new Error('New project not found');
    }
  }

  if (updateData.productCode && updateData.productCode !== product.productCode) {
    const existingCode = await prisma.product.findUnique({
      where: { productCode: updateData.productCode },
    });
    if (existingCode) {
      throw new Error(`Product code "${updateData.productCode}" is already in use`);
    }
  }

  const updated = await prisma.product.update({
    where: { id },
    data: updateData,
  });

  await recordAuditEvent({
    action: 'PRODUCT_UPDATED',
    entityType: 'PRODUCT',
    entityId: updated.id,
    previousData: {
      name: product.name,
      productCode: product.productCode,
      projectId: product.projectId,
    },
    newData: {
      name: updated.name,
      productCode: updated.productCode,
      projectId: updated.projectId,
    },
  });

  revalidatePath('/admin/products');
  revalidatePath(`/admin/projects/${product.projectId}`);
  if (updateData.projectId && updateData.projectId !== product.projectId) {
    revalidatePath(`/admin/projects/${updateData.projectId}`);
  }
  return updated;
}

export async function deactivateProduct(id: string) {
  await requirePermission('products.deactivate');

  const product = await prisma.product.findUnique({
    where: { id },
  });

  if (!product) {
    throw new Error('Product not found');
  }

  const updated = await prisma.product.update({
    where: { id },
    data: { isActive: false },
  });

  await recordAuditEvent({
    action: 'PRODUCT_DEACTIVATED',
    entityType: 'PRODUCT',
    entityId: updated.id,
    previousData: { isActive: product.isActive },
    newData: { isActive: updated.isActive },
  });

  revalidatePath('/admin/products');
  revalidatePath(`/admin/projects/${product.projectId}`);
  return updated;
}

export async function getAllProducts() {
  await getCurrentSessionUser();

  const products = await prisma.product.findMany({
    include: {
      project: true,
    },
    orderBy: [{ project: { createdAt: 'asc' } }, { createdAt: 'asc' }],
  });

  return products;
}

export async function getProductsByProjectId(projectId: string) {
  await getCurrentSessionUser();

  const products = await prisma.product.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });

  return products;
}

export async function getProductById(id: string) {
  await getCurrentSessionUser();

  const product = await prisma.product.findUnique({
    where: { id },
    include: { project: true },
  });

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
}
