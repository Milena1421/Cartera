import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LayoutDashboard,
  Search,
  RefreshCw,
  Download,
  FileUp,
  PlusCircle,
  Landmark,
  Calendar,
  User as UserIcon,
  X,
  CloudCheck,
  CheckCircle2,
  AlertCircle,
  LogOut
} from 'lucide-react';
import DashboardStats from './components/DashboardStats';
import ReportTable from './components/ReportTable';
import ManualInvoiceModal from './components/ManualInvoiceModal';
import ReconciliationPanel from './components/ReconciliationPanel';
import PortfolioSummary from './components/PortfolioSummary';
import { MOCK_BANK_TRANSACTIONS, MOCK_INVOICES } from './constants';
import { Invoice, FinancialStats, AIAuditFinding } from './types';
import { siigoService } from './services/siigoService';
import { runAIAudit, parseCSVWithAI, auditSiigoMapping } from './services/geminiService';
import { supabaseService } from './services/supabaseService';
import { parseCarteraCsv } from './services/csvImportService';
import { formatDecimalValue } from './utils/formatters';

const CURRENT_USER_STORAGE_KEY = 'cartera_current_user';
const DELETED_INVOICES_STORAGE_KEY = 'cartera_deleted_invoice_numbers';

type AppRole = 'admin' | 'accounting';

type AppUser = {
  username: string;
  password: string;
  displayName: string;
  role: AppRole;
  description: string;
};

const APP_USERS: AppUser[] = [
  {
    username: 'admin',
    password: 'Admin365*',
    displayName: 'Administrador',
    role: 'admin',
    description: 'Puede validar, sincronizar, crear, editar y eliminar facturas.',
  },
  {
    username: 'contabilidad',
    password: 'Conta365*',
    displayName: 'Contabilidad',
    role: 'accounting',
    description: 'Solo puede consultar cuentas por pagar y exportar la cartera.',
  },
];

const getStoredUser = () => {
  if (typeof window === 'undefined') return null;
  const username = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
  return APP_USERS.find((user) => user.username === username) || null;
};

const hasMeaningfulFinancialValues = (invoice: Invoice) =>
  Number(invoice.subtotal || 0) > 0 ||
  Number(invoice.iva || 0) > 0 ||
  Number(invoice.total || 0) > 0 ||
  Number(invoice.debtValue || 0) > 0;

const isUsableClientName = (value?: string) => {
  const clientName = String(value || '').trim().toUpperCase();
  if (!clientName) return false;
  if (clientName === 'CLIENTE NO IDENTIFICADO') return false;
  if (/^\d{6,}$/.test(clientName.replace(/[^\d]/g, ''))) return false;
  return true;
};

const hasMeaningfulDate = (value?: string) => Boolean(String(value || '').trim());

const hasMeaningfulDescription = (value?: string) => {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.toUpperCase() === 'IMPORTACION POR CSV') return false;
  return true;
};

const isPlaceholderInvoice = (invoice: Invoice) =>
  !hasMeaningfulDate(invoice.date) &&
  !hasMeaningfulDate(invoice.dueDate) &&
  !hasMeaningfulDescription(invoice.description) &&
  Number(invoice.subtotal || 0) === 0 &&
  Number(invoice.iva || 0) === 0 &&
  Number(invoice.total || 0) === 0 &&
  Number(invoice.debtValue || 0) === 0;

const normalizeInvoiceNumberKey = (value?: string) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^FV(?=\d)/, 'FING')
    .trim();

const NOTE_CREDIT_STATUS = ['Nota cr', String.fromCharCode(233), 'dito'].join('');

const normalizeStatusKey = (value?: string) => {
  const raw = String(value || '').trim();
  const normalized = raw
    .replace(/é/g, 'e')
    .replace(/\uFFFD/g, 'e')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');

  if (normalized === 'pagada') return 'Pagada';
  if (normalized === 'notacredito' || (/notacr.*dito/.test(normalized) && normalized.startsWith('nota'))) {
    return NOTE_CREDIT_STATUS;
  }
  return 'Pendiente por pagar';
};

