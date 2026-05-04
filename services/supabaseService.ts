
import { createClient } from '@supabase/supabase-js';
import { BankTransaction, Invoice } from '../types';

const SUPABASE_URL = 'https://xfsbogjozqvaphoapqnz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PL1m0jMzLteH19aQWAY2oA_pb6-FMIe';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Nombre de la tabla principal
const TABLE_NAME = 'invoices';
const CLIENTS_TABLE_NAME = 'clientes';
const BUCKET_NAME = 'invoice-documents';
const BANK_TRANSACTIONS_FOLDER = 'bank-transactions';
const SYSTEM_GENERATED_OBSERVATIONS = [
  'Pendiente confirmacion de recibido por parte de almacen.',
  'Se solicita envio de RUT actualizado para proceso de pago.',
  'Pago recibido via transferencia bancaria.',
  'Factura en revision por parte del interventor.',
  'Procesado por IA',
];
const SIIGO_OBSERVATION_MARKERS = [
  'medios de pago',
  'por favor haga el pago a',
  'banco',
  'bancolombia',
  'numero de cuenta',
  'cuenta de ahorros',
  'titular de la cuenta',
  'iva excluido',
  'economia naranja',
  'sin retencion en la fuente',
  'resolucion',
  'decreto',
  'intereses moratorios',
  'tasa maxima legal vigente',
];

/**
 * NOTA PARA EL DESARROLLADOR:
 * Si recibes un error de "column not found", ejecuta este SQL en el editor de Supabase:
 * ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "creditAmount" NUMERIC DEFAULT 0;
 */

const NOTE_CREDIT_STATUS = (["Nota cr", String.fromCharCode(233), "dito"].join("")) as Invoice['status'];

