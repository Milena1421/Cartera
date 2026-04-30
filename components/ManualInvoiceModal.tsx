import React, { useState, useEffect } from 'react';
import { X, Save, FileText, User, Calendar, DollarSign, AlignLeft, PieChart, Landmark } from 'lucide-react';
import { Invoice, PaymentStatus } from '../types';
import { formatDecimalValue } from '../utils/formatters';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (invoice: Invoice) => Promise<void> | void;
  initialData?: Invoice | null;
}

const ManualInvoiceModal: React.FC<Props> = ({ isOpen, onClose, onSave, initialData }) => {
  const normalizeDocumentNumber = (value: string): string => String(value || '').replace(/[.\s-]/g, '').trim();
  const NOTE_CREDIT_STATUS = (["Nota cr", String.fromCharCode(233), "dito"].join("")) as PaymentStatus;
  const normalizePaymentStatus = (value?: string): PaymentStatus => {
    const raw = String(value || '').trim();
    const normalized = raw
      .replace(/é/g, 'e')
       .replace(/\uFFFD/g, 'e')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');

    if (normalized === 'pagada') return 'Pagada';
    if (normalized === 'notacredito' || (/notacr.*dito/.test(normalized) && normalized.startsWith('nota'))) return NOTE_CREDIT_STATUS;
    return 'Pendiente por pagar';
  };
  const statusOptions = [
    { key: 'pending', value: 'Pendiente por pagar' as PaymentStatus, label: 'Pendiente' },
    { key: 'paid', value: 'Pagada' as PaymentStatus, label: 'Pagada' },
    { key: 'note_credit', value: NOTE_CREDIT_STATUS, label: NOTE_CREDIT_STATUS },
  ];

  const getStatusOptionKey = (value?: string) => {
    const normalized = normalizePaymentStatus(value);
    return statusOptions.find((option) => option.value === normalized)?.key || 'pending';
  };
  const parseNumericInput = (value: string): number => {
    const trimmed = String(value ?? '').trim();
    if (trimmed === '') return 0;
    const cleaned = trimmed.replace(/\$/g, '').replace(/\s/g, '');
    let normalized = cleaned;

    if (cleaned.includes('.') && cleaned.includes(',')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (cleaned.includes(',')) {
      const decimalPart = cleaned.split(',').pop() || '';
      normalized = decimalPart.length <= 2 ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
    } else if (cleaned.includes('.')) {
      const decimalPart = cleaned.split('.').pop() || '';
      normalized = decimalPart.length <= 2 ? cleaned.replace(/,/g, '') : cleaned.replace(/\./g, '');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const [formData, setFormData] = useState({
    clientName: '',
    documentType: '',
    documentNumber: '',
    invoiceNumber: '',
    description: '',
    observations: '',
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    subtotal: '',
    iva: '',
    total: '',
    status: 'Pendiente por pagar' as PaymentStatus,
    paymentDate: '',
    creditDate: '',
    creditAmount: '',
    paidAmount: '',
    reteFuente: '',
    reteIva: '',
    reteIca: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSaveError(null);
    setIsSaving(false);
    if (initialData) {
      setFormData({
        clientName: initialData.clientName,
        documentType: initialData.documentType || '',
        documentNumber: initialData.documentNumber || '',
        invoiceNumber: initialData.invoiceNumber,
        description: initialData.description,
        observations: initialData.observations || '',
        date: initialData.date,
        dueDate: initialData.dueDate || initialData.date,
        subtotal: formatDecimalValue(initialData.subtotal),
        iva: formatDecimalValue(initialData.iva),
        total: formatDecimalValue(initialData.total),
        status: normalizePaymentStatus(initialData.status),
        paymentDate: initialData.paymentDate || '',
        creditDate: initialData.creditDate || '',
        creditAmount: initialData.creditAmount !== undefined ? formatDecimalValue(initialData.creditAmount) : '',
        paidAmount: initialData.paidAmount !== undefined ? formatDecimalValue(initialData.paidAmount) : '',
        reteFuente: initialData.reteFuente !== undefined ? formatDecimalValue(initialData.reteFuente) : '',
        reteIva: initialData.reteIva !== undefined ? formatDecimalValue(initialData.reteIva) : '',
        reteIca: initialData.reteIca !== undefined ? formatDecimalValue(initialData.reteIca) : '',
      });
    } else {
      const today = new Date().toISOString().split('T')[0];
      setFormData({
        clientName: '',
        documentType: '',
        documentNumber: '',
        invoiceNumber: '',
        description: '',
        observations: '',
        date: today,
        dueDate: today,
        subtotal: '',
        iva: '',
        total: '',
        status: 'Pendiente por pagar',
        paymentDate: '',
        creditDate: '',
        creditAmount: '',
        paidAmount: '',
        reteFuente: '',
        reteIva: '',
        reteIca: '',
      });
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const normalizeInv = (val: string): string => {
    const clean = val.toUpperCase().trim().replace(/[-.]/g, '').replace(/^FV(?=\d)/, 'FING');
    const match = clean.match(/^([A-Z]+)\s*([0-9]+)$/) || clean.match(/^([A-Z]+)([0-9]+)$/);
    if (match) return `${match[1]}${match[2]}`;
    return clean;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const subtotalNum = parseNumericInput(formData.subtotal);
    const ivaNum = parseNumericInput(formData.iva);
    const totalNum = formData.total.trim() === '' ? (subtotalNum + ivaNum) : parseNumericInput(formData.total);
    const paidNum = parseNumericInput(formData.paidAmount);
    const creditNum = parseNumericInput(formData.creditAmount);
    const rf = parseNumericInput(formData.reteFuente);
    const ri = parseNumericInput(formData.reteIva);
    const rc = parseNumericInput(formData.reteIca);

    const totalDeductions = paidNum + creditNum + rf + ri + rc;
    const normalizedStatus = normalizePaymentStatus(formData.status);
    const debt = normalizedStatus === 'Pagada' || normalizedStatus === 'Nota cr\u00E9dito' ? 0 : Math.max(0, totalNum - totalDeductions);

    const invoiceData: Invoice = {
      ...(initialData || {}),
      id: initialData?.id || `manual-${Date.now()}`,
      clientName: formData.clientName.toUpperCase(),
      documentType: formData.documentType || undefined,
      documentNumber: normalizeDocumentNumber(formData.documentNumber) || undefined,
      invoiceNumber: normalizeInv(formData.invoiceNumber),
      description: formData.description,
      date: formData.date,
      dueDate: formData.dueDate,
      subtotal: subtotalNum,
      iva: ivaNum,
      total: totalNum,
      discounts: initialData?.discounts || 0,
      reteFuente: rf,
      reteIva: ri,
      reteIca: rc,
      status: normalizedStatus,
      paymentDate: formData.paymentDate || undefined,
      creditDate: formData.creditDate || undefined,
      creditAmount: creditNum,
      paidAmount: paidNum,
      debtValue: debt,
      observations: formData.observations,
      moraDays: 0,
      isSynced: initialData?.isSynced || false
    };

    try {
      setIsSaving(true);
      setSaveError(null);
      await onSave(invoiceData);
      onClose();
    } catch (error: any) {
      setSaveError(error?.message || 'No se pudo guardar la factura.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-100 scale-in-center my-8">
        <div className="bg-[#0f172a] px-10 py-8 flex items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-600/20">
              <FileText size={24} />
            </div>
            <div>
              <h2 className="font-black text-xl tracking-tight uppercase">
                {initialData ? 'Editar Factura' : 'Nueva Factura'}
              </h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.3em]">Gestion de recaudo e informacion</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-10 space-y-8 custom-scrollbar max-h-[75vh] overflow-y-auto">
          <div className="space-y-5">
            <h3 className="text-[11px] font-black text-blue-600 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Datos basicos</h3>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <User size={12} className="text-blue-500" /> Cliente
              </label>
              <input required type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none uppercase" value={formData.clientName} onChange={e => setFormData({ ...formData, clientName: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <User size={12} className="text-blue-500" /> Tipo documento
                </label>
                <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none uppercase text-slate-700 cursor-pointer" value={formData.documentType || 'NO DEFINIDO'} onChange={e => setFormData({ ...formData, documentType: e.target.value })}>
                  <option value="NO DEFINIDO">NO DEFINIDO</option>
                  <option value="NIT">NIT</option>
                  <option value="CC">CC</option>
                  <option value="CE">CE</option>
                  <option value="TI">TI</option>
                  <option value="PASAPORTE">PASAPORTE</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <User size={12} className="text-blue-500" /> NIT / CC
                </label>
                <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none uppercase text-slate-700" placeholder="Ej: 900123456" value={formData.documentNumber} onChange={e => setFormData({ ...formData, documentNumber: normalizeDocumentNumber(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <FileText size={12} className="text-blue-500" /> No. factura
                </label>
                <input required type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none uppercase" value={formData.invoiceNumber} onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <DollarSign size={12} className="text-blue-500" /> Subtotal
                </label>
                <input type="text" inputMode="decimal" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.subtotal} onChange={e => setFormData({ ...formData, subtotal: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <DollarSign size={12} className="text-blue-500" /> IVA
                </label>
                <input type="text" inputMode="decimal" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.iva} onChange={e => setFormData({ ...formData, iva: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <DollarSign size={12} className="text-blue-500" /> Valor total
                </label>
                <input type="text" inputMode="decimal" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.total} onChange={e => setFormData({ ...formData, total: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Calendar size={12} className="text-blue-500" /> Fecha emision
                </label>
                <input required type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Calendar size={12} className="text-orange-500" /> Fecha vencimiento
                </label>
                <input required type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none border-orange-100" value={formData.dueDate} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <h3 className="text-[11px] font-black text-emerald-600 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Control de recaudo</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <PieChart size={12} className="text-emerald-500" /> Estado pago
                </label>
                <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none cursor-pointer" value={getStatusOptionKey(formData.status)} onChange={e => { const selected = statusOptions.find((option) => option.key === e.target.value); setFormData({ ...formData, status: selected?.value || 'Pendiente por pagar' }); }}>
                  {statusOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <DollarSign size={12} className="text-emerald-500" /> Valor recaudado (total)
                </label>
                <input type="text" inputMode="decimal" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.paidAmount} onChange={e => setFormData({ ...formData, paidAmount: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-blue-50/50 rounded-2xl border border-blue-100">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                  <Landmark size={12} /> Valor abono
                </label>
                <input type="text" inputMode="decimal" placeholder="Monto del abono" className="w-full bg-white border border-blue-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none focus:border-blue-500" value={formData.creditAmount} onChange={e => setFormData({ ...formData, creditAmount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                  <Calendar size={12} /> Fecha abono
                </label>
                <input type="date" className="w-full bg-white border border-blue-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none focus:border-blue-500" value={formData.creditDate} onChange={e => setFormData({ ...formData, creditDate: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Calendar size={12} className="text-emerald-500" /> Fecha recaudo final (pago)
              </label>
              <input type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.paymentDate} onChange={e => setFormData({ ...formData, paymentDate: e.target.value })} />
            </div>
          </div>

          <div className="space-y-5">
            <h3 className="text-[11px] font-black text-amber-600 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Retenciones manuales</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">R. Fuente</label>
                <input type="text" inputMode="decimal" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" value={formData.reteFuente} onChange={e => setFormData({ ...formData, reteFuente: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">R. IVA</label>
                <input type="text" inputMode="decimal" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" value={formData.reteIva} onChange={e => setFormData({ ...formData, reteIva: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">R. ICA</label>
                <input type="text" inputMode="decimal" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" value={formData.reteIca} onChange={e => setFormData({ ...formData, reteIca: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <AlignLeft size={12} className="text-blue-500" /> Descripcion
              </label>
              <textarea rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-medium outline-none resize-none" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <AlignLeft size={12} className="text-blue-500" /> Observaciones
              </label>
              <textarea rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-medium outline-none resize-none" value={formData.observations} onChange={e => setFormData({ ...formData, observations: e.target.value })} />
            </div>
          </div>

          {saveError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
              {saveError}
            </div>
          )}

          <div className="pt-6 flex gap-4">
            <button type="button" disabled={isSaving} onClick={onClose} className="flex-1 px-8 py-5 rounded-2xl border-2 border-slate-100 text-slate-400 font-black text-[11px] uppercase tracking-[0.2em] hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed">Cancelar</button>
            <button type="submit" disabled={isSaving} className="flex-1 px-8 py-5 rounded-2xl bg-[#0f172a] text-white font-black text-[11px] uppercase tracking-[0.2em] shadow-2xl hover:bg-blue-600 transition-all flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed">
              <Save size={18} /> {isSaving ? 'Guardando...' : (initialData ? 'Actualizar Factura' : 'Guardar Factura')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ManualInvoiceModal;








