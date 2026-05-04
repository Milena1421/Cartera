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
  let siigoToken: string | null = null;
  let siigoTokenExpiresAt = 0;

  function firstEnvValue(keys: string[], fallback = '') {
    for (const key of keys) {
      const value = String(env[key] || '').trim();
      if (value) return { key, value };
    }
    return { key: '', value: fallback };
  }

  function getSiigoConfig() {
    const apiUrl = firstEnvValue(['SIIGO_API_URL', 'VITE_SIIGO_API_URL'], 'https://api.siigo.com/v1');
    const authUrl = firstEnvValue(['SIIGO_AUTH_URL', 'VITE_SIIGO_AUTH_URL'], 'https://api.siigo.com/auth');
    const username = firstEnvValue([
      'SIIGO_USERNAME',
      'SIIGO_USER',
      'SIIGO_EMAIL',
      'VITE_SIIGO_USERNAME',
      'VITE_SIIGO_USER',
      'VITE_SIIGO_EMAIL',
    ]);
    const accessKey = firstEnvValue([
      'SIIGO_ACCESS_KEY',
      'SIIGO_KEY',
      'VITE_SIIGO_ACCESS_KEY',
      'VITE_SIIGO_KEY',
    ]);
    const partnerId = firstEnvValue(['SIIGO_PARTNER_ID', 'VITE_SIIGO_PARTNER_ID'], 'Ingenieria365');

    return {
      apiUrl: apiUrl.value.replace(/\/+$/, ''),
      authUrl: authUrl.value,
      username: username.value,
      accessKey: accessKey.value,
      partnerId: partnerId.value,
      sources: {
        apiUrl: apiUrl.key || 'default',
        authUrl: authUrl.key || 'default',
        username: username.key || null,
        accessKey: accessKey.key || null,
        partnerId: partnerId.key || 'default',
      },
    };
  }

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
    const siigoConfig = getSiigoConfig();

    const missing = [];
    if (!siigoConfig.username) missing.push('SIIGO_USERNAME');
    if (!siigoConfig.accessKey) missing.push('SIIGO_ACCESS_KEY');
    if (missing.length > 0) {
      throw new Error(`Credenciales de Siigo no configuradas. Faltan: ${missing.join(', ')}.`);
    }

    const response = await axios.post(
      siigoConfig.authUrl,
      {
        username: siigoConfig.username,
        access_key: siigoConfig.accessKey,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Partner-Id': siigoConfig.partnerId,
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

  app.get('/api/siigo/config', (_req, res) => {
    const siigoConfig = getSiigoConfig();
    res.status(200).json({
      ok: Boolean(siigoConfig.username && siigoConfig.accessKey),
      hasUsername: Boolean(siigoConfig.username),
      hasAccessKey: Boolean(siigoConfig.accessKey),
      hasPartnerId: Boolean(siigoConfig.partnerId),
      apiUrl: siigoConfig.apiUrl,
      authUrl: siigoConfig.authUrl,
      sources: siigoConfig.sources,
    });
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

      const siigoConfig = getSiigoConfig();
      const accessToken = await getSiigoToken();

      // Then, make the actual API call to Siigo
      const siigoResponse = await axios({
        method: requestMethod,
        url: `${siigoConfig.apiUrl}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Partner-Id': siigoConfig.partnerId,
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
    app.use(express.static(distDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    }));
    app.use((_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