export const supabaseService = {
  normalizePaymentStatus(value?: string): Invoice['status'] {
    const raw = String(value || '').trim();
    const normalized = raw
      .replace(/é/g, 'e')
            .replace(/\uFFFD/g, 'e');
    const compact = this.normalizeKey(normalized);
    if (compact === 'pagada') return 'Pagada';
    if (compact === 'notacredito' || (/notacr.*dito/.test(compact) && compact.startsWith('nota'))) return NOTE_CREDIT_STATUS;
    return 'Pendiente por pagar';
  },

  isNoteCreditStatus(value?: string) {
    return this.normalizePaymentStatus(value) === NOTE_CREDIT_STATUS;
  },

  roundCurrency(value: number) {
    return Math.round(value * 100) / 100;
  },

  calculateDebt(invoice: Partial<Invoice>) {
    if (this.isNoteCreditStatus(invoice.status)) return 0;
    const total = Number(invoice.total) || 0;
    const deductions =
      (Number(invoice.paidAmount) || 0) +
      (Number(invoice.creditAmount) || 0) +
      (Number(invoice.reteFuente) || 0) +
      (Number(invoice.reteIva) || 0) +
      (Number(invoice.reteIca) || 0);
    return Math.max(0, this.roundCurrency(total - deductions));
  },

  resolveStatusFromDebt(status: Invoice['status'] | undefined, debt: number): Invoice['status'] {
    if (this.isNoteCreditStatus(status)) return NOTE_CREDIT_STATUS;
    if (debt > 0) return 'Pendiente por pagar';
    return this.normalizePaymentStatus(status);
  },

  getFirstDefined(row: any, keys: string[]) {
    for (const key of keys) {
      if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
        return row[key];
      }
    }
    return undefined;
  },

  toNumber(value: any) {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const normalized = String(value)
      .replace(/\$/g, '')
      .replace(/\s/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  },

  normalizeInvoiceNumber(value?: string) {
    const clean = String(value || '')
      .toUpperCase()
      .trim()
      .replace(/[-.]/g, '')
      .replace(/^FV(?=\d)/, 'FING');
    const match = clean.match(/^([A-Z]+)\s*([0-9]+)$/) || clean.match(/^([A-Z]+)([0-9]+)$/);
    if (match) return `${match[1]}${match[2]}`;
    return clean;
  },

  normalizeDocumentNumber(value?: string) {
    return String(value || '').replace(/[^\d]/g, '').trim();
  },

  sanitizeStorageSegment(value?: string) {
    return String(value || 'default')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_+/g, '_') || 'default';
  },

  getBankTransactionsStoragePath(username?: string) {
    return `${BANK_TRANSACTIONS_FOLDER}/${this.sanitizeStorageSegment(username)}.json`;
  },

  cleanClientName(value?: string) {
    return String(value || '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  },

  isUsableClientName(value?: string) {
    const name = this.cleanClientName(value);
    if (!name) return false;
    if (name === 'CLIENTE NO IDENTIFICADO') return false;
    if (/^\d{6,}$/.test(this.normalizeDocumentNumber(name))) return false;
    return true;
  },

  normalizeKey(value: string) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  },

  hasMeaningfulDate(value?: string) {
    return Boolean(String(value || '').trim());
  },

  hasMeaningfulDescription(value?: string) {
    const normalized = this.normalizeKey(String(value || '').trim());
    return Boolean(normalized) && normalized !== 'importacionporcsv';
  },

  hasMeaningfulFinancialValues(invoice?: Partial<Invoice>) {
    if (!invoice) return false;
    return [
      Number(invoice.subtotal) || 0,
      Number(invoice.iva) || 0,
      Number(invoice.total) || 0,
      Number(invoice.debtValue) || 0,
      Number(invoice.paidAmount) || 0,
      Number(invoice.creditAmount) || 0,
      Number(invoice.reteFuente) || 0,
      Number(invoice.reteIva) || 0,
      Number(invoice.reteIca) || 0,
    ].some((value) => value > 0);
  },

  hasConsistentTaxBreakdown(invoice?: Partial<Invoice>) {
    if (!invoice) return false;
    const subtotal = Number(invoice.subtotal) || 0;
    const iva = Number(invoice.iva) || 0;
    const total = Number(invoice.total) || 0;
    if (total <= 0) return false;
    return Math.abs((subtotal + iva) - total) <= 2;
  },

  hasConsistentDebt(invoice?: Partial<Invoice>) {
    if (!invoice) return false;
    const total = Number(invoice.total) || 0;
    const debt = Number(invoice.debtValue) || 0;
    if (total <= 0 || debt < 0) return false;
    if (this.isNoteCreditStatus(invoice.status)) return debt === 0;
    const expectedDebt = this.calculateDebt(invoice);
    return Math.abs(expectedDebt - debt) <= 2;
  },

  scoreInvoiceCompleteness(invoice?: Invoice) {
    if (!invoice) return -1;

    let score = 0;
    if (this.isUsableClientName(invoice.clientName)) score += 10;
    if (invoice.documentNumber) score += 8;
    if (this.hasMeaningfulDate(invoice.date)) score += 20;
    if (this.hasMeaningfulDate(invoice.dueDate)) score += 10;
    if (this.hasMeaningfulDescription(invoice.description)) score += 35;
    if (this.hasMeaningfulFinancialValues(invoice)) score += 30;
    if ((Number(invoice.total) || 0) > 0) score += 15;
    if ((Number(invoice.debtValue) || 0) > 0) score += 10;
    if ((Number(invoice.paidAmount) || 0) > 0) score += 8;
    if ((Number(invoice.creditAmount) || 0) > 0) score += 8;
    if (this.hasConsistentTaxBreakdown(invoice)) score += 12;
    if (this.hasConsistentDebt(invoice)) score += 12;
    if (this.sanitizeObservation(invoice.observations, invoice)) score += 6;
    if (this.normalizeKey(invoice.description) === 'importacionporcsv') score -= 40;

    return score;
  },

  pickPreferredInvoice(base: Invoice, candidate: Invoice) {
    const baseScore = this.scoreInvoiceCompleteness(base);
    const candidateScore = this.scoreInvoiceCompleteness(candidate);
    if (candidateScore > baseScore) return candidate;
    if (candidateScore < baseScore) return base;
    return candidate.id < base.id ? candidate : base;
  },

  mergeDuplicateInvoices(base: Invoice, candidate: Invoice): Invoice {
    const preferred = this.pickPreferredInvoice(base, candidate);
    const fallback = preferred.id === base.id ? candidate : base;

    const pickText = (preferredValue?: string, fallbackValue?: string, validator?: (value?: string) => boolean) => {
      if (validator ? validator(preferredValue) : Boolean(String(preferredValue || '').trim())) return preferredValue || '';
      return fallbackValue || '';
    };

    const pickPositive = (preferredValue?: number, fallbackValue?: number) => {
      const primary = Number(preferredValue) || 0;
      const secondary = Number(fallbackValue) || 0;
      if (primary > 0) return primary;
      return secondary;
    };

    const pickPreferredNumber = (preferredValue?: number, fallbackValue?: number) => {
      if (preferredValue !== undefined && preferredValue !== null) {
        return Number(preferredValue) || 0;
      }
      return Number(fallbackValue) || 0;
    };

    const preferredObservation = this.sanitizeObservation(preferred.observations, preferred);
    const fallbackObservation = this.sanitizeObservation(fallback.observations, fallback);

    const preferredIsNoteCredit = this.normalizeKey(preferred.status || '') === 'notacredito';
    const fallbackIsNoteCredit = this.normalizeKey(fallback.status || '') === 'notacredito';
    const noteCreditInvoice = preferredIsNoteCredit ? preferred : fallbackIsNoteCredit ? fallback : null;
    const preferredStatus = this.normalizePaymentStatus(preferred.status);
    const fallbackStatus = this.normalizePaymentStatus(fallback.status);
    const preferredClearsPayment =
      preferredStatus === 'Pendiente por pagar' &&
      !this.hasMeaningfulDate(preferred.paymentDate) &&
      (Number(preferred.paidAmount) || 0) <= 0;
    const preferredClearsCredit =
      preferredStatus === 'Pendiente por pagar' &&
      !this.hasMeaningfulDate(preferred.creditDate) &&
      (Number(preferred.creditAmount) || 0) <= 0;
    const mergedSubtotal = noteCreditInvoice ? Number(noteCreditInvoice.subtotal) || 0 : pickPreferredNumber(preferred.subtotal, fallback.subtotal);
    const mergedIva = noteCreditInvoice ? Number(noteCreditInvoice.iva) || 0 : pickPreferredNumber(preferred.iva, fallback.iva);
    const mergedTotal = noteCreditInvoice ? Number(noteCreditInvoice.total) || 0 : pickPreferredNumber(preferred.total, fallback.total);
    const mergedDiscounts = noteCreditInvoice ? Number(noteCreditInvoice.discounts) || 0 : pickPreferredNumber(preferred.discounts, fallback.discounts);
    const mergedReteFuente = noteCreditInvoice ? Number(noteCreditInvoice.reteFuente) || 0 : pickPreferredNumber(preferred.reteFuente, fallback.reteFuente);
    const mergedReteIva = noteCreditInvoice ? Number(noteCreditInvoice.reteIva) || 0 : pickPreferredNumber(preferred.reteIva, fallback.reteIva);
    const mergedReteIca = noteCreditInvoice ? Number(noteCreditInvoice.reteIca) || 0 : pickPreferredNumber(preferred.reteIca, fallback.reteIca);
    const mergedCreditAmount = noteCreditInvoice
      ? Number(noteCreditInvoice.creditAmount) || 0
      : preferredClearsCredit
      ? 0
      : Math.max(Number(preferred.creditAmount) || 0, Number(fallback.creditAmount) || 0);
    const mergedPaidAmount = noteCreditInvoice
      ? Number(noteCreditInvoice.paidAmount) || 0
      : preferredClearsPayment
      ? 0
      : Math.max(Number(preferred.paidAmount) || 0, Number(fallback.paidAmount) || 0);
    const mergedPaidWithWithholdings = noteCreditInvoice
      ? Number(noteCreditInvoice.paidWithWithholdings) || 0
      : Math.max(
        Number(preferred.paidWithWithholdings) || 0,
        Number(fallback.paidWithWithholdings) || 0
      );
    const mergedExpectedDebt = Math.max(
      0,
      mergedTotal - mergedPaidAmount - mergedCreditAmount - mergedReteFuente - mergedReteIva - mergedReteIca
    );
    const preferredDebt = Number(preferred.debtValue) || 0;
    const fallbackDebt = Number(fallback.debtValue) || 0;
    const preferredDebtMatchesMerged = Math.abs(preferredDebt - mergedExpectedDebt) <= 2;
    const fallbackDebtMatchesMerged = Math.abs(fallbackDebt - mergedExpectedDebt) <= 2;
    const mergedDebtValue = (() => {
      if (preferredIsNoteCredit || fallbackIsNoteCredit) return 0;
      if (preferredDebtMatchesMerged && !fallbackDebtMatchesMerged) return preferredDebt;
      if (fallbackDebtMatchesMerged && !preferredDebtMatchesMerged) return fallbackDebt;
      if (preferredDebtMatchesMerged && fallbackDebtMatchesMerged) {
        return preferred.id === this.pickPreferredInvoice(base, candidate).id ? preferredDebt : fallbackDebt;
      }
      if (mergedExpectedDebt > 0) return mergedExpectedDebt;
      return pickPositive(preferredDebt, fallbackDebt);
    })();

    return {
      ...fallback,
      ...preferred,
      id: preferred.id || fallback.id,
      clientName: pickText(preferred.clientName, fallback.clientName, this.isUsableClientName.bind(this)),
      documentType: preferred.documentType || fallback.documentType,
      documentNumber: preferred.documentNumber || fallback.documentNumber,
      invoiceNumber: preferred.invoiceNumber || fallback.invoiceNumber,
      description: pickText(preferred.description, fallback.description, this.hasMeaningfulDescription.bind(this)),
      date: pickText(preferred.date, fallback.date, this.hasMeaningfulDate.bind(this)),
      dueDate: pickText(preferred.dueDate, fallback.dueDate, this.hasMeaningfulDate.bind(this)),
      subtotal: mergedSubtotal,
      iva: mergedIva,
      total: mergedTotal,
      discounts: mergedDiscounts,
      reteFuente: mergedReteFuente,
      reteIva: mergedReteIva,
      reteIca: mergedReteIca,
      debtValue: mergedDebtValue,
      observations: preferredObservation || fallbackObservation || '',
      moraDays: pickPositive(preferred.moraDays, fallback.moraDays),
      documentUrl: preferred.documentUrl || fallback.documentUrl,
      isSynced: Boolean(preferred.isSynced || fallback.isSynced),
      bankCommission: pickPositive(preferred.bankCommission, fallback.bankCommission),
      creditAmount: mergedCreditAmount,
      creditDate: noteCreditInvoice
        ? noteCreditInvoice.creditDate || ''
        : preferredClearsCredit
        ? ''
        : pickText(preferred.creditDate, fallback.creditDate, this.hasMeaningfulDate.bind(this)),
      paymentDate: noteCreditInvoice
        ? noteCreditInvoice.paymentDate || ''
        : preferredClearsPayment
        ? ''
        : pickText(preferred.paymentDate, fallback.paymentDate, this.hasMeaningfulDate.bind(this)),
      paidAmount: mergedPaidAmount,
      paidWithWithholdings: mergedPaidWithWithholdings,
      status:
        preferredIsNoteCredit || fallbackIsNoteCredit
          ? NOTE_CREDIT_STATUS
          : preferredClearsPayment && preferredClearsCredit
            ? 'Pendiente por pagar'
            : preferredStatus === 'Pagada' || fallbackStatus === 'Pagada'
          ? 'Pagada'
          : this.normalizePaymentStatus(preferred.status || fallback.status),
    };
  },

  dedupeInvoicesByInvoiceNumber(invoices: Invoice[]) {
    const deduped = new Map<string, Invoice>();

    for (const invoice of invoices) {
      const normalizedInvoiceNumber = this.normalizeInvoiceNumber(invoice.invoiceNumber);
      const key = normalizedInvoiceNumber || invoice.id;
      const normalizedInvoice = {
        ...invoice,
        invoiceNumber: normalizedInvoiceNumber || invoice.invoiceNumber,
      };
      const current = deduped.get(key);

      if (!current) {
        deduped.set(key, normalizedInvoice);
        continue;
      }

      deduped.set(key, this.mergeDuplicateInvoices(current, normalizedInvoice));
    }

    return Array.from(deduped.values());
  },

  extractMeaningfulTokens(value?: string) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
      .filter((token) => !['para', 'como', 'este', 'esta', 'desde', 'hasta', 'sobre', 'valor', 'pago', 'fecha', 'factura', 'servicio'].includes(token));
  },

  sanitizeObservation(value?: string, invoice?: Partial<Invoice>) {
    const observation = String(value || '').trim();
    if (!observation) return '';
    const normalizedObservation = this.normalizeKey(observation);
    const observationLower = observation.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isSystemGenerated = SYSTEM_GENERATED_OBSERVATIONS.some(
      (candidate) => this.normalizeKey(candidate) === normalizedObservation
    );
    if (isSystemGenerated) return '';
    const containsSiigoMarker = SIIGO_OBSERVATION_MARKERS.some((marker) => observationLower.includes(marker));
    if (containsSiigoMarker) return '';

    return observation;
  },

  detectClientesColumnsFromRow(row: any): { docColumn: string; nameColumn: string } | null {
    if (!row || typeof row !== 'object') return null;

    const keys = Object.keys(row);
    const normalizedMap = new Map<string, string>();
    for (const key of keys) normalizedMap.set(this.normalizeKey(key), key);

    const docCandidates = ['nit', 'numero_documento', 'nro_documento', 'documento', 'document_number', 'identificacion'];
    const nameCandidates = ['name', 'nombre', 'razon_social', 'razonsocial', 'cliente', 'nombrecliente', 'businessname', 'full_name'];

    let docColumn = '';
    let nameColumn = '';

    for (const candidate of docCandidates) {
      const found = normalizedMap.get(this.normalizeKey(candidate));
      if (found) {
        docColumn = found;
        break;
      }
    }

    for (const candidate of nameCandidates) {
      const found = normalizedMap.get(this.normalizeKey(candidate));
      if (found) {
        nameColumn = found;
        break;
      }
    }

    if (!docColumn || !nameColumn) return null;
    return { docColumn, nameColumn };
  },

  async fetchClientesRowsRaw(): Promise<{ rows: any[]; columns: { docColumn: string; nameColumn: string } | null }> {
    try {
      const { data, error } = await supabase.from(CLIENTS_TABLE_NAME).select('*').limit(1000);
      if (error) {
        console.warn('Supabase clientes fetch warning:', error.message);
        return { rows: [], columns: null };
      }
      const rows = (data || []) as any[];
      if (rows.length === 0) return { rows, columns: null };
      return { rows, columns: this.detectClientesColumnsFromRow(rows[0]) };
    } catch (err) {
      console.warn('Supabase clientes fetch error:', err);
      return { rows: [], columns: null };
    }
  },

  async fetchClientsMap(): Promise<Map<string, { name: string }>> {
    const map = new Map<string, { name: string }>();
    const { rows, columns } = await this.fetchClientesRowsRaw();
    if (!columns) return map;

    for (const row of rows) {
      const nit = this.normalizeDocumentNumber(row[columns.docColumn]);
      const name = this.cleanClientName(row[columns.nameColumn]);
      if (!nit || !this.isUsableClientName(name)) continue;
      map.set(nit, { name });
    }
    return map;
  },

  async syncClientsFromInvoices(invoices: Invoice[]) {
    const payloadByNit = new Map<string, { nit: string; name: string }>();

    for (const invoice of invoices) {
      const nit = this.normalizeDocumentNumber(invoice.documentNumber);
      const name = this.cleanClientName(invoice.clientName);
      if (!nit || !this.isUsableClientName(name)) continue;
      payloadByNit.set(nit, { nit, name });
    }

    const payload = Array.from(payloadByNit.values());
    if (payload.length === 0) return;

    const { columns } = await this.fetchClientesRowsRaw();
    const docColumn = columns?.docColumn || 'nit';
    const nameColumn = columns?.nameColumn || 'name';

    const primaryPayload = payload.map((item) => ({
      [docColumn]: item.nit,
      [nameColumn]: item.name,
    }));

    let { error } = await supabase
      .from(CLIENTS_TABLE_NAME)
      .upsert(primaryPayload, { onConflict: docColumn });

    if (error) {
      const fallbackPayload = payload.map((item) => ({ nit: item.nit, nombre: item.name }));
      const fallback = await supabase
        .from(CLIENTS_TABLE_NAME)
        .upsert(fallbackPayload, { onConflict: 'nit' });
      error = fallback.error;
    }

    if (error) {
      console.warn('No se pudo sincronizar tabla clientes:', error.message);
    }
  },

  async enrichInvoicesWithClientsTable(invoices: Invoice[]): Promise<Invoice[]> {
    if (!invoices.length) return invoices;
    const clientsMap = await this.fetchClientsMap();

    return invoices.map((invoice) => {
      const documentNumber = this.normalizeDocumentNumber(invoice.documentNumber);
      const knownClient = documentNumber ? clientsMap.get(documentNumber) : null;
      const currentClientName = this.cleanClientName(invoice.clientName);

      if (knownClient?.name) {
        return {
          ...invoice,
          clientName: knownClient.name,
          documentNumber: documentNumber || invoice.documentNumber,
        };
      }

      if (this.isUsableClientName(currentClientName)) {
        return {
          ...invoice,
          clientName: currentClientName,
          documentNumber: documentNumber || invoice.documentNumber,
        };
      }

      return {
        ...invoice,
        clientName: currentClientName || 'CLIENTE NO IDENTIFICADO',
        documentNumber: documentNumber || invoice.documentNumber,
      };
    });
  },

  /**
   * Guarda o actualiza una lista de facturas en la base de datos.
   */
  async syncInvoices(invoices: Invoice[]) {
    try {
      if (!invoices || invoices.length === 0) return null;
      const dedupedInput = this.dedupeInvoicesByInvoiceNumber(invoices);
      const enrichedInvoices = await this.enrichInvoicesWithClientsTable(dedupedInput);
      await this.syncClientsFromInvoices(enrichedInvoices);
      const finalInvoices = await this.enrichInvoicesWithClientsTable(enrichedInvoices);

      // Mapeo limpio de datos
      const dataToSync = finalInvoices.map(inv => {
        const debtValue = this.calculateDebt(inv);
        const status = this.resolveStatusFromDebt(inv.status, debtValue);
        const payload: any = {
          id: inv.id,
          clientName: inv.clientName || '',
          documentType: inv.documentType || null,
          documentNumber: inv.documentNumber || null,
          invoiceNumber: this.normalizeInvoiceNumber(inv.invoiceNumber),
          description: inv.description || '',
          date: inv.date || '',
          dueDate: inv.dueDate || '',
          subtotal: Number(inv.subtotal) || 0,
          iva: Number(inv.iva) || 0,
          total: Number(inv.total) || 0,
          discounts: Number(inv.discounts) || 0,
          reteFuente: Number(inv.reteFuente) || 0,
          reteIva: Number(inv.reteIva) || 0,
          reteIca: Number(inv.reteIca) || 0,
          status,
          debtValue,
          observations: this.sanitizeObservation(inv.observations, inv),
          moraDays: Number(inv.moraDays) || 0,
          documentUrl: inv.documentUrl || null,
          isSynced: true,
          paymentDate: inv.paymentDate || null,
          creditDate: inv.creditDate || null,
          paidAmount: Number(inv.paidAmount) || 0,
          creditAmount: Number(inv.creditAmount) || 0 // Asegúrate que esta columna exista en Supabase
        };

        return payload;
      });

      let { data, error } = await supabase
        .from(TABLE_NAME)
        .upsert(dataToSync, { onConflict: 'id' })
        .select();

      if (error && (error.message.includes('documentType') || error.message.includes('documentNumber'))) {
        const fallbackPayload = dataToSync.map(({ documentType, documentNumber, ...rest }) => rest);
        const fallbackResult = await supabase
          .from(TABLE_NAME)
          .upsert(fallbackPayload, { onConflict: 'id' })
          .select();
        data = fallbackResult.data;
        error = fallbackResult.error;
      }
      
      if (error) {
        console.error('Error de Sincronización Supabase:', error.message);
        // Si el error es de columna faltante, lanzamos una alerta más clara
        if (error.message.includes('creditAmount')) {
          throw new Error('Falta la columna "creditAmount" en la tabla de Supabase. Por favor ejecute el SQL de actualización.');
        }
        throw new Error(`Error al guardar en Supabase: ${error.message}`);
      }
      const observationSyncPayload = dataToSync
        .map((invoice) => ({
          invoiceNumber: this.normalizeInvoiceNumber(invoice.invoiceNumber),
          observations: String(invoice.observations || ''),
        }))
        .filter((invoice) => invoice.invoiceNumber);

      if (observationSyncPayload.length > 0) {
        await Promise.all(
          observationSyncPayload.map((invoice) =>
            supabase
              .from(TABLE_NAME)
              .update({ observations: invoice.observations })
              .eq('invoiceNumber', invoice.invoiceNumber)
          )
        );
      }

      const paymentSyncPayload = dataToSync
        .map((invoice) => ({
          invoiceNumber: this.normalizeInvoiceNumber(invoice.invoiceNumber),
          debtValue: this.calculateDebt(invoice),
          paymentDate: invoice.paymentDate || null,
          paidAmount: Number(invoice.paidAmount) || 0,
          creditDate: invoice.creditDate || null,
          creditAmount: Number(invoice.creditAmount) || 0,
          status: this.resolveStatusFromDebt(invoice.status, this.calculateDebt(invoice)),
        }))
        .filter((invoice) => invoice.invoiceNumber);

      if (paymentSyncPayload.length > 0) {
        await Promise.all(
          paymentSyncPayload.map((invoice) =>
            supabase
              .from(TABLE_NAME)
              .update({
                status: invoice.status,
                debtValue: invoice.debtValue,
                paymentDate: invoice.paymentDate,
                paidAmount: invoice.paidAmount,
                creditDate: invoice.creditDate,
                creditAmount: invoice.creditAmount,
              })
              .eq('invoiceNumber', invoice.invoiceNumber)
          )
        );
      }

      return data;
    } catch (err) {
      console.error('Error Crítico en Supabase Sync:', err);
      throw err;
    }
  },

  /**
   * Obtiene todas las facturas guardadas en la nube.
   */
  async fetchInvoices(): Promise<Invoice[]> {
    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .order('date', { ascending: false });
      
      if (error) {
        console.warn('Supabase Fetch Warning:', error.message);
        return [];
      }
      const rawInvoices = (data as any[]) || [];
      const sanitizedInvoices = rawInvoices.map((row) => {
        const normalizedInvoice: Invoice = {
          id: String(this.getFirstDefined(row, ['id']) || ''),
          clientName: String(this.getFirstDefined(row, ['clientName', 'client_name', 'cliente', 'nombre_cliente']) || ''),
          documentType: this.getFirstDefined(row, ['documentType', 'document_type', 'tipo_documento']) || undefined,
          documentNumber: this.getFirstDefined(row, ['documentNumber', 'document_number', 'nit_cc', 'nit', 'documento']) || undefined,
          invoiceNumber: this.normalizeInvoiceNumber(this.getFirstDefined(row, ['invoiceNumber', 'invoice_number', 'factura', 'numero_factura'])),
          description: String(this.getFirstDefined(row, ['description', 'descripcion']) || ''),
          date: String(this.getFirstDefined(row, ['date', 'fecha', 'fecha_emision']) || ''),
          dueDate: String(this.getFirstDefined(row, ['dueDate', 'due_date', 'fecha_vencimiento']) || this.getFirstDefined(row, ['date', 'fecha', 'fecha_emision']) || ''),
          subtotal: this.toNumber(this.getFirstDefined(row, ['subtotal', 'sub_total'])),
          iva: this.toNumber(this.getFirstDefined(row, ['iva', 'vat'])),
          total: this.toNumber(this.getFirstDefined(row, ['total', 'total_value', 'valor_total'])),
          discounts: this.toNumber(this.getFirstDefined(row, ['discounts', 'descuentos'])),
          reteFuente: this.toNumber(this.getFirstDefined(row, ['reteFuente', 'rete_fuente', 'retencion_fuente'])),
          reteIva: this.toNumber(this.getFirstDefined(row, ['reteIva', 'rete_iva', 'retencion_iva'])),
          reteIca: this.toNumber(this.getFirstDefined(row, ['reteIca', 'rete_ica', 'retencion_ica'])),
          status: this.normalizePaymentStatus(String(this.getFirstDefined(row, ['status', 'estado']) || 'Pendiente por pagar')),
          debtValue: this.toNumber(this.getFirstDefined(row, ['debtValue', 'debt_value', 'deuda', 'saldo'])),
          observations: '',
          moraDays: this.toNumber(this.getFirstDefined(row, ['moraDays', 'mora_days', 'dias_mora'])),
          documentUrl: this.getFirstDefined(row, ['documentUrl', 'document_url']) || undefined,
          isSynced: Boolean(this.getFirstDefined(row, ['isSynced', 'is_synced']) ?? false),
          bankCommission: this.toNumber(this.getFirstDefined(row, ['bankCommission', 'bank_commission', 'comision_bancaria'])),
          creditAmount: this.toNumber(this.getFirstDefined(row, ['creditAmount', 'credit_amount', 'valor_abono', 'abono'])),
          creditDate: this.getFirstDefined(row, ['creditDate', 'credit_date', 'fecha_abono']) || undefined,
          paymentDate: this.getFirstDefined(row, ['paymentDate', 'payment_date', 'fecha_pago']) || undefined,
          paidAmount: this.toNumber(this.getFirstDefined(row, ['paidAmount', 'paid_amount', 'valor_recaudado', 'recaudado'])),
          paidWithWithholdings: this.toNumber(this.getFirstDefined(row, ['paidWithWithholdings', 'paid_with_withholdings'])),
        };

        if ((normalizedInvoice.total || 0) > 0 && (normalizedInvoice.subtotal || 0) <= 0) {
          normalizedInvoice.subtotal = Math.max(0, (normalizedInvoice.total || 0) - (normalizedInvoice.iva || 0));
        }

        normalizedInvoice.observations = this.sanitizeObservation(
          this.getFirstDefined(row, ['observations', 'observation', 'observacion', 'observaciones']) as string,
          normalizedInvoice
        );

        const looksLikeCsvPlaceholder =
          normalizedInvoice.total === 0 &&
          normalizedInvoice.subtotal === 0 &&
          normalizedInvoice.iva === 0 &&
          normalizedInvoice.debtValue === 0 &&
          (
            !normalizedInvoice.date ||
            this.normalizeKey(normalizedInvoice.description) === 'importacionporcsv' ||
            !normalizedInvoice.description
          );

        if (looksLikeCsvPlaceholder) {
          normalizedInvoice.description = '';
          normalizedInvoice.date = '';
          normalizedInvoice.dueDate = '';
        }

        if (normalizedInvoice.total > 0) {
          const expectedDebt =
            this.isNoteCreditStatus(normalizedInvoice.status)
              ? 0
              : this.calculateDebt(normalizedInvoice);

          if (Math.abs((normalizedInvoice.debtValue || 0) - expectedDebt) > 2) {
            normalizedInvoice.debtValue = expectedDebt;
          }
          normalizedInvoice.status = this.resolveStatusFromDebt(normalizedInvoice.status, normalizedInvoice.debtValue || 0);
        }

        return normalizedInvoice;
      });
      const dirtyInvoices = sanitizedInvoices.filter(
        (invoice, index) =>
          (rawInvoices[index]?.observations || '') !== invoice.observations ||
          this.normalizeInvoiceNumber(rawInvoices[index]?.invoiceNumber) !== invoice.invoiceNumber
      );

      if (dirtyInvoices.length > 0) {
        await Promise.all(
          dirtyInvoices.map((invoice) =>
            supabase
              .from(TABLE_NAME)
              .update({
                observations: invoice.observations,
                invoiceNumber: invoice.invoiceNumber,
              })
              .eq('id', invoice.id)
          )
        );
      }

      const enrichedInvoices = await this.enrichInvoicesWithClientsTable(sanitizedInvoices);
      return this.dedupeInvoicesByInvoiceNumber(enrichedInvoices);
    } catch (err) {
      console.error('Error Crítico en Supabase Fetch:', err);
      return [];
    }
  },

  async deleteInvoice(invoice: Pick<Invoice, 'id' | 'invoiceNumber'> | string) {
    try {
      const invoiceId = typeof invoice === 'string' ? String(invoice) : String(invoice.id || '');
      const invoiceNumber =
        typeof invoice === 'string' ? '' : this.normalizeInvoiceNumber(invoice.invoiceNumber);
      const idsToDelete = new Set<string>();
      if (invoiceId) idsToDelete.add(invoiceId);

      if (invoiceNumber) {
        const { data: matches, error: lookupError } = await supabase
          .from(TABLE_NAME)
          .select('id, invoiceNumber')
          .not('invoiceNumber', 'is', null);

        if (lookupError) {
          console.error('Error buscando facturas para eliminar:', lookupError.message);
        } else {
          for (const row of matches || []) {
            if (this.normalizeInvoiceNumber(row.invoiceNumber) === invoiceNumber) {
              idsToDelete.add(String(row.id));
            }
          }
        }
      }

      if (idsToDelete.size === 0) return false;

      const { error } = await supabase
        .from(TABLE_NAME)
        .delete()
        .in('id', Array.from(idsToDelete));

      if (error) {
        console.error('Error al eliminar factura:', error.message);
        throw new Error(`Error al eliminar en Supabase: ${error.message}`);
      }

      return true;
    } catch (err) {
      console.error('Error critico al eliminar factura:', err);
      throw err;
    }
  },

  async fetchBankTransactions(username?: string): Promise<BankTransaction[]> {
    try {
      const path = this.getBankTransactionsStoragePath(username);
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(path);

      if (error) {
        if (!error.message.toLowerCase().includes('not found')) {
          console.warn('No se pudieron cargar movimientos bancarios:', error.message);
        }
        return [];
      }

      const text = await data.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];

      return parsed.map((transaction: any, index: number) => ({
        id: String(transaction?.id || `bank-cloud-${Date.now()}-${index}`),
        date: String(transaction?.date || ''),
        description: String(transaction?.description || 'Movimiento bancario'),
        amount: this.toNumber(transaction?.amount),
        reference: transaction?.reference ? String(transaction.reference) : '',
        isMatched: Boolean(transaction?.isMatched),
      })).filter((transaction) => transaction.amount > 0);
    } catch (err) {
      console.warn('No se pudieron leer movimientos bancarios guardados:', err);
      return [];
    }
  },

  async syncBankTransactions(username: string | undefined, transactions: BankTransaction[]) {
    try {
      const path = this.getBankTransactionsStoragePath(username);
      const payload = JSON.stringify(transactions, null, 2);
      const file = new Blob([payload], { type: 'application/json' });
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(path, file, {
          cacheControl: '0',
          contentType: 'application/json',
          upsert: true,
        });

      if (error) {
        console.warn('No se pudieron guardar movimientos bancarios:', error.message);
        return false;
      }

      return true;
    } catch (err) {
      console.warn('No se pudieron sincronizar movimientos bancarios:', err);
      return false;
    }
  },

  /**
   * Sube un archivo al bucket y retorna la URL pública.
   */
  async uploadDocument(file: File, path: string): Promise<string | null> {
    try {
      const cleanPath = path.replace(/[^\w.-]/g, '_');
      const fileName = `${Date.now()}_${cleanPath}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, file);

      if (uploadError) {
        console.error('Error al subir documento:', uploadError.message);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(uploadData.path);

      return urlData.publicUrl;
    } catch (err) {
      console.error('Error Crítico en Storage:', err);
      return null;
    }
  }
};






