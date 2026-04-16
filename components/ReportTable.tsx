import React from 'react';
import { Invoice, AIAuditFinding } from '../types';
import { Edit3, Calendar, Landmark, Copy, Check, Trash2 } from 'lucide-react';

interface Props {
  invoices: Invoice[];
  auditFindings: AIAuditFinding[];
  onApplyCorrection: (finding: AIAuditFinding) => void;
  onEdit: (invoice: Invoice) => void;
  onDelete?: (invoice: Invoice) => void;
  onSelectInvoice?: (invoice: Invoice) => void;
  selectedInvoiceId?: string | null;
  canEdit?: boolean;
}

const ReportTable: React.FC<Props> = ({
  invoices,
  onEdit,
  onDelete,
  onSelectInvoice,
  selectedInvoiceId = null,
  canEdit = true
}) => {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const normalizeDigits = (value?: string) =>
    String(value || '').replace(/[^\d]/g, '').trim();

  const getClientDisplayName = (invoice: Invoice) => {
    const clientName = String(invoice.clientName || '').trim();
    const normalizedClientDigits = normalizeDigits(clientName);
    const normalizedDocumentDigits = normalizeDigits(invoice.documentNumber);

    if (!clientName) return 'CLIENTE NO IDENTIFICADO';
    if (/^\d{6,}$/.test(normalizedClientDigits)) {
      if (normalizedDocumentDigits && normalizedClientDigits === normalizedDocumentDigits) {
        return 'CLIENTE NO IDENTIFICADO';
      }
      return 'CLIENTE NO IDENTIFICADO';
    }
    return clientName;
  };

  const shouldShowDocumentLine = (invoice: Invoice) => {
    const normalizedClientDigits = normalizeDigits(invoice.clientName);
    const normalizedDocumentDigits = normalizeDigits(invoice.documentNumber);
    if (!invoice.documentNumber && !invoice.documentType) return false;
    if (normalizedClientDigits && normalizedClientDigits === normalizedDocumentDigits) return true;
    return true;
  };

  const formatCurrency = (val?: number) => {
    const num = val === undefined || val === null ? 0 : val;
    return `$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(num)}`;
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusStripeClass = (status: string) => {
    if (status === 'Pagada') return 'bg-emerald-500';
    if (status === 'Nota cr�dito' || status === 'Nota crédito' || status === 'Nota crÃ©dito') return 'bg-amber-400';
    return 'bg-red-500';
  };

  const isNoteCreditStatus = (status?: string) => {
    const normalized = String(status || '')
      .replace(/é/g, 'e')
      .replace(/Ã©/g, 'e')
      .replace(/\uFFFD/g, 'e')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');
    return normalized === 'notacredito' || (/notacr.*dito/.test(normalized) && normalized.startsWith('nota'));
  };

  return (
    <div className="space-y-5">
      {invoices.length === 0 ? (
        <div className="bg-white rounded-[1rem] shadow-sm overflow-hidden border border-slate-100 p-20 text-center text-slate-500 italic font-medium">
          No se encontraron facturas. Inicie sincronización con Siigo.
        </div>
      ) : (
        invoices.map((inv, index) => {
          const amountPaid = inv.paidAmount || 0;
          const creditAmount = inv.creditAmount || 0;
          const displayDebt = isNoteCreditStatus(inv.status) ? 0 : Number(inv.debtValue || 0);
          const isSelected = selectedInvoiceId === inv.id;

          return (
            <article
              key={`${inv.id}-${index}`}
              onClick={() => onSelectInvoice?.(inv)}
              className={`group overflow-hidden rounded-[1.4rem] border shadow-sm transition-all ${
                isSelected
                  ? 'bg-blue-100 border-blue-700 shadow-lg shadow-blue-200'
                  : index % 2 === 0
                    ? 'bg-white border-slate-200'
                    : 'bg-slate-50/80 border-slate-200'
              } hover:border-blue-300 hover:shadow-md cursor-pointer`}
            >
              <div className={`h-2 ${getStatusStripeClass(inv.status)}`} />

              <div className="p-6 md:p-7">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-black text-[20px] md:text-[24px] text-blue-900 leading-snug uppercase tracking-tight break-words">
                          {getClientDisplayName(inv)}
                        </h3>

                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 border bg-slate-50 border-slate-200">
                          <span className="text-slate-500 font-bold text-[13px]">{inv.date}</span>
                          <span className="text-slate-400 font-bold text-[13px]">|</span>
                          <div
                            className="flex items-center gap-1 group/copy cursor-pointer"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleCopy(inv.invoiceNumber, inv.id);
                            }}
                          >
                            <span className="text-slate-900 font-black text-[13px] uppercase tracking-wide">{inv.invoiceNumber}</span>
                            {copiedId === inv.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} className="text-slate-400 opacity-0 group-hover/copy:opacity-100" />}
                          </div>
                          <span className="text-slate-500 font-bold text-[13px]">({inv.moraDays || 0} d)</span>
                        </div>
                      </div>

                      {canEdit && (
                        <div className="hidden xl:flex items-center gap-2 shrink-0">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              onEdit(inv);
                            }}
                            className="p-2 bg-blue-50 text-blue-600 rounded-lg"
                            title="Editar factura"
                          >
                            <Edit3 size={16} />
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              onDelete?.(inv);
                            }}
                            className="p-2 bg-red-50 text-red-600 rounded-lg"
                            title="Eliminar factura"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-col gap-3">
                      {shouldShowDocumentLine(inv) && (
                        <p className="text-[13px] text-slate-600 font-black uppercase tracking-wide">
                          {inv.documentType || 'DOC'} {inv.documentNumber || 'SIN NUMERO'}
                        </p>
                      )}
                      <p className="text-[13px] text-slate-600 font-medium italic border-l-2 border-slate-400 pl-3 uppercase tracking-tight line-clamp-3">
                        {inv.description}
                      </p>
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex xl:hidden items-center gap-2 shrink-0">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(inv);
                        }}
                        className="p-2 bg-blue-50 text-blue-600 rounded-lg"
                        title="Editar factura"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete?.(inv);
                        }}
                        className="p-2 bg-red-50 text-red-600 rounded-lg"
                        title="Eliminar factura"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  <section className="rounded-2xl px-5 py-5 shadow-sm border bg-white border-slate-200">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-4">Valores Base</p>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500 uppercase font-black text-[10px] tracking-[0.18em]">Subtotal</span>
                        <span className="text-sm font-bold text-slate-600">{formatCurrency(inv.subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500 uppercase font-black text-[10px] tracking-[0.18em]">IVA</span>
                        <span className="text-sm font-bold text-slate-600">{formatCurrency(inv.iva)}</span>
                      </div>
                      <div className="pt-4 mt-1 border-t border-slate-200 flex items-center justify-between gap-3">
                        <span className="text-slate-900 font-black text-[15px] uppercase tracking-widest">Deuda</span>
                        <span className={`text-[34px] leading-none font-black ${displayDebt > 0 ? 'text-[#ef4444]' : 'text-emerald-600'}`}>
                          {formatCurrency(displayDebt)}
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl px-5 py-5 shadow-sm border bg-white border-slate-200">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-4">Retenciones</p>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500 uppercase font-black text-[10px] tracking-[0.18em]">R. Fuente</span>
                        <span className="text-sm font-bold text-slate-600">{formatCurrency(inv.reteFuente)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500 uppercase font-black text-[10px] tracking-[0.18em]">R. IVA</span>
                        <span className="text-sm font-bold text-slate-600">{formatCurrency(inv.reteIva)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500 uppercase font-black text-[10px] tracking-[0.18em]">R. ICA</span>
                        <span className="text-sm font-bold text-slate-600">{formatCurrency(inv.reteIca)}</span>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl px-5 py-5 shadow-sm border lg:col-span-2 xl:col-span-1 bg-white border-slate-200">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-500 uppercase font-black text-[10px] tracking-widest">Estado</span>
                        <span className={`font-black text-[10px] px-3 py-1.5 rounded-sm uppercase tracking-widest self-start ${inv.status === 'Pagada' ? 'bg-emerald-50 text-emerald-600' : inv.status === 'Nota cr�dito' || inv.status === 'Nota crédito' || inv.status === 'Nota crÃ©dito' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                          {inv.status}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-slate-500 uppercase font-black text-[10px] tracking-widest">Total Recaudado</span>
                        <span className={`font-black text-[24px] leading-none ${amountPaid > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                          {formatCurrency(amountPaid)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 text-[10px] font-black text-emerald-500 uppercase tracking-widest">
                          <Calendar size={13} /> Fecha Pago
                        </div>
                        <span className="text-[13px] font-bold text-slate-600 ml-4">
                          {inv.paymentDate || '-'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 sm:items-end">
                        <div className="flex items-center gap-1 text-[10px] font-black text-blue-500 uppercase tracking-widest">
                          <Landmark size={13} /> Valor Abono
                        </div>
                        <div className="flex flex-col sm:items-end">
                          <span className={`text-[24px] leading-none font-black ${creditAmount > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                            {formatCurrency(creditAmount)}
                          </span>
                          <span className="text-[11px] font-bold text-slate-400 mt-1">
                            {inv.creditDate || '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {String(inv.observations || '').trim() && (
                  <section className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/70 px-5 py-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700 mb-2">
                      Observaciones
                    </p>
                    <p className="text-[12px] font-medium text-slate-700 whitespace-pre-wrap">
                      {inv.observations}
                    </p>
                  </section>
                )}
              </div>
            </article>
          );
        })
      )}
    </div>
  );
};

export default ReportTable;

