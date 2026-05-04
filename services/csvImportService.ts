import { Invoice, PaymentStatus } from '../types';

const normalizeInvoiceNumber = (value?: string) => {
  const clean = String(value || '')
    .toUpperCase()
    .trim()
    .replace(/[-.]/g, '')
    .replace(/^FV(?=\d)/, 'FING');
  const match = clean.match(/^([A-Z]+)\s*([0-9]+)$/) || clean.match(/^([A-Z]+)([0-9]+)$/);
  if (match) return `${match[1]}${match[2]}`;
  return clean;
};

const isNoteCreditStatus = (status: PaymentStatus) =>
  String(status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '') === 'notacredito';

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const parseDelimited = (text: string, delimiter = ';'): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((item) => String(item || '').trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((item) => String(item || '').trim() !== '')) rows.push(row);
  return rows;
};

const normalizeHeader = (value: string) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const parseNumber = (value: string): number => {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseDate = (value: string): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const [datePart] = raw.split(' ');
  const parts = datePart.split('/');
  if (parts.length !== 3) return '';
  const [day, month, year] = parts;
  const dd = day.padStart(2, '0');
  const mm = month.padStart(2, '0');
  const yyyy = year.padStart(4, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const cleanText = (value: string) =>
  String(value || '')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findIndex = (headers: string[], candidates: string[]) =>
  headers.findIndex((header) => candidates.includes(header));

export const parseCarteraCsv = (text: string): Invoice[] => {
  const rows = parseDelimited(text, ';');
  if (rows.length < 2) return [];

  const normalizedHeaders = rows[0].map(normalizeHeader);
  const clientIndex = findIndex(normalizedHeaders, ['cliente']);
  const invoiceIndex = findIndex(normalizedHeaders, ['facturas']);
  const descriptionIndex = findIndex(normalizedHeaders, ['descripcion']);
  const dateIndex = findIndex(normalizedHeaders, ['fechasfacturas']);
  const subtotalIndex = findIndex(normalizedHeaders, ['subtotal']);
  const ivaIndex = findIndex(normalizedHeaders, ['iva']);
  const totalIndex = findIndex(normalizedHeaders, ['valorfactura']);
  const moraIndex = findIndex(normalizedHeaders, ['diasdemora']);
  const discountsIndex = findIndex(normalizedHeaders, ['descuentos']);
  const debtIndex = findIndex(normalizedHeaders, ['valordeuda']);
  const reteFuenteIndex = findIndex(normalizedHeaders, ['retefuente']);
  const reteIvaIndex = findIndex(normalizedHeaders, ['reteiva']);
  const reteIcaIndex = findIndex(normalizedHeaders, ['reteica']);
  const bankCommissionIndex = findIndex(normalizedHeaders, ['comisionbanco']);
  const creditAmountIndex = findIndex(normalizedHeaders, ['abono']);
  const creditDateIndex = findIndex(normalizedHeaders, ['fechadeabono']);
  const paymentDateIndex = findIndex(normalizedHeaders, ['fechadepago']);
  const paidAmountIndex = findIndex(normalizedHeaders, ['valorpago']);
  const paidWithholdingsIndex = findIndex(normalizedHeaders, ['valorpagadoconretenciones']);
  const observationsIndex = findIndex(normalizedHeaders, ['observaciones']);
  const statusIndex = findIndex(normalizedHeaders, ['estado']);

  if (clientIndex < 0 || invoiceIndex < 0 || totalIndex < 0) return [];

  return rows.slice(1).map((row, idx) => {
    const clientName = cleanText(row[clientIndex]);
    const invoiceNumber = normalizeInvoiceNumber(row[invoiceIndex]);
    const description = cleanText(row[descriptionIndex] || '');
    const date = parseDate(row[dateIndex] || '');
    const subtotal = parseNumber(row[subtotalIndex] || '');
    const iva = parseNumber(row[ivaIndex] || '');
    const total = parseNumber(row[totalIndex] || '');
    const discounts = parseNumber(row[discountsIndex] || '');
    const reteFuente = parseNumber(row[reteFuenteIndex] || '');
    const reteIva = parseNumber(row[reteIvaIndex] || '');
    const reteIca = parseNumber(row[reteIcaIndex] || '');
    const bankCommission = parseNumber(row[bankCommissionIndex] || '');
    const creditAmount = parseNumber(row[creditAmountIndex] || '');
    const paidAmount = parseNumber(row[paidAmountIndex] || '');
    const paidWithWithholdings = parseNumber(row[paidWithholdingsIndex] || '');
    const providedDebt = parseNumber(row[debtIndex] || '');
    const totalDeductions = paidAmount + creditAmount + reteFuente + reteIva + reteIca;
    const statusText = cleanText(row[statusIndex] || '').toUpperCase();
    const rawStatus: PaymentStatus =
      statusText === 'PAGADA'
        ? 'Pagada'
        : statusText === 'NOTA CRÃ‰DITO' || statusText === 'NOTA CREDITO'
          ? 'Nota crédito'
          : 'Pendiente por pagar';
    const calculatedDebt = isNoteCreditStatus(rawStatus)
      ? 0
      : Math.max(0, roundCurrency(total - totalDeductions));
    const debtValue = providedDebt > 0 ? providedDebt : calculatedDebt;
    const status: PaymentStatus = isNoteCreditStatus(rawStatus)
      ? rawStatus
      : debtValue > 0
        ? 'Pendiente por pagar'
        : rawStatus;

    return {
      id: `csv-${Date.now()}-${idx}`,
      clientName: clientName.toUpperCase(),
      invoiceNumber,
      description,
      date,
      dueDate: date,
      subtotal,
      iva,
      total,
      discounts,
      reteFuente,
      reteIva,
      reteIca,
      status,
      debtValue,
      observations: cleanText(row[observationsIndex] || ''),
      moraDays: parseNumber(row[moraIndex] || ''),
      bankCommission,
      creditAmount,
      creditDate: parseDate(row[creditDateIndex] || '') || undefined,
      paymentDate: parseDate(row[paymentDateIndex] || '') || undefined,
      paidAmount,
      paidWithWithholdings,
      isSynced: false,
    };
  }).filter((invoice) => invoice.clientName && invoice.invoiceNumber);
};

