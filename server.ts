import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.join(rootDir, 'dist');

  app.use(express.json());
  app.use(cors()); // Enable CORS for all routes for now

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Siigo API Proxy
  app.post('/api/siigo', async (req, res) => {
    try {
      const { endpoint, method, data } = req.body;
      const siigoApiUrl = process.env.VITE_SIIGO_API_URL;
      const siigoUsername = process.env.VITE_SIIGO_USERNAME;
      const siigoAccessKey = process.env.VITE_SIIGO_ACCESS_KEY;

      if (!siigoApiUrl || !siigoUsername || !siigoAccessKey) {
        return res.status(500).json({ error: 'Siigo API credentials not configured.' });
      }

      // First, get the access token
      const authResponse = await axios.post(`${siigoApiUrl}/oauth/token?grant_type=client_credentials`, null, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${siigoUsername}:${siigoAccessKey}`).toString('base64')}`,
          'Content-Type': 'application/json'
        }
      });

      const accessToken = authResponse.data.access_token;

      // Then, make the actual API call to Siigo
      const siigoResponse = await axios({
        method: method,
        url: `${siigoApiUrl}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        data: data
      });

      res.json(siigoResponse.data);
    } catch (error: any) {
      console.error('Siigo proxy error:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
