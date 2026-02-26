
export type PaymentStatus = 'Pagada' | 'Nota crédito' | 'Pendiente por pagar';

export interface Invoice {
  id: string;
  clientName: string;
  invoiceNumber: string;
  description: string;
  date: string;
  dueDate: string;
  subtotal: number;
  iva: number;
  total: number;
  discounts: number;
  reteFuente: number;
  reteIva: number;
  reteIca: number;
  status: PaymentStatus;
  debtValue: number;
  observations: string;
  moraDays?: number;
  documentUrl?: string; // URL del archivo en el Storage de Supabase
  isSynced?: boolean;   // Flag para saber si está en la nube
  // Reconciliation fields
  bankCommission?: number;
  creditAmount?: number;
  creditDate?: string;
  paymentDate?: string;
  paidAmount?: number;
  paidWithWithholdings?: number;
}

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  reference?: string;
  isMatched: boolean;
}

export interface FinancialStats {
  totalInvoiced: number;
  totalCollected: number;
  totalPending: number;
  totalOverdue: number;
  averageMoraDays: number;
}

export interface AIAuditFinding {
  type: 'warning' | 'info' | 'success' | 'enrichment' | 'critical';
  title: string;
  description: string;
  action?: string;
  invoiceId?: string;
  confidenceScore?: number; // 0 to 100
  suggestedUpdate?: Partial<Invoice>;
}
