import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from './auth.js';
import type { ProjectManager } from '../projects.js';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Projekte (Overlay-Profile) verwalten – oberste Ebene des Dashboards */
export async function projectRoutes(app: FastifyInstance, projects: ProjectManager) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/projects', async () => ({
    current: projects.current().id,
    projects: projects.list().map((p) => projects.summary(p.id)).filter(Boolean),
  }));

  app.post('/api/projects', async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(1).max(60),
      description: z.string().max(300).optional(),
      color: color.optional(),
      copyFrom: z.string().max(40).optional(),
    }).parse(req.body);
    const p = projects.create(b);
    return reply.code(201).send(projects.summary(p.id));
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(60).optional(), description: z.string().max(300).optional(), color: color.optional() }).parse(req.body);
    const p = projects.update(req.params.id, b);
    if (!p) return reply.code(404).send({ error: 'Projekt nicht gefunden' });
    return projects.summary(p.id);
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!(await projects.remove(req.params.id))) return reply.code(404).send({ error: 'Projekt nicht gefunden' });
    return { ok: true };
  });
}
