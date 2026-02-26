
import React from 'react';
import { Invoice, AIAuditFinding } from '../types';
import { Edit3, Calendar, Landmark, Copy, Check } from 'lucide-react';

interface Props {
  invoices: Invoice[];
  auditFindings: AIAuditFinding[];
  onApplyCorrection: (finding: AIAuditFinding) => void;
  onEdit: (invoice: Invoice) => void;
}

const ReportTable: React.FC<Props> = ({ invoices, onEdit }) => {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const formatCurrency = (val?: number) => {
    const num = val === undefined || val === null ? 0 : val;
    return `$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(num)}`;
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="bg-white rounded-[1rem] shadow-sm overflow-hidden border border-slate-100">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse table-fixed">
          <thead className="bg-[#1e293b]">
            <tr>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-[9px] text-slate-400 border-r border-slate-700/50 w-[35%]">Datos Factura</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-[9px] text-slate-400 border-r border-slate-700/50 w-[20%]">Valores Base</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-[9px] text-slate-400 border-r border-slate-700/50 w-[15%]">Retenciones</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-[9px] text-slate-400 w-[30%]">Valor Pago / Fechas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-20 text-center text-slate-400 italic font-medium">
                  No se encontraron facturas. Inicie sincronización con Siigo.
                </td>
              </tr>
            ) : (
              invoices.map((inv, index) => {
                const amountPaid = inv.paidAmount || 0;
                const creditAmount = inv.creditAmount || 0;
                
                return (
                  <tr key={`${inv.id}-${index}`} className="group transition-all hover:bg-slate-50/50 relative">
                    <td className="p-6 border-r border-slate-50 align-top">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-black text-[13px] text-blue-900 leading-snug uppercase tracking-tight pr-4 break-words">
                          {inv.clientName || 'CLIENTE SIN NOMBRE'}
                        </h4>
                        <button 
                          onClick={() => onEdit(inv)}
                          className="p-1.5 bg-blue-50 text-blue-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>
                      
                      <div className="flex gap-2 mb-3 items-center flex-wrap">
                        <span className="text-slate-400 font-bold text-[10px]">{inv.date}</span>
                        <span className="text-slate-300 font-bold text-[10px]">|</span>
                        <div className="flex items-center gap-1 group/copy cursor-pointer" onClick={() => handleCopy(inv.invoiceNumber, inv.id)}>
                          <span className="text-slate-900 font-black text-[10px] uppercase tracking-wide">{inv.invoiceNumber}</span>
                          {copiedId === inv.id ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} className="text-slate-300 opacity-0 group-hover/copy:opacity-100" />}
                        </div>
                        <span className="text-slate-400 font-bold text-[10px]">({inv.moraDays || 0} d)</span>
                      </div>
                      
                      <p className="text-[10px] text-slate-500 font-medium italic border-l-2 border-slate-200 pl-3 uppercase tracking-tight line-clamp-3">
                        {inv.description}
                      </p>
                    </td>

                    <td className="p-6 border-r border-slate-50 align-top">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase font-black text-[9px] tracking-widest">SUBTOTAL:</span>
                          <span className="font-bold text-slate-600 text-xs">{formatCurrency(inv.subtotal)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase font-black text-[9px] tracking-widest">IVA:</span>
                          <span className="font-bold text-slate-600 text-xs">{formatCurrency(inv.iva)}</span>
                        </div>
                        <div className="pt-3 mt-1 border-t border-slate-50 flex justify-between items-center">
                          <span className="text-slate-900 font-black text-[11px] uppercase tracking-widest">DEUDA:</span>
                          <span className={`font-black text-lg ${inv.debtValue > 0 ? 'text-[#ef4444]' : 'text-emerald-600'}`}>
                            {formatCurrency(inv.debtValue)}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="p-6 border-r border-slate-50 align-top">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase font-black text-[9px] tracking-widest">R. FUENTE:</span>
                          <span className="font-bold text-slate-500 text-xs">{formatCurrency(inv.reteFuente)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase font-black text-[9px] tracking-widest">R. IVA:</span>
                          <span className="font-bold text-slate-500 text-xs">{formatCurrency(inv.reteIva)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase font-black text-[9px] tracking-widest">R. ICA:</span>
                          <span className="font-bold text-slate-500 text-xs">{formatCurrency(inv.reteIca)}</span>
                        </div>
                      </div>
                    </td>

                    <td className="p-6 align-top">
                      <div className="space-y-6">
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col gap-1">
                            <span className="text-slate-400 uppercase font-black text-[9px] tracking-widest">ESTADO:</span>
                            <span className={`font-black text-[8px] px-2 py-1 rounded-sm uppercase tracking-widest self-start ${inv.status === 'Pagada' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                              {inv.status}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-slate-400 uppercase font-black text-[9px] tracking-widest">TOTAL RECAUDADO:</span>
                            <span className={`font-black text-sm ${amountPaid > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {formatCurrency(amountPaid)}
                            </span>
                          </div>
                        </div>

                        <div className="flex justify-between gap-4 border-t border-slate-50 pt-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1 text-[8px] font-black text-emerald-500 uppercase tracking-widest">
                              <Calendar size={12} /> FECHA PAGO
                            </div>
                            <span className="text-[10px] font-bold text-slate-500 ml-4">
                              {inv.paymentDate || '-'}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 items-end">
                            <div className="flex items-center gap-1 text-[8px] font-black text-blue-500 uppercase tracking-widest">
                              <Landmark size={12} /> VALOR ABONO
                            </div>
                            <div className="flex flex-col items-end">
                              <span className={`text-[11px] font-black ${creditAmount > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                                {formatCurrency(creditAmount)}
                              </span>
                              <span className="text-[9px] font-bold text-slate-400">
                                {inv.creditDate || '-'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReportTable;
