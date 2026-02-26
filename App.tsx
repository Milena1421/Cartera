
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  LayoutDashboard, 
  Search,
  RefreshCw,
  ShieldCheck,
  FileText,
  Download,
  FileUp,
  PlusCircle,
  Calendar,
  User as UserIcon,
  X,
  CloudCheck,
  Loader2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import DashboardStats from './components/DashboardStats';
import ReportTable from './components/ReportTable';
import ManualInvoiceModal from './components/ManualInvoiceModal';
import { MOCK_INVOICES } from './constants';
import { Invoice, FinancialStats, AIAuditFinding, PaymentStatus } from './types';
import { siigoService } from './services/siigoService';
import { runAIAudit, parseCSVWithAI, auditSiigoMapping } from './services/geminiService';
import { supabaseService } from './services/supabaseService';

const App: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [auditFindings, setAuditFindings] = useState<AIAuditFinding[]>([]);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [cloudStatus, setCloudStatus] = useState<'connected' | 'syncing' | 'error'>('connected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const months = [
    { value: 'all', label: 'Todos los meses' },
    { value: '01', label: 'Enero' },
    { value: '02', label: 'Febrero' },
    { value: '03', label: 'Marzo' },
    { value: '04', label: 'Abril' },
    { value: '05', label: 'Mayo' },
    { value: '06', label: 'Junio' },
    { value: '07', label: 'Julio' },
    { value: '08', label: 'Agosto' },
    { value: '09', label: 'Septiembre' },
    { value: '10', label: 'Octubre' },
    { value: '11', label: 'Noviembre' },
    { value: '12', label: 'Diciembre' },
  ];

  const statuses = [
    { value: 'all', label: 'Todos los estados' },
    { value: 'Pendiente por pagar', label: 'Pendiente' },
    { value: 'Pagada', label: 'Pagada' },
    { value: 'Nota crédito', label: 'Nota Crédito' },
  ];

  const uniqueClients = useMemo(() => {
    const clients = invoices.map(inv => inv.clientName).filter(Boolean);
    return ['all', ...Array.from(new Set(clients))].sort();
  }, [invoices]);

  const loadInitialData = useCallback(async () => {
    setIsSyncing(true);
    setCloudStatus('syncing');
    try {
      const cloudInvoices = await supabaseService.fetchInvoices();
      if (cloudInvoices.length > 0) {
        setInvoices(cloudInvoices);
      } else {
        setInvoices(MOCK_INVOICES);
      }
      setCloudStatus('connected');
    } catch (err) {
      setCloudStatus('error');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const syncNewInvoices = useCallback(async () => {
    setIsSyncing(true);
    setCloudStatus('syncing');
    setErrorMessage(null);
    try {
      // 1. Obtener datos de Siigo (Incluye RAW para auditoría)
      const { invoices: siigoInvoices, raw } = await siigoService.getInvoices();
      
      if (siigoInvoices && siigoInvoices.length > 0) {
        // 2. Auditoría Interna con IA para corregir mapeos (Cruce de campos)
        const auditedInvoices = await auditSiigoMapping(siigoInvoices, raw);
        
        // 3. Persistir datos limpios
        await supabaseService.syncInvoices(auditedInvoices);
        const updatedMaster = await supabaseService.fetchInvoices();
        setInvoices(updatedMaster);
      }
      setCloudStatus('connected');
    } catch (err: any) {
      setCloudStatus('error');
      setErrorMessage(err.message || 'Error de sincronización con Siigo/Auditoría.');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const handleCSVUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setCloudStatus('syncing');
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      try {
        const cleanedInvoices = await parseCSVWithAI(text);
        if (cleanedInvoices.length > 0) {
          await supabaseService.syncInvoices(cleanedInvoices);
          const updatedMaster = await supabaseService.fetchInvoices();
          setInvoices(updatedMaster);
          setCloudStatus('connected');
        }
      } catch (err: any) {
        setCloudStatus('error');
        setErrorMessage(err.message || 'Error al importar CSV.');
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleManualInvoiceSave = async (invoiceData: Invoice) => {
    setCloudStatus('syncing');
    setErrorMessage(null);
    try {
      await supabaseService.syncInvoices([invoiceData]);
      const updatedMaster = await supabaseService.fetchInvoices();
      setInvoices(updatedMaster);
      setEditingInvoice(null);
      setCloudStatus('connected');
    } catch (err: any) {
      setCloudStatus('error');
      setErrorMessage(err.message || 'No se pudo guardar la factura.');
    }
  };

  const filteredInvoices = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return invoices
      .map(inv => {
        let currentMora = 0;
        if (inv.status !== 'Pagada' && inv.dueDate) {
          const due = new Date(inv.dueDate);
          due.setHours(0, 0, 0, 0);
          const diffTime = today.getTime() - due.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          currentMora = diffDays > 0 ? diffDays : 0;
        }
        return { ...inv, moraDays: currentMora };
      })
      .filter(inv => {
        const matchesSearch = (inv.clientName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
                             (inv.invoiceNumber?.toLowerCase() || '').includes(searchTerm.toLowerCase());
        const matchesMonth = selectedMonth === 'all' || (inv.date && inv.date.split('-')[1] === selectedMonth);
        const matchesClient = selectedClient === 'all' || inv.clientName === selectedClient;
        const matchesStatus = selectedStatus === 'all' || inv.status === selectedStatus;
        return matchesSearch && matchesMonth && matchesClient && matchesStatus;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, searchTerm, selectedMonth, selectedClient, selectedStatus]);

  const stats: FinancialStats = useMemo(() => {
    const totalInvoiced = filteredInvoices.reduce((acc, inv) => acc + (inv.total || 0), 0);
    const totalCollected = filteredInvoices.reduce((acc, inv) => {
      const recaudo = inv.status === 'Pagada' ? ((inv.paidAmount || inv.total) || 0) : (inv.paidAmount || 0);
      const abono = inv.creditAmount || 0;
      return acc + recaudo + abono;
    }, 0);
    const totalPending = filteredInvoices.reduce((acc, inv) => acc + (inv.debtValue || 0), 0);
    const totalOverdue = filteredInvoices.filter(i => i.moraDays && i.moraDays > 0).reduce((acc, inv) => acc + (inv.debtValue || 0), 0);
    return { totalInvoiced, totalCollected, totalPending, totalOverdue, averageMoraDays: 0 };
  }, [filteredInvoices]);

  useEffect(() => { loadInitialData(); }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleCSVUpload} />
      <ManualInvoiceModal isOpen={isManualModalOpen} onClose={() => { setIsManualModalOpen(false); setEditingInvoice(null); }} onSave={handleManualInvoiceSave} initialData={editingInvoice} />

      <aside className="w-64 bg-[#0f172a] text-slate-400 hidden lg:flex flex-col border-r border-slate-800 shrink-0">
        <div className="p-6">
          <div className="flex items-center gap-3 text-white mb-10">
            <div className="bg-blue-600 p-2.5 rounded-xl shadow-lg shadow-blue-600/20"><ShieldCheck className="w-5 h-5" /></div>
            <span className="font-black text-lg tracking-tight">Ingeniería 365</span>
          </div>
          <nav className="space-y-1">
            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-600 text-white font-black"><LayoutDashboard size={18} /> <span className="text-sm">Dashboard</span></button>
            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/50 hover:text-slate-200 font-bold"><FileText size={18} /> <span className="text-sm">Conciliación</span></button>
          </nav>
          <div className="mt-10 pt-8 border-t border-slate-800/50 space-y-4">
            <p className="px-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Operaciones</p>
            <button onClick={() => setIsManualModalOpen(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/50 hover:text-slate-200 transition-all text-left"><PlusCircle size={18} className="text-blue-400" /> <span className="text-sm font-bold">Nueva Factura</span></button>
            <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/50 hover:text-slate-200 transition-all text-left"><FileUp size={18} className="text-blue-400" /> <span className="text-sm font-bold">Importar Cartera (CSV)</span></button>
            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/50 hover:text-slate-200 transition-all text-left"><Download size={18} className="text-blue-400" /> <span className="text-sm font-bold">Exportar Reporte</span></button>
          </div>
        </div>
        <div className="mt-auto p-6">
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${cloudStatus === 'error' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-800/30 text-blue-400 border-slate-800/50'}`}>
            {cloudStatus === 'error' ? <AlertCircle size={16} /> : <CloudCheck size={16} className={cloudStatus === 'syncing' ? 'animate-pulse' : ''} />}
            <span className="text-[10px] font-black uppercase tracking-widest">
              {cloudStatus === 'error' ? 'Error Sync' : 'Estado: Sincronizado'}
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white px-8 py-4 border-b border-slate-100 flex flex-col gap-4 shrink-0">
          {errorMessage && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-2 rounded-lg text-[10px] font-bold flex items-center justify-between animate-in slide-in-from-top duration-300">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} />
                <span>{errorMessage}</span>
              </div>
              <button onClick={() => setErrorMessage(null)}><X size={14} /></button>
            </div>
          )}
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 w-full">
                <Search size={18} className="text-slate-400" />
                <input type="text" placeholder="Buscar por cliente o factura..." className="bg-transparent border-none outline-none text-sm w-full font-medium" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
            </div>
            <button onClick={syncNewInvoices} disabled={isSyncing} className="flex items-center gap-3 bg-[#0f172a] text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50">
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} /> {isSyncing ? 'AUDITANDO...' : 'BUSCAR NUEVAS'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-2 flex items-center gap-2">
              <Calendar size={12} className="text-slate-400" />
              <select className="bg-transparent border-none outline-none text-[10px] font-black text-slate-500 uppercase" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-2 flex items-center gap-2">
              <UserIcon size={12} className="text-slate-400" />
              <select className="bg-transparent border-none outline-none text-[10px] font-black text-slate-500 uppercase max-w-[150px]" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
                {uniqueClients.map(c => <option key={c} value={c}>{c === 'all' ? 'Todos los clientes' : c}</option>)}
              </select>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-2 flex items-center gap-2">
              <CheckCircle2 size={12} className="text-slate-400" />
              <select className="bg-transparent border-none outline-none text-[10px] font-black text-slate-500 uppercase" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
                {statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-[1400px] mx-auto space-y-10">
            <DashboardStats stats={stats} />
            <ReportTable invoices={filteredInvoices} auditFindings={auditFindings} onApplyCorrection={() => {}} onEdit={(inv) => { setEditingInvoice(inv); setIsManualModalOpen(true); }} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
