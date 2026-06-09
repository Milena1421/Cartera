import { Invoice, AIAuditFinding, BankTransaction } from "../types";

const postGeminiJson = async <T>(endpoint: string, payload: unknown): Promise<T> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error || `No se pudo completar la solicitud de IA (${response.status}).`);
  }

  return response.json() as Promise<T>;
};

export const auditSiigoMapping = async (mappedInvoices: Invoice[], rawSiigoData: any[]): Promise<Invoice[]> => {
  if (mappedInvoices.length === 0) return [];

  try {
    const { corrections } = await postGeminiJson<{ corrections: any[] }>('/api/gemini/audit-siigo-mapping', {
      mappedInvoices,
      rawSiigoData,
    });

    return mappedInvoices.map((inv, idx) => {
      const corr = corrections.find((c) => c.index === idx);
      if (corr && corr.hasChanges) {
        const total = corr.correctedTotal !== undefined ? corr.correctedTotal : inv.total;
        const explicitTaxSource = rawSiigoData[idx]?.taxes || rawSiigoData[idx]?.cost?.iva;
        const hasExplicitIva = JSON.stringify(explicitTaxSource || '').toLowerCase().includes('iva') || Number(rawSiigoData[idx]?.cost?.iva || 0) > 0;
        const iva = hasExplicitIva && corr.correctedIva !== undefined ? corr.correctedIva : inv.iva;
        return {
          ...inv,
          clientName: inv.clientName,
          description: corr.correctedDescription || inv.description,
          total,
          iva,
          subtotal: inv.subtotal,
          debtValue: inv.status === 'Pagada' ? 0 : total
        };
      }
      return inv;
    });
  } catch (error) {
    console.error("Falla en Auditoria de IA (auditSiigoMapping):", error);
    return mappedInvoices;
  }
};

export const parseCSVWithAI = async (rawCsvText: string): Promise<Invoice[]> => {
  if (!rawCsvText || rawCsvText.trim().length < 20) return [];
  try {
    const { extracted } = await postGeminiJson<{ extracted: any[] }>('/api/gemini/parse-csv', { rawCsvText });
    return extracted
      .map((item, idx) => ({
        id: `csv-${Date.now()}-${idx}`,
        clientName: String(item.clientName || '').toUpperCase().trim(),
        invoiceNumber: String(item.invoiceNumber || '').toUpperCase().trim(),
        description: String(item.description || '').trim(),
        date: String(item.date || '').trim(),
        dueDate: String(item.date || '').trim(),
        subtotal: (item.total || 0) / 1.19,
        iva: (item.total || 0) - ((item.total || 0) / 1.19),
        total: item.total || 0,
        discounts: 0,
        reteFuente: 0,
        reteIva: 0,
        reteIca: 0,
        status: 'Pendiente por pagar' as const,
        debtValue: item.total || 0,
        observations: '',
        moraDays: 0,
        isSynced: false
      }))
      .filter((item) => item.clientName && item.invoiceNumber);
  } catch (error) {
    console.error("Falla en Auditoria de IA (parseCSVWithAI):", error);
    return [];
  }
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });

const isLikelyClientPayment = (transaction: BankTransaction) => {
  const text = `${transaction.description || ''} ${transaction.reference || ''}`
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ' ');

  const excludedConcepts = [
    'INTERES',
    'INTERESES',
    'AHORRO',
    'RENDIMIENTO',
    'RENDIMIENTOS',
    'CAPITALIZACION',
    'SALDO',
    'AJUSTE',
    'REVERSO',
    'COMISION',
    'IMPUESTO',
    'GMF',
    'IVA',
  ];

  return !excludedConcepts.some((concept) => text.includes(concept));
};

const normalizePaymentText = (value?: string) =>
  String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractDocumentCandidates = (value?: string) => {
  const matches = String(value || '').match(/\d[\d.\-\s]{5,}\d/g) || [];
  return Array.from(
    new Set(
      matches
        .map((match) => String(match || '').replace(/[^\d]/g, '').trim())
        .filter((candidate) => candidate.length >= 7)
    )
  );
};

const getPaymentIdentityKey = (transaction: BankTransaction) => {
  const amount = Math.round(Math.abs(Number(transaction.amount) || 0));
  const date = String(transaction.date || '').trim();
  const documentCandidate = extractDocumentCandidates(`${transaction.reference || ''} ${transaction.description || ''}`)[0] || '';
  const description = normalizePaymentText(transaction.description).slice(0, 80);
  const reference = normalizePaymentText(transaction.reference).slice(0, 80);
  const partyKey = documentCandidate || `${description}|${reference}`;
  return `${date}|${amount}|${partyKey}`;
};

const dedupeBankTransactions = (transactions: BankTransaction[]) => {
  const seen = new Set<string>();
  return transactions.filter((transaction) => {
    const key = getPaymentIdentityKey(transaction);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const parseBankStatementPdfWithAI = async (file: File, invoices: Invoice[] = []): Promise<BankTransaction[]> => {
  if (!file || file.size === 0) return [];

  try {
    const base64Pdf = await fileToBase64(file);
    const { transactions } = await postGeminiJson<{ transactions: Array<Partial<BankTransaction>> }>('/api/gemini/parse-bank-statement-pdf', {
      base64Pdf,
      mimeType: file.type || 'application/pdf',
      invoices,
    });

    return dedupeBankTransactions(transactions
      .map((item, index) => ({
        id: `bank-pdf-${Date.now()}-${index}`,
        date: String(item.date || '').trim(),
        description: String(item.description || 'Movimiento bancario').trim(),
        amount: Math.abs(Number(item.amount || 0)),
        reference: String(item.reference || '').trim(),
        isMatched: false,
      }))
      .filter((transaction) =>
        transaction.amount > 0 &&
        transaction.description !== 'Movimiento bancario' &&
        isLikelyClientPayment(transaction)
      ));
  } catch (error) {
    console.error("Falla extrayendo extracto bancario PDF:", error);
    throw error;
  }
};

export const runAIAudit = async (invoices: Invoice[]): Promise<AIAuditFinding[]> => {
  if (!invoices || invoices.length === 0) return [];
  try {
    const { findings } = await postGeminiJson<{ findings: AIAuditFinding[] }>('/api/gemini/run-ai-audit', { invoices });
    return findings;
  } catch (error) {
    console.error("Falla en Auditoria de IA (runAIAudit):", error);
    return [];
  }
};
