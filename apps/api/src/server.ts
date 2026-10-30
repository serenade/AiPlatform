import cors from 'cors';
import express from 'express';
import { authRouter, requireCsrf } from './auth.js';
import { appsRouter } from './apps.js';
import { seedIfEmpty } from './db.js';
import { errorHandler, notFoundHandler, requestId } from './errors.js';
import { tenantsRouter } from './tenants.js';
import { usersRouter } from './users.js';
import { dbAdminRouter } from './dbadmin.js';
import { teamRouter } from './team.js';

const PORT = Number(process.env.PORT ?? 4000);

seedIfEmpty();

const app = express();
app.disable('x-powered-by');
app.use(requestId);
app.use(cors({ origin: true, credentials: true, exposedHeaders: ['X-Request-Id'] }));
app.use(express.json({ limit: '4mb' }));

// CSRF 双提交校验（login 内部豁免、internal token 豁免，见 auth.ts）
app.use(requireCsrf);

app.use('/api/auth', authRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/apps', appsRouter);
app.use('/api/users', usersRouter);
app.use('/api/databases', dbAdminRouter);
app.use('/api/team', teamRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'air-platform-api' }));

app.use('/api', notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[api] AIR platform API listening on http://localhost:${PORT}`);
});
