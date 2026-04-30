import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.join(rootDir, 'dist');
  const env = { ...loadEnv(process.env.NODE_ENV || 'development', process.cwd(), ''), ...process.env };
  const siigoApiUrl = String(env.SIIGO_API_URL || env.VITE_SIIGO_API_URL || 'https://api.siigo.com/v1').replace(/\/+$/, '');
  const siigoAuthUrl = String(env.SIIGO_AUTH_URL || 'https://api.siigo.com/auth').trim();
  const siigoUsername = String(env.SIIGO_USERNAME || env.VITE_SIIGO_USERNAME || '').trim();
  const siigoAccessKey = String(env.SIIGO_ACCESS_KEY || env.VITE_SIIGO_ACCESS_KEY || '').trim();
  const siigoPartnerId = String(env.SIIGO_PARTNER_ID || env.VITE_SIIGO_PARTNER_ID || 'Ingenieria365').trim();
  let siigoToken: string | null = null;
  let siigoTokenExpiresAt = 0;

  function normalizeSiigoError(error: any) {
    const payload = error.response?.data;
    const detail =
      payload?.Errors?.[0]?.Message ||
      payload?.errors?.[0]?.message ||
      payload?.message ||
      payload?.Message ||
      payload?.detail ||
      payload?.details ||
      payload?.title ||
      (typeof payload === 'string' ? payload : '') ||
      error.message ||
      'Error desconocido con Siigo.';

    return {
      detail: String(detail),
      status: error.response?.status || 500,
      payload,
    };
  }

  async function getSiigoToken(): Promise<string> {
    if (siigoToken && Date.now() < siigoTokenExpiresAt) return siigoToken;

    if (!siigoUsername || !siigoAccessKey) {
      throw new Error('Credenciales de Siigo no configuradas.');
    }

    const response = await axios.post(
      siigoAuthUrl,
      {
        username: siigoUsername,
        access_key: siigoAccessKey,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Partner-Id': siigoPartnerId,
        },
      },
    );

    siigoToken = response.data?.access_token;
    if (!siigoToken) {
      throw new Error('Siigo no devolvio token de acceso.');
    }

    const expiresInSeconds = Number(response.data?.expires_in || 3600);
    siigoTokenExpiresAt = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000;
    return siigoToken;
  }

  app.use(express.json());
  app.use(cors()); // Enable CORS for all routes for now

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Siigo API Proxy
  app.post('/api/siigo', async (req, res) => {
    try {
      const { endpoint, method, data } = req.body;
      const requestMethod = String(method || 'GET').toUpperCase();

      if (!endpoint || typeof endpoint !== 'string' || !endpoint.startsWith('/') || endpoint.startsWith('//')) {
        return res.status(400).json({ error: 'Endpoint de Siigo invalido.' });
      }

      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(requestMethod)) {
        return res.status(400).json({ error: 'Metodo de Siigo invalido.' });
      }

      const accessToken = await getSiigoToken();

      // Then, make the actual API call to Siigo
      const siigoResponse = await axios({
        method: requestMethod,
        url: `${siigoApiUrl}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Partner-Id': siigoPartnerId,
        },
        data: data
      });

      res.json(siigoResponse.data);
    } catch (error: any) {
      const normalized = normalizeSiigoError(error);
      console.error('Siigo proxy error:', normalized.payload || normalized.detail);
      res.status(normalized.status).json({
        error: normalized.detail,
        status: normalized.status,
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
