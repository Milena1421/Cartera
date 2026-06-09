import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';
import { GoogleGenAI, Type, createPartFromBase64, createPartFromText } from '@google/genai';

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

  function getGeminiAI() {
    const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_API_KEY || env.VITE_GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY no esta configurada en el entorno del servidor.');
    }
    return new GoogleGenAI({ apiKey });
  }

  function hasGeminiApiKey() {
    return Boolean(String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_API_KEY || env.VITE_GEMINI_API_KEY || '').trim());
  }

  function normalizeGeminiError(error: any) {
    const detail =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      'Error desconocido con Gemini.';
    const status = error.response?.status || 500;
    const geminiStatus = String(error.response?.data?.error?.status || '').toUpperCase();
    const normalizedDetail = String(detail);

    if (status === 429 || geminiStatus === 'RESOURCE_EXHAUSTED' || normalizedDetail.toLowerCase().includes('spending cap')) {
      return {
        detail: 'Gemini alcanzo el limite mensual de facturacion o cuota. Revisa AI Studio > Billing y aumenta el spending cap o espera el reinicio del periodo.',
        status: 429,
        payload: error.response?.data,
      };
    }

    return {
      detail: normalizedDetail,
      status: error.message?.includes('GEMINI_API_KEY') ? 503 : status,
      payload: error.response?.data,
    };
  }

  function buildPendingInvoiceContext(invoices: any[] = []) {
    return invoices
      .filter((invoice) =>
        invoice.status !== 'Pagada' &&
        (Number(invoice.debtValue) || 0) > 0 &&
        !invoice.paymentDate &&
        (Number(invoice.paidAmount) || 0) <= 0
      )
      .sort((a, b) => new Date(a.date || '1900-01-01').getTime() - new Date(b.date || '1900-01-01').getTime())
      .slice(0, 250)
      .map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName,
        documentNumber: invoice.documentNumber || '',
        issueDate: invoice.date || '',
        pendingAmount: Number(invoice.debtValue) || 0,
        total: Number(invoice.total) || 0,
      }));
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

  app.use(express.json({ limit: '25mb' }));
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

  app.get('/api/gemini/config', (_req, res) => {
    res.status(200).json({
      ok: hasGeminiApiKey(),
    });
  });

  app.post('/api/gemini/audit-siigo-mapping', async (req, res) => {
    try {
      const { mappedInvoices = [], rawSiigoData = [] } = req.body || {};
      if (!Array.isArray(mappedInvoices) || mappedInvoices.length === 0) {
        return res.status(200).json({ corrections: [] });
      }

      const context = mappedInvoices.map((inv: any, idx: number) => ({
        index: idx,
        current_mapping: {
          client: inv.clientName,
          invoice: inv.invoiceNumber,
          desc: inv.description,
          total: inv.total,
          iva: inv.iva,
        },
        siigo_raw_source: {
          customer: rawSiigoData[idx]?.customer,
          items: rawSiigoData[idx]?.items?.map((it: any) => ({ d: it.description, n: it.name })),
          financials: {
            t: rawSiigoData[idx]?.total,
            tv: rawSiigoData[idx]?.total_value,
            c: rawSiigoData[idx]?.cost,
            tx: rawSiigoData[idx]?.taxes,
          },
        },
      }));

      const response = await getGeminiAI().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `ACTUA COMO UN AUDITOR FINANCIERO SENIOR.
      Tu mision es asegurar que los datos de la API de Siigo se hayan mapeado correctamente.

      ERRORES CRITICOS A CORREGIR:
      1. CRUCE DE CAMPOS: Si el current_mapping.client es una frase larga y tecnica, es un error.
      2. VALORES EN CERO: Si current_mapping.total es 0 pero ves un total explicito en siigo_raw_source.financials, corrigelo.
      2B. IVA: NO calcules IVA por diferencia entre total y subtotal. Solo corrige IVA si existe un campo/impuesto IVA explicito en taxes o cost. Si no hay IVA explicito, manten 0.
      3. DESCRIPCION: Asegurate de que la descripcion sea la del servicio prestado, no el nombre del cliente.

      REGLA DE ORO: El nombre del cliente nunca es una descripcion tecnica.

      PROCESAR ESTOS DATOS:
      ${JSON.stringify(context)}`,
        config: {
          systemInstruction: 'NO INVENTES DATOS. Si no encuentras el cliente real en el RAW, manten el original pero limpialo de NITs. Responde estrictamente en JSON.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                correctedClient: { type: Type.STRING },
                correctedDescription: { type: Type.STRING },
                correctedTotal: { type: Type.NUMBER },
                correctedIva: { type: Type.NUMBER },
                hasChanges: { type: Type.BOOLEAN },
              },
              required: ['index', 'hasChanges'],
            },
          },
        },
      });

      res.json({ corrections: JSON.parse(response.text || '[]') });
    } catch (error: any) {
      const normalized = normalizeGeminiError(error);
      console.error('Gemini audit mapping error:', normalized.payload || normalized.detail);
      res.status(normalized.status).json({ error: normalized.detail, status: normalized.status });
    }
  });

  app.post('/api/gemini/parse-csv', async (req, res) => {
    try {
      const rawCsvText = String(req.body?.rawCsvText || '');
      if (rawCsvText.trim().length < 20) {
        return res.status(200).json({ extracted: [] });
      }

      const response = await getGeminiAI().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analiza este CSV y extrae datos de cartera: ${rawCsvText.substring(0, 30000)}`,
        config: {
          systemInstruction: 'Extrae clientName, invoiceNumber, date y total solo cuando existan. No inventes fechas ni descripciones.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                clientName: { type: Type.STRING },
                invoiceNumber: { type: Type.STRING },
                date: { type: Type.STRING },
                total: { type: Type.NUMBER },
                description: { type: Type.STRING },
              },
              required: ['clientName', 'invoiceNumber', 'total'],
            },
          },
        },
      });

      res.json({ extracted: JSON.parse(response.text || '[]') });
    } catch (error: any) {
      const normalized = normalizeGeminiError(error);
      console.error('Gemini CSV parsing error:', normalized.payload || normalized.detail);
      res.status(normalized.status).json({ error: normalized.detail, status: normalized.status });
    }
  });

  app.post('/api/gemini/parse-bank-statement-pdf', async (req, res) => {
    try {
      const { base64Pdf, mimeType = 'application/pdf', invoices = [] } = req.body || {};
      if (!base64Pdf || typeof base64Pdf !== 'string') {
        return res.status(400).json({ error: 'PDF invalido para analizar.' });
      }

      const pendingInvoiceContext = buildPendingInvoiceContext(Array.isArray(invoices) ? invoices : []);
      const response = await getGeminiAI().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          createPartFromBase64(base64Pdf, mimeType),
          createPartFromText(`Extrae del extracto bancario UNICAMENTE pagos de clientes recibidos en el banco.

Reglas:
- Incluir solo pagos de clientes: consignaciones, transferencias recibidas, recaudos, pagos de proveedores/clientes o abonos que puedan pagar facturas de cartera.
- Usa la lista de facturas pendientes como contexto principal. Extrae movimientos cuyo tercero, NIT/documento o valor coincida razonablemente con esas facturas.
- Si el banco muestra conceptos como PAGO DE PROV, PAGO PROVEEDORES, ABONO PROV o texto similar, tratalo como posible pago de cliente si coincide con un tercero, NIT o valor de la cartera pendiente.
- Excluir ingresos que NO sean pagos de clientes: intereses de ahorro, intereses, rendimientos, capitalizaciones, saldos, ajustes, reversos, debitos, retiros, comisiones, impuestos, IVA, GMF, encabezados, totales, subtotales y lineas sin valor real.
- Si el concepto dice INTERESES AHORRO, INTERES AHORRO, RENDIMIENTO o algo similar, NO lo incluyas.
- No inventes datos. Si no hay NIT, referencia o factura, deja el campo vacio.
- El valor debe ser positivo, en pesos colombianos, sin separadores.
- La fecha debe salir en formato YYYY-MM-DD cuando sea posible.
- La descripcion debe contener tercero/pagador y concepto visible.
- En reference coloca NIT, documento, comprobante o numero de factura visible que ayude al cruce.

Facturas pendientes de cartera:
${JSON.stringify(pendingInvoiceContext)}`),
        ],
        config: {
          systemInstruction: 'Eres un extractor contable. Devuelve JSON estricto. Si el PDF es escaneado, lee visualmente la tabla. Omite cualquier fila dudosa, ingresos financieros o movimientos que no sean pagos de clientes.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                description: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                reference: { type: Type.STRING },
              },
              required: ['date', 'description', 'amount'],
            },
          },
        },
      });

      res.json({ transactions: JSON.parse(response.text || '[]') });
    } catch (error: any) {
      const normalized = normalizeGeminiError(error);
      console.error('Gemini bank PDF parsing error:', normalized.payload || normalized.detail);
      res.status(normalized.status).json({ error: normalized.detail, status: normalized.status });
    }
  });

  app.post('/api/gemini/run-ai-audit', async (req, res) => {
    try {
      const invoices = Array.isArray(req.body?.invoices) ? req.body.invoices : [];
      if (invoices.length === 0) {
        return res.status(200).json({ findings: [] });
      }

      const response = await getGeminiAI().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Cartera: ${JSON.stringify(invoices.map((i: any) => ({ id: i.id, cli: i.clientName, debt: i.debtValue, mora: i.moraDays })))}`,
        config: {
          systemInstruction: 'Genera alertas para deudas mayores a 60 dias.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                invoiceId: { type: Type.STRING },
              },
              required: ['type', 'title', 'description', 'invoiceId'],
            },
          },
        },
      });

      res.json({ findings: JSON.parse(response.text || '[]') });
    } catch (error: any) {
      const normalized = normalizeGeminiError(error);
      console.error('Gemini AI audit error:', normalized.payload || normalized.detail);
      res.status(normalized.status).json({ error: normalized.detail, status: normalized.status });
    }
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
