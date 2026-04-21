import React, { useMemo, useRef } from 'react';
import { Upload, CheckCircle2, AlertCircle, Landmark } from 'lucide-react';
import { BankTransaction, Invoice } from '../types';
import { formatCurrency } from '../utils/formatters';

interface ReconciliationMatch {
  transaction: BankTransaction;
  matchedInvoice?: Invoice;
}

interface Props {
  invoices: Invoice[];
  transactions: BankTransaction[];
  onTransactionsChange: (transactions: BankTransaction[]) => void;
}

const normalizeInvoiceKey = (value?: string) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();

const normalizeText = (value?: string) =>
  String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeDocumentNumber = (value?: string) =>
  String(value || '')
    .replace(/[^\d]/g, '')
    .trim();

const extractTokens = (value?: string) =>
  normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !['SAS', 'SAS.', 'LTDA', 'SA', 'S', 'LAS', 'LOS', 'PARA', 'PAGO'].includes(token));

const extractDocumentCandidates = (value?: string) => {
  const matches = String(value || '').match(/\d[\d.\-\s]{5,}\d/g) || [];
  return Array.from(
    new Set(
      matches
        .map((match) => normalizeDocumentNumber(match))
        .filter((candidate) => candidate.length >= 7)
    )
  );
};

const sortInvoicesOldestFirst = (invoices: Invoice[]) =>
  [...invoices].sort(
    (a, b) => new Date(a.date || '1900-01-01').getTime() - new Date(b.date || '1900-01-01').getTime()
  );

const sortTransactionsOldestFirst = (transactions: BankTransaction[]) =>
  [...transactions].sort(
    (a, b) => new Date(a.date || '1900-01-01').getTime() - new Date(b.date || '1900-01-01').getTime()
  );

const amountsMatch = (transactionAmount: number, invoiceAmount: number) => {
  const tx = Math.abs(Number(transactionAmount) || 0);
  const inv = Math.abs(Number(invoiceAmount) || 0);
  if (tx <= 0 || inv <= 0) return false;
  return Math.abs(tx - inv) <= 2;
};

