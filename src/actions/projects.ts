'use server';

import { prisma } from '@/lib/prisma';
import { requirePermission, getCurrentSessionUser } from '@/lib/authz';
import { recordAuditEvent } from '@/lib/audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  code: z
    .string()
    .min(1, 'Project code is required')
    .max(10, 'Project code must be 10 characters or less')
    .regex(/^[A-Z]+$/, 'Project code must contain only uppercase letters'),
  description: z.string().optional().nullable(),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  id: z.string().uuid('Invalid project ID'),
});

export async function createProject(data: z.infer<typeof createProjectSchema>) {
  await requirePermission('projects.create');

  const parsed = createProjectSchema.parse(data);

  const existingCode = await prisma.project.findUnique({
    where: { code: parsed.code },
  });

  if (existingCode) {
    throw new Error(`Project code "${parsed.code}" is already in use`);
  }

  const user = await getCurrentSessionUser();

  const project = await prisma.project.create({
    data: {
      name: parsed.name,
      code: parsed.code,
      description: parsed.description,
    },
  });

  await recordAuditEvent({
    action: 'PROJECT_CREATED',
    entityType: 'PROJECT',
    entityId: project.id,
    newData: {
      name: project.name,
      code: project.code,
      description: project.description,
    },
    metadata: { createdBy: user?.id ?? 'system' },
  });

  revalidatePath('/admin/projects');
  return project;
}

export async function updateProject(data: z.infer<typeof updateProjectSchema>) {
  await requirePermission('projects.edit');

  const parsed = updateProjectSchema.parse(data);
  const { id, ...updateData } = parsed;

  const project = await prisma.project.findUnique({
    where: { id },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  if (updateData.code && updateData.code !== project.code) {
    const existingCode = await prisma.project.findUnique({
      where: { code: updateData.code },
    });
    if (existingCode) {
      throw new Error(`Project code "${updateData.code}" is already in use`);
    }
  }

  const updated = await prisma.project.update({
    where: { id },
    data: updateData,
  });

  await recordAuditEvent({
    action: 'PROJECT_UPDATED',
    entityType: 'PROJECT',
    entityId: updated.id,
    previousData: {
      name: project.name,
      code: project.code,
      description: project.description,
    },
    newData: {
      name: updated.name,
      code: updated.code,
      description: updated.description,
    },
  });

  revalidatePath('/admin/projects');
  return updated;
}

export async function deactivateProject(id: string) {
  await requirePermission('projects.deactivate');

  const project = await prisma.project.findUnique({
    where: { id },
    include: { products: true },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const activeProducts = project.products.filter((p) => p.isActive);
  if (activeProducts.length > 0) {
    throw new Error(
      `Cannot deactivate project with active products. Please deactivate products first.`
    );
  }

  const updated = await prisma.project.update({
    where: { id },
    data: { isActive: false },
  });

  await recordAuditEvent({
    action: 'PROJECT_DEACTIVATED',
    entityType: 'PROJECT',
    entityId: updated.id,
    previousData: { isActive: project.isActive },
    newData: { isActive: updated.isActive },
  });

  revalidatePath('/admin/projects');
  return updated;
}

export async function getAllProjects() {
  await getCurrentSessionUser();

  const projects = await prisma.project.findMany({
    include: {
      products: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  return projects;
}

export async function getProjectById(id: string) {
  await getCurrentSessionUser();

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      products: true,
    },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  return project;
}