const isNoteCreditStatus = (value?: string) => normalizeStatusKey(value) === NOTE_CREDIT_STATUS;

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


const getStoredDeletedInvoiceNumbers = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DELETED_INVOICES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => normalizeInvoiceNumberKey(String(value || '')))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const setStoredDeletedInvoiceNumbers = (values: string[]) => {
  if (typeof window === 'undefined') return;
  const normalized = Array.from(new Set(values.map((value) => normalizeInvoiceNumberKey(value)).filter(Boolean))).sort();
  window.localStorage.setItem(DELETED_INVOICES_STORAGE_KEY, JSON.stringify(normalized));
};

const escapeCsvValue = (value: unknown) => {
  const text = String(value ?? '');
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const formatCsvAmount = (value: unknown) => formatDecimalValue(Number(value || 0));

const App: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [activeView, setActiveView] = useState<'cartera' | 'conciliacion' | 'resumen'>('cartera');
  const [auditFindings] = useState<AIAuditFinding[]>([]);
  const [bankTransactions, setBankTransactions] = useState(MOCK_BANK_TRANSACTIONS);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<'connected' | 'syncing' | 'error'>('connected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => getStoredUser());
  const [loginUsername, setLoginUsername] = useState(APP_USERS[0].username);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [deletedInvoiceNumbers, setDeletedInvoiceNumbers] = useState<string[]>(() => getStoredDeletedInvoiceNumbers());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canModifyInvoices = currentUser?.role === 'admin';
  const deletedInvoiceNumbersSet = useMemo(() => new Set(deletedInvoiceNumbers), [deletedInvoiceNumbers]);

  const requireAdminAccess = () => {
    if (canModifyInvoices) return true;
    setErrorMessage('Tu usuario es de solo consulta. No tienes permisos para modificar la cartera.');
    return false;
  };

  const removeDeletedInvoiceMarker = useCallback((invoiceNumber?: string) => {
    const normalized = normalizeInvoiceNumberKey(invoiceNumber);
    if (!normalized) return;
    setDeletedInvoiceNumbers((current) => {
      const next = current.filter((value) => value !== normalized);
      if (next.length !== current.length) {
        setStoredDeletedInvoiceNumbers(next);
      }
      return next;
    });
  }, []);

  const markInvoiceAsDeleted = useCallback((invoiceNumber?: string) => {
    const normalized = normalizeInvoiceNumberKey(invoiceNumber);
    if (!normalized) return;
    setDeletedInvoiceNumbers((current) => {
      if (current.includes(normalized)) return current;
      const next = [...current, normalized];
      setStoredDeletedInvoiceNumbers(next);
      return next;
    });
  }, []);

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = APP_USERS.find(
      (candidate) => candidate.username === loginUsername && candidate.password === loginPassword
    );

    if (!user) {
      setLoginError('Usuario o clave incorrectos.');
      return;
    }

    window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, user.username);
    setCurrentUser(user);
    setLoginPassword('');
    setLoginError(null);
    setErrorMessage(null);
  };

  const handleLogout = () => {
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    setCurrentUser(null);
    setInvoices([]);
    setSearchTerm('');
    setSelectedMonth('all');
    setSelectedClient('all');
    setSelectedStatus('all');
    setActiveView('cartera');
    setEditingInvoice(null);
    setIsManualModalOpen(false);
  };

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
    { value: NOTE_CREDIT_STATUS, label: NOTE_CREDIT_STATUS },
  ];

  const uniqueClients = useMemo(() => {
    const clients = invoices.map((inv) => inv.clientName).filter(Boolean);
    return ['all', ...Array.from(new Set(clients))].sort();
  }, [invoices]);

  const loadInitialData = useCallback(async () => {
    if (!currentUser) {
      setInvoices([]);
      return;
    }
    setIsSyncing(true);
    setCloudStatus('syncing');
    try {
      const cloudInvoices = await supabaseService.fetchInvoices();
      const visibleInvoices = cloudInvoices.filter(
        (invoice) => !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(invoice.invoiceNumber))
      );
      if (cloudInvoices.length > 0) {
        setInvoices(visibleInvoices);
      } else {
        setInvoices(MOCK_INVOICES);
      }
      setCloudStatus('connected');
    } catch {
      setCloudStatus('error');
    } finally {
      setIsSyncing(false);
    }
  }, [currentUser, deletedInvoiceNumbersSet]);

  const syncNewInvoices = useCallback(async () => {
    if (!requireAdminAccess()) return;
    setIsSyncing(true);
    setCloudStatus('syncing');
    setErrorMessage(null);
    try {
      const currentMaster = await supabaseService.fetchInvoices();
      const byInvoiceNumber = new Map(
        currentMaster
          .filter((invoice) => !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(invoice.invoiceNumber)))
          .filter((invoice) => String(invoice.invoiceNumber || '').trim())
          .map((invoice) => [normalizeInvoiceNumberKey(invoice.invoiceNumber), invoice])
      );
      const { invoices: siigoInvoices, raw } = await siigoService.getInvoices();

      if (siigoInvoices && siigoInvoices.length > 0) {
        const auditedInvoices = (await auditSiigoMapping(siigoInvoices, raw)).filter(
          (invoice) => !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(invoice.invoiceNumber))
        );
        const invoicesToSync = auditedInvoices.map((invoice) => {
          const currentInvoice = byInvoiceNumber.get(normalizeInvoiceNumberKey(invoice.invoiceNumber));
          if (!currentInvoice) return invoice;
          const currentIsPlaceholder = isPlaceholderInvoice(currentInvoice);
          const keepCurrentFinancials =
            !currentIsPlaceholder &&
            hasMeaningfulFinancialValues(currentInvoice) &&
            !hasMeaningfulFinancialValues(invoice);
          return {
            ...currentInvoice,
            ...invoice,
            id: currentInvoice.id,
            clientName: isUsableClientName(invoice.clientName) ? invoice.clientName : currentInvoice.clientName,
            documentType: invoice.documentType || currentInvoice.documentType,
            documentNumber: invoice.documentNumber || currentInvoice.documentNumber,
            description: currentIsPlaceholder || hasMeaningfulDescription(invoice.description) ? invoice.description : currentInvoice.description,
            date: currentIsPlaceholder || hasMeaningfulDate(invoice.date) ? invoice.date : currentInvoice.date,
            dueDate: currentIsPlaceholder || hasMeaningfulDate(invoice.dueDate) ? invoice.dueDate : currentInvoice.dueDate,
            subtotal: keepCurrentFinancials ? currentInvoice.subtotal : invoice.subtotal,
            iva: keepCurrentFinancials ? currentInvoice.iva : invoice.iva,
            total: keepCurrentFinancials ? currentInvoice.total : invoice.total,
            debtValue: keepCurrentFinancials ? currentInvoice.debtValue : invoice.debtValue,
            paidAmount: currentInvoice.paidAmount,
            creditAmount: currentInvoice.creditAmount,
            paymentDate: currentInvoice.paymentDate,
            creditDate: currentInvoice.creditDate,
            status: invoice.status || currentInvoice.status,
            observations: currentInvoice.observations || '',
            documentUrl: currentInvoice.documentUrl,
            isSynced: currentInvoice.isSynced,
          };
        });

        await supabaseService.syncInvoices(invoicesToSync);
        const updatedMaster = (await supabaseService.fetchInvoices()).filter(
          (invoice) => !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(invoice.invoiceNumber))
        );
        setInvoices(updatedMaster);
      }
      setCloudStatus('connected');
    } catch (err: any) {
      setCloudStatus('error');
      setErrorMessage(err.message || 'Error de sincronización con Siigo/Auditoría.');
    } finally {
      setIsSyncing(false);
    }
  }, [canModifyInvoices, deletedInvoiceNumbersSet]);

  const handleCSVUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!requireAdminAccess()) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setCloudStatus('syncing');
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      try {
        const parsedInvoices = parseCarteraCsv(text);
        const importedInvoices = parsedInvoices.length > 0 ? parsedInvoices : await parseCSVWithAI(text);
        if (importedInvoices.length > 0) {
          const currentMaster = await supabaseService.fetchInvoices();
          const byInvoiceNumber = new Map(
            currentMaster
              .filter((invoice) => !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(invoice.invoiceNumber)))
              .filter((invoice) => String(invoice.invoiceNumber || '').trim())
              .map((invoice) => [normalizeInvoiceNumberKey(invoice.invoiceNumber), invoice])
          );
          const invoicesToSync = importedInvoices
            .filter((invoice) => !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(invoice.invoiceNumber)))
            .map((invoice) => {
            const currentInvoice = byInvoiceNumber.get(normalizeInvoiceNumberKey(invoice.invoiceNumber));
            if (!currentInvoice) return invoice;
            const currentIsPlaceholder = isPlaceholderInvoice(currentInvoice);
            const importedHasFinancials = hasMeaningfulFinancialValues(invoice);
            const keepCurrentFinancials =
              !currentIsPlaceholder &&
              hasMeaningfulFinancialValues(currentInvoice) &&
              !importedHasFinancials;
            return {
              ...currentInvoice,
              ...invoice,
              id: currentInvoice.id,
              clientName: isUsableClientName(currentInvoice.clientName) ? currentInvoice.clientName : invoice.clientName,
              documentType: invoice.documentType || currentInvoice.documentType,
              documentNumber: invoice.documentNumber || currentInvoice.documentNumber,
              description: currentIsPlaceholder || hasMeaningfulDescription(invoice.description) ? invoice.description : currentInvoice.description,
              date: currentIsPlaceholder || hasMeaningfulDate(invoice.date) ? invoice.date : currentInvoice.date,
              dueDate: currentIsPlaceholder || hasMeaningfulDate(invoice.dueDate) ? invoice.dueDate : currentInvoice.dueDate,
              subtotal: keepCurrentFinancials ? currentInvoice.subtotal : invoice.subtotal,
              iva: keepCurrentFinancials ? currentInvoice.iva : invoice.iva,
              total: keepCurrentFinancials ? currentInvoice.total : invoice.total,
              debtValue: keepCurrentFinancials ? currentInvoice.debtValue : invoice.debtValue,
              paidAmount: currentInvoice.paidAmount,
              creditAmount: currentInvoice.creditAmount,
              paymentDate: currentInvoice.paymentDate,
              creditDate: currentInvoice.creditDate,
              status: currentInvoice.status,
              observations: currentInvoice.observations || '',
              documentUrl: currentInvoice.documentUrl,
              isSynced: currentInvoice.isSynced,
            };
          });
          await supabaseService.syncInvoices(invoicesToSync);
          const updatedMaster = (await supabaseService.fetchInvoices()).filter(
            (invoice) => !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(invoice.invoiceNumber))
          );
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
    if (!requireAdminAccess()) return;
    setCloudStatus('syncing');
    setErrorMessage(null);
    try {
      const normalizedInvoiceNumber = normalizeInvoiceNumberKey(invoiceData.invoiceNumber);
      removeDeletedInvoiceMarker(invoiceData.invoiceNumber);
      const result = await supabaseService.syncInvoices([invoiceData]);
      if (!result) {
        throw new Error('No se pudo guardar la factura en Supabase.');
      }
      const updatedMaster = (await supabaseService.fetchInvoices()).filter(
        (invoice) =>
          !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(invoice.invoiceNumber)) ||
          normalizeInvoiceNumberKey(invoice.invoiceNumber) === normalizedInvoiceNumber
      );
      setInvoices(updatedMaster);
      setIsManualModalOpen(false);
      setEditingInvoice(null);
      setSelectedInvoiceId(invoiceData.id);
      setCloudStatus('connected');
    } catch (err: any) {
      setCloudStatus('error');
      setErrorMessage(err.message || 'No se pudo guardar la factura.');
      throw err;
    }
  };

  const handleDeleteInvoice = async (invoice: Invoice) => {
    if (!requireAdminAccess()) return;

    const confirmed = window.confirm(
      `Se eliminara la factura ${invoice.invoiceNumber}. Esta accion no se puede deshacer.`
    );
    if (!confirmed) return;

    setCloudStatus('syncing');
    setErrorMessage(null);

    try {
      markInvoiceAsDeleted(invoice.invoiceNumber);
      const deleted = await supabaseService.deleteInvoice(invoice);
      if (!deleted) {
        throw new Error('No se pudo eliminar la factura.');
      }

      const normalizedInvoiceNumber = normalizeInvoiceNumberKey(invoice.invoiceNumber);
      setInvoices((current) =>
        current.filter((item) => {
          if (item.id === invoice.id) return false;
          if (normalizedInvoiceNumber && normalizeInvoiceNumberKey(item.invoiceNumber) === normalizedInvoiceNumber) {
            return false;
          }
          return true;
        })
      );

      const updatedMaster = await supabaseService.fetchInvoices();
      setInvoices(
        updatedMaster.filter(
          (item) => !deletedInvoiceNumbersSet.has(normalizeInvoiceNumberKey(item.invoiceNumber)) &&
            normalizeInvoiceNumberKey(item.invoiceNumber) !== normalizedInvoiceNumber
        )
      );
      if (selectedInvoiceId === invoice.id) {
        setSelectedInvoiceId(null);
      }
      setCloudStatus('connected');
    } catch (err: any) {
      removeDeletedInvoiceMarker(invoice.invoiceNumber);
      setCloudStatus('error');
      setErrorMessage(err.message || 'No se pudo eliminar la factura.');
    }
  };

  const handleExportReport = () => {
    const rows = filteredInvoices.map((invoice) => ({
      cliente: invoice.clientName || '',
      tipo_documento: invoice.documentType || '',
      nit_cc: invoice.documentNumber || '',
      factura: invoice.invoiceNumber || '',
      fecha_emision: invoice.date || '',
      fecha_vencimiento: invoice.dueDate || '',
      descripcion: invoice.description || '',
      subtotal: formatCsvAmount(invoice.subtotal),
      iva: formatCsvAmount(invoice.iva),
      total: formatCsvAmount(invoice.total),
      rete_fuente: formatCsvAmount(invoice.reteFuente),
      rete_iva: formatCsvAmount(invoice.reteIva),
      rete_ica: formatCsvAmount(invoice.reteIca),
      estado: invoice.status || '',
      deuda: formatCsvAmount(invoice.debtValue),
      fecha_pago: invoice.paymentDate || '',
      valor_recaudado: formatCsvAmount(invoice.paidAmount),
      fecha_abono: invoice.creditDate || '',
      valor_abono: formatCsvAmount(invoice.creditAmount),
      observaciones: invoice.observations || '',
      mora_dias: Number(invoice.moraDays || 0),
    }));

    const headers = Object.keys(rows[0] || {
      cliente: '',
      tipo_documento: '',
      nit_cc: '',
      factura: '',
      fecha_emision: '',
      fecha_vencimiento: '',
      descripcion: '',
      subtotal: '',
      iva: '',
      total: '',
      rete_fuente: '',
      rete_iva: '',
      rete_ica: '',
      estado: '',
      deuda: '',
      fecha_pago: '',
      valor_recaudado: '',
      fecha_abono: '',
      valor_abono: '',
      observaciones: '',
      mora_dias: '',
    });

    const csvContent = [
      headers.join(';'),
      ...rows.map((row) => headers.map((header) => escapeCsvValue((row as Record<string, unknown>)[header])).join(';')),
    ].join('\r\n');

    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateSuffix = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `cartera_${dateSuffix}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const filteredInvoices = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return invoices
      .map((inv) => {
        let currentMora = 0;
        if (inv.status !== 'Pagada' && inv.dueDate) {
          const due = new Date(inv.dueDate);
          if (!Number.isNaN(due.getTime())) {
            due.setHours(0, 0, 0, 0);
            const diffTime = today.getTime() - due.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            currentMora = diffDays > 0 ? diffDays : 0;
          }
        }
        return {
          ...inv,
          debtValue: isNoteCreditStatus(inv.status) ? 0 : Number(inv.debtValue || 0),
          moraDays: currentMora,
        };
      })
      .filter((inv) => {
        const matchesSearch =
          (inv.clientName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          (inv.invoiceNumber?.toLowerCase() || '').includes(searchTerm.toLowerCase());
        const matchesMonth = selectedMonth === 'all' || (inv.date && inv.date.split('-')[1] === selectedMonth);
        const matchesClient = selectedClient === 'all' || inv.clientName === selectedClient;
        const matchesStatus =
          selectedStatus === 'all' ||
          normalizeStatusKey(inv.status) === normalizeStatusKey(selectedStatus);
        return matchesSearch && matchesMonth && matchesClient && matchesStatus;
      })
      .sort((a, b) => new Date(b.date || '1900-01-01').getTime() - new Date(a.date || '1900-01-01').getTime());
  }, [invoices, searchTerm, selectedMonth, selectedClient, selectedStatus]);

  const stats: FinancialStats = useMemo(() => {
    const totalInvoices = filteredInvoices.length;
    const totalInvoiced = filteredInvoices.reduce((acc, inv) => acc + (inv.total || 0), 0);
    const totalCollected = filteredInvoices.reduce((acc, inv) => {
      const recaudo = inv.status === 'Pagada' ? ((inv.paidAmount || inv.total) || 0) : (inv.paidAmount || 0);
      const abono = inv.creditAmount || 0;
      return acc + recaudo + abono;
    }, 0);
    const totalPending = filteredInvoices.reduce((acc, inv) => acc + (inv.debtValue || 0), 0);
    const totalOverdue = filteredInvoices.filter((i) => i.moraDays && i.moraDays > 0).reduce((acc, inv) => acc + (inv.debtValue || 0), 0);
    return { totalInvoices, totalInvoiced, totalCollected, totalPending, totalOverdue, averageMoraDays: 0 };
  }, [filteredInvoices]);

  const portfolioSummaryGroups = useMemo(() => {
    const pendingInvoices = filteredInvoices.filter(
      (invoice) => normalizeStatusKey(invoice.status) === 'Pendiente por pagar' && Number(invoice.debtValue || 0) > 0
    );

    type PortfolioSummaryGroup = {
      clientName: string;
      invoices: Invoice[];
      totalSubtotal: number;
      totalIva: number;
      totalAmount: number;
      totalDebt: number;
    };

    const groups = pendingInvoices.reduce<Record<string, PortfolioSummaryGroup>>((acc, invoice) => {
      const clientName = getClientDisplayName(invoice);
      const currentGroup = acc[clientName] || {
        clientName,
        invoices: [],
        totalSubtotal: 0,
        totalIva: 0,
        totalAmount: 0,
        totalDebt: 0,
      };

      currentGroup.invoices.push(invoice);
      currentGroup.totalSubtotal += Number(invoice.subtotal || 0);
      currentGroup.totalIva += Number(invoice.iva || 0);
      currentGroup.totalAmount += Number(invoice.total || 0);
      currentGroup.totalDebt += Number(invoice.debtValue || 0);
      acc[clientName] = currentGroup;
      return acc;
    }, {});

    return (Object.values(groups) as PortfolioSummaryGroup[])
      .map((group) => ({
        ...group,
        invoices: group.invoices.sort(
          (a, b) => new Date(b.date || '1900-01-01').getTime() - new Date(a.date || '1900-01-01').getTime()
        ),
      }))
      .sort((a, b) => b.totalDebt - a.totalDebt || a.clientName.localeCompare(b.clientName, 'es-CO'));
  }, [filteredInvoices]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!canModifyInvoices && activeView === 'conciliacion') {
      setActiveView('cartera');
    }
  }, [activeView, canModifyInvoices]);

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center font-sans p-6">
        <div className="w-full max-w-md overflow-hidden rounded-[2.4rem] bg-white shadow-2xl shadow-slate-300/70 border border-slate-200/70">
          <form onSubmit={handleLogin} className="px-10 py-11 sm:px-12 sm:py-12 flex flex-col justify-center gap-8">
            <div>
              <h1 className="text-[25px] font-black text-slate-950 tracking-tight uppercase">Cuentas Por Cobrar</h1>
              <p className="mt-3 text-[12px] font-black text-slate-400 uppercase tracking-[0.22em]">Selecciona usuario y contraseña</p>
            </div>

            {loginError && (
              <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2">
                <AlertCircle size={14} />
                {loginError}
              </div>
            )}

            <label className="space-y-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.24em]">Usuario</span>
              <select
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                className="w-full h-14 rounded-2xl border-2 border-slate-200 bg-white px-5 text-[15px] font-black text-slate-800 outline-none focus:border-indigo-400 transition-colors"
              >
                {APP_USERS.map((user) => (
                  <option key={user.username} value={user.username}>{user.displayName}</option>
                ))}
              </select>
            </label>

            <label className="space-y-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.24em]">Contraseña</span>
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                className="w-full h-14 rounded-2xl border-2 border-slate-200 bg-white px-5 text-[15px] font-black text-slate-800 outline-none focus:border-indigo-400 transition-colors"
                placeholder="Ingresa la contraseña"
              />
            </label>

            <button type="submit" className="h-14 rounded-2xl bg-slate-950 text-white font-black uppercase tracking-[0.24em] text-[11px]">
              Ingresar
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleCSVUpload} />
      <ManualInvoiceModal
        isOpen={isManualModalOpen}
        onClose={() => { setIsManualModalOpen(false); setEditingInvoice(null); }}
        onSave={handleManualInvoiceSave}
        initialData={editingInvoice}
      />

      <aside className="w-64 bg-[#0f172a] text-slate-400 hidden lg:flex flex-col border-r border-slate-800 shrink-0">
        <div className="p-6">
          <div className="flex items-center gap-3 text-white mb-10">
            <div className="bg-blue-600 p-1.5 rounded-xl shadow-lg shadow-blue-600/20">
              <img
                src="https://assets-sam.mkt.dynamics.com/2be9f283-e2e5-40bf-b6a6-d1e8356bf9a7/digitalassets/images/4278929a-4da5-f011-bbd3-002248dfbfde?ts=638956381317856213"
                alt="Logo"
                className="w-9 h-9 rounded-lg object-cover"
              />
            </div>
            <span className="font-black text-lg tracking-tight">Ingeniería 365</span>
          </div>
          <nav className="space-y-1">
            <button onClick={() => setActiveView('cartera')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-black transition-all ${activeView === 'cartera' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800/50 hover:text-slate-200'}`}><LayoutDashboard size={18} /> <span className="text-sm">Cuentas Por Cobrar</span></button>
            {canModifyInvoices && <button onClick={() => setActiveView('conciliacion')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-black transition-all ${activeView === 'conciliacion' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800/50 hover:text-slate-200'}`}><Landmark size={18} /> <span className="text-sm">Conciliación</span></button>}
          </nav>
          <div className="mt-10 pt-8 border-t border-slate-800/50 space-y-4">
            <p className="px-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Operaciones</p>
            {canModifyInvoices && <button onClick={() => setIsManualModalOpen(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/50 hover:text-slate-200 transition-all text-left"><PlusCircle size={18} className="text-blue-400" /> <span className="text-sm font-bold">Nueva Factura</span></button>}
            {canModifyInvoices && <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/50 hover:text-slate-200 transition-all text-left"><FileUp size={18} className="text-blue-400" /> <span className="text-sm font-bold">Importar Cartera (CSV)</span></button>}
            <button onClick={handleExportReport} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/50 hover:text-slate-200 transition-all text-left"><Download size={18} className="text-blue-400" /> <span className="text-sm font-bold">Exportar Reporte</span></button>
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-800/50 text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all text-[10px] font-black uppercase tracking-widest">
              <LogOut size={14} /> Salir
            </button>
          </div>
        </div>
        <div className="mt-auto p-6">
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${cloudStatus === 'error' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-800/30 text-blue-400 border-slate-800/50'}`}>
            {cloudStatus === 'error' ? <AlertCircle size={16} /> : <CloudCheck size={16} className={isSyncing ? 'animate-pulse' : ''} />}
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
            {canModifyInvoices && (
              <button onClick={syncNewInvoices} disabled={isSyncing} className="flex items-center gap-3 bg-[#0f172a] text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50">
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} /> {isSyncing ? 'AUDITANDO...' : 'BUSCAR NUEVAS'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-2 flex items-center gap-2">
              <Calendar size={12} className="text-slate-400" />
              <select className="bg-transparent border-none outline-none text-[10px] font-black text-slate-500 uppercase" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-2 flex items-center gap-2">
              <UserIcon size={12} className="text-slate-400" />
              <select className="bg-transparent border-none outline-none text-[10px] font-black text-slate-500 uppercase max-w-[150px]" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
                {uniqueClients.map((c) => <option key={c} value={c}>{c === 'all' ? 'Todos los clientes' : c}</option>)}
              </select>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-2 flex items-center gap-2">
              <CheckCircle2 size={12} className="text-slate-400" />
              <select className="bg-transparent border-none outline-none text-[10px] font-black text-slate-500 uppercase" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
                {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setActiveView(activeView === 'resumen' ? 'cartera' : 'resumen')}
              className={`border rounded-lg px-4 py-2 flex items-center gap-2 text-[10px] font-black uppercase transition-colors ${
                activeView === 'resumen'
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'
              }`}
            >
              <LayoutDashboard size={12} className={activeView === 'resumen' ? 'text-slate-200' : 'text-slate-400'} />
              <span>Resumen de Cartera</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-[1400px] mx-auto space-y-10">
            {activeView === 'cartera' ? (
              <>
                <DashboardStats stats={stats} />
                <ReportTable
                  invoices={filteredInvoices}
                  auditFindings={auditFindings}
                  onApplyCorrection={() => {}}
                  onEdit={(inv) => { setSelectedInvoiceId(inv.id); setEditingInvoice(inv); setIsManualModalOpen(true); }}
                  onDelete={handleDeleteInvoice}
                  onSelectInvoice={(inv) => setSelectedInvoiceId(inv.id)}
                  selectedInvoiceId={selectedInvoiceId}
                  canEdit={canModifyInvoices}
                />
              </>
            ) : activeView === 'resumen' ? (
              <PortfolioSummary groups={portfolioSummaryGroups} />
            ) : (
              <ReconciliationPanel
                invoices={invoices}
                transactions={bankTransactions}
                onTransactionsChange={setBankTransactions}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;