const findDirectInvoiceMatch = (transaction: BankTransaction, invoices: Invoice[]) => {
  const refKey = normalizeInvoiceKey(transaction.reference);
  const descriptionKey = normalizeInvoiceKey(transaction.description);

  if (refKey) {
    const matchedByReference = invoices.find((invoice) => normalizeInvoiceKey(invoice.invoiceNumber) === refKey);
    if (matchedByReference) return matchedByReference;
  }

  if (descriptionKey) {
    const matchedByDescriptionInvoice = invoices.find((invoice) =>
      descriptionKey.includes(normalizeInvoiceKey(invoice.invoiceNumber))
    );
    if (matchedByDescriptionInvoice) return matchedByDescriptionInvoice;
  }

  const transactionAmount = Math.abs(Number(transaction.amount) || 0);
  const descriptionTokens = extractTokens(transaction.description);

  const scoredCandidates = invoices
    .map((invoice) => {
      const clientTokens = extractTokens(invoice.clientName);
      const sharedTokenCount = clientTokens.filter((token) => descriptionTokens.includes(token)).length;
      const amountMatchesTotal = amountsMatch(transactionAmount, invoice.total);
      const amountMatchesDebt = amountsMatch(transactionAmount, invoice.debtValue);
      const amountMatchesPaid = amountsMatch(transactionAmount, invoice.paidAmount || 0);
      const amountMatchesCredit = amountsMatch(transactionAmount, invoice.creditAmount || 0);

      let score = 0;
      if (sharedTokenCount > 0) score += sharedTokenCount * 20;
      if (amountMatchesTotal) score += 35;
      if (amountMatchesDebt) score += 30;
      if (amountMatchesPaid) score += 18;
      if (amountMatchesCredit) score += 18;

      return { invoice, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) return undefined;

  const [bestCandidate, secondCandidate] = scoredCandidates;
  if (!bestCandidate) return undefined;

  if (bestCandidate.score >= 35 && (!secondCandidate || bestCandidate.score > secondCandidate.score)) {
    return bestCandidate.invoice;
  }

  return undefined;
};

const getInvoicePriorityList = (invoices: Invoice[]) => {
  const oldestFirst = sortInvoicesOldestFirst(invoices);
  const pending = oldestFirst.filter((invoice) => invoice.status !== 'Pagada' && (invoice.debtValue || 0) > 0);
  const others = oldestFirst.filter((invoice) => !pending.some((pendingInvoice) => pendingInvoice.id === invoice.id));
  return [...pending, ...others];
};

const resolveTransactionMatches = (transactions: BankTransaction[], invoices: Invoice[]): ReconciliationMatch[] => {
  const matchesByTransactionId = new Map<string, Invoice | undefined>();
  const assignedInvoiceIds = new Set<string>();
  const unmatchedTransactions: BankTransaction[] = [];

  for (const transaction of transactions) {
    const directMatch = findDirectInvoiceMatch(transaction, invoices);
    if (directMatch) {
      matchesByTransactionId.set(transaction.id, directMatch);
      assignedInvoiceIds.add(directMatch.id);
    } else {
      unmatchedTransactions.push(transaction);
    }
  }

  const transactionGroups = new Map<string, BankTransaction[]>();
  unmatchedTransactions.forEach((transaction) => {
    const documentCandidates = extractDocumentCandidates(`${transaction.reference || ''} ${transaction.description || ''}`);
    const groupKey = documentCandidates[0] || '';
    if (!groupKey) return;
    transactionGroups.set(groupKey, [...(transactionGroups.get(groupKey) || []), transaction]);
  });

  transactionGroups.forEach((groupTransactions, documentNumber) => {
    const relatedInvoices = getInvoicePriorityList(
      invoices.filter((invoice) => normalizeDocumentNumber(invoice.documentNumber) === documentNumber)
    );

    const sortedTransactions = sortTransactionsOldestFirst(groupTransactions);
    let candidateIndex = 0;

    sortedTransactions.forEach((transaction) => {
      while (candidateIndex < relatedInvoices.length && assignedInvoiceIds.has(relatedInvoices[candidateIndex].id)) {
        candidateIndex += 1;
      }

      const candidateInvoice = relatedInvoices[candidateIndex];
      if (candidateInvoice) {
        matchesByTransactionId.set(transaction.id, candidateInvoice);
        assignedInvoiceIds.add(candidateInvoice.id);
        candidateIndex += 1;
      }
    });
  });

  for (const transaction of unmatchedTransactions) {
    if (matchesByTransactionId.has(transaction.id)) continue;

    const fallbackMatch = findDirectInvoiceMatch(
      transaction,
      invoices.filter((invoice) => !assignedInvoiceIds.has(invoice.id))
    );

    if (fallbackMatch) {
      matchesByTransactionId.set(transaction.id, fallbackMatch);
      assignedInvoiceIds.add(fallbackMatch.id);
    }
  }

  return transactions.map((transaction) => ({
    transaction,
    matchedInvoice: matchesByTransactionId.get(transaction.id),
  }));
};

const parseAmount = (value: string): number => {
  const cleaned = String(value || '')
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const amount = parseFloat(cleaned);
  return Number.isFinite(amount) ? amount : 0;
};

const splitCsvLine = (line: string, delimiter: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const detectDelimiter = (header: string) => {
  if (header.includes(';')) return ';';
  if (header.includes('\t')) return '\t';
  return ',';
};

const ReconciliationPanel: React.FC<Props> = ({ invoices, transactions, onTransactionsChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo<ReconciliationMatch[]>(() => {
    return resolveTransactionMatches(transactions, invoices);
  }, [invoices, transactions]);

  const summary = useMemo(() => {
    const matched = matches.filter((item) => item.matchedInvoice);
    const unmatched = matches.filter((item) => !item.matchedInvoice);
    return {
      totalTransactions: transactions.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      matchedAmount: matched.reduce((acc, item) => acc + (item.transaction.amount || 0), 0),
      unmatchedAmount: unmatched.reduce((acc, item) => acc + (item.transaction.amount || 0), 0),
    };
  }, [matches, transactions]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const lines = text
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const delimiter = detectDelimiter(lines[0]);
    const headers = splitCsvLine(lines[0], delimiter).map((header) => header.toLowerCase());

    const findHeaderIndex = (candidates: string[]) =>
      headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));

    const dateIndex = findHeaderIndex(['fecha', 'date']);
    const descriptionIndex = findHeaderIndex(['descripcion', 'description', 'concepto', 'detalle']);
    const amountIndex = findHeaderIndex(['valor', 'monto', 'amount', 'credito', 'debito']);
    const referenceIndex = findHeaderIndex(['referencia', 'reference', 'documento', 'factura']);

    const parsedTransactions: BankTransaction[] = lines.slice(1).map((line, index) => {
      const cells = splitCsvLine(line, delimiter);
      return {
        id: `bank-${Date.now()}-${index}`,
        date: dateIndex >= 0 ? (cells[dateIndex] || '') : '',
        description: descriptionIndex >= 0 ? (cells[descriptionIndex] || 'Movimiento bancario') : 'Movimiento bancario',
        amount: amountIndex >= 0 ? parseAmount(cells[amountIndex] || '0') : 0,
        reference: referenceIndex >= 0 ? (cells[referenceIndex] || '') : '',
        isMatched: false,
      };
    }).filter((transaction) => transaction.description || transaction.amount || transaction.reference);

    onTransactionsChange(parsedTransactions);
    if (inputRef.current) inputRef.current.value = '';
  };

  const applyMatches = () => {
    const resolvedMatches = resolveTransactionMatches(transactions, invoices);
    const matchedTransactionIds = new Set(
      resolvedMatches
        .filter((item) => item.matchedInvoice)
        .map((item) => item.transaction.id)
    );

    onTransactionsChange(
      transactions.map((transaction) => {
        return {
          ...transaction,
          isMatched: matchedTransactionIds.has(transaction.id),
        };
      })
    );
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Movimientos</p>
          <p className="mt-3 text-[28px] font-black text-slate-900">{summary.totalTransactions}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Conciliadas</p>
          <p className="mt-3 text-[28px] font-black text-emerald-700">{summary.matchedCount}</p>
          <p className="mt-2 text-xs font-bold text-emerald-600">{formatCurrency(summary.matchedAmount)}</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Pendientes</p>
          <p className="mt-3 text-[28px] font-black text-amber-700">{summary.unmatchedCount}</p>
          <p className="mt-2 text-xs font-bold text-amber-600">{formatCurrency(summary.unmatchedAmount)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-3">
          <input ref={inputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
          <button onClick={() => inputRef.current?.click()} className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0f172a] text-white px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em]">
            <Upload size={14} /> Cargar Extracto
          </button>
          <button onClick={applyMatches} className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-700">
            <CheckCircle2 size={14} /> Conciliar
          </button>
        </div>
      </div>

      <div className="rounded-[1.6rem] border border-slate-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <Landmark size={18} className="text-blue-500" />
          <h2 className="text-sm font-black uppercase tracking-[0.22em] text-slate-700">Conciliacion bancaria</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {matches.length === 0 ? (
            <div className="p-10 text-center text-slate-500 font-medium">
              Carga el extracto bancario para conciliar movimientos contra las facturas.
            </div>
          ) : (
            matches.map(({ transaction, matchedInvoice }) => (
              <div key={transaction.id} className="px-6 py-4 grid grid-cols-1 xl:grid-cols-[160px_1fr_220px_200px] gap-4 items-center">
                <div>
                  <p className="text-xs font-black text-slate-700">{transaction.date || '-'}</p>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.18em] mt-1">
                    {formatCurrency(transaction.amount)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{transaction.description}</p>
                  <p className="text-xs font-bold text-slate-400 mt-1 uppercase">
                    Ref: {transaction.reference || 'Sin referencia'}
                  </p>
                </div>
                <div>
                  {matchedInvoice ? (
                    <>
                      <p className="text-xs font-black text-emerald-600 uppercase tracking-[0.18em]">Factura encontrada</p>
                      <p className="mt-1 text-sm font-black text-slate-800">{matchedInvoice.invoiceNumber}</p>
                      <p className="text-xs font-medium text-slate-500 truncate">{matchedInvoice.clientName}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-black text-amber-600 uppercase tracking-[0.18em]">Sin cruce</p>
                      <p className="mt-1 text-sm font-bold text-slate-500">Revisar manualmente</p>
                    </>
                  )}
                </div>
                <div className="flex xl:justify-end">
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] ${
                    transaction.isMatched || matchedInvoice
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-amber-50 text-amber-600'
                  }`}>
                    {transaction.isMatched || matchedInvoice ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    {transaction.isMatched || matchedInvoice ? 'Conciliada' : 'Pendiente'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ReconciliationPanel;
