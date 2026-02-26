
import { Invoice, PaymentStatus } from '../types';

const SIIGO_BASE_URL = 'https://api.siigo.com/v1';
const AUTH_URL = 'https://api.siigo.com/auth';

const SIIGO_USERNAME = 'gerencia@ingenieria365.com';
const SIIGO_ACCESS_KEY = 'YzUzZWM3NWMtN2ZmMC00MGEzLThkMWEtNzZiNDMyZDBiMGYxOjRHLmZrRktvME8=';
const PARTNER_ID = 'Ingenieria365'; 

export class SiigoService {
  private token: string | null = null;

  private withProxy(url: string, bypassCache: boolean = true): string {
    const targetUrl = bypassCache ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;
    return `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
  }

  private async authenticate(): Promise<string> {
    if (this.token) return this.token;
    try {
      const response = await fetch(this.withProxy(AUTH_URL, false), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username: SIIGO_USERNAME,
          access_key: SIIGO_ACCESS_KEY,
        }),
      });
      if (!response.ok) throw new Error(`Error de Autenticación: ${response.status}`);
      const data = await response.json();
      this.token = data.access_token;
      return this.token!;
    } catch (error) {
      console.error('Siigo Auth Failure:', error);
      throw new Error('Error de conexión con Siigo.');
    }
  }

  /**
   * Limpia el nombre del cliente usando Regex para asegurar que no sea una descripción técnica.
   */
  private cleanClientName(name: string): string {
    if (!name) return 'CLIENTE NO IDENTIFICADO';
    
    // 1. Eliminar NITs (ej: 900.000.000-0 o 123456789-0)
    let cleaned = name.replace(/\d{3,}(\.\d{3,})?(\.\d{3,})?-\d/g, '');
    
    // 2. Eliminar prefijos comunes de identificación
    cleaned = cleaned.replace(/^(NIT|CC|ID|CEDULA|IDENTIFICACION|SR|SRA|CLIENTE)[:.\s-]*/i, '');
    
    // 3. Si el nombre contiene palabras clave de descripción (ej: "CONFERENCIA", "MANTENIMIENTO"), 
    // es probable que el mapeo haya fallado. El audit de IA corregirá esto después.
    
    return cleaned.replace(/\s+/g, ' ').trim().toUpperCase();
  }

  private extractCustomerName(cust: any): string {
    if (!cust) return '';
    
    // Prioridad 1: Nombres comerciales o razones sociales completas
    let name = cust.full_name || cust.business_name || '';
    
    // Prioridad 2: Nombres desglosados (API v1 estándar)
    if (!name && cust.name) {
      if (typeof cust.name === 'object') {
        const parts = [cust.name.first_name, cust.name.last_name].filter(Boolean);
        name = parts.join(' ');
      } else if (Array.isArray(cust.name)) {
        name = cust.name.join(' ');
      } else {
        name = String(cust.name);
      }
    }

    // Prioridad 3: Identificación (último recurso)
    if (!name && cust.identification) {
      name = `ID: ${cust.identification}`;
    }

    return name.trim();
  }

  async getInvoices(startDate?: string, endDate?: string): Promise<{invoices: Invoice[], raw: any[]}> {
    try {
      const token = await this.authenticate();
      let allResults: any[] = [];
      let page = 1;
      let totalPages = 1;

      // Buscamos los últimos 45 días por defecto
      const defaultStart = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
      const start = startDate || defaultStart;

      do {
        let url = `${SIIGO_BASE_URL}/invoices?page=${page}&page_size=30&created_start=${start}`;
        if (endDate) url += `&created_end=${endDate}`;

        const response = await fetch(this.withProxy(url), {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Partner-Id': PARTNER_ID,
            'Content-Type': 'application/json'
          },
        });

        if (!response.ok) break;
        const data = await response.json();
        const results = data.results || [];
        allResults = [...allResults, ...results];
        totalPages = data.pagination?.total_pages || 1;
        page++;
      } while (page <= totalPages && page <= 3);

      const mapped = allResults.map((inv) => {
        const rawName = this.extractCustomerName(inv.customer);
        return this.mapToInternalInvoice(inv, rawName);
      });

      return { invoices: mapped, raw: allResults };
    } catch (error) {
      console.error('Siigo getInvoices Error:', error);
      throw error;
    }
  }

  private mapToInternalInvoice(siigo: any, realClientName: string): Invoice {
    // EXTRACCIÓN FINANCIERA SEGÚN FACTURA REAL (Total Bruto, Total a Pagar)
    // Buscamos 'total' o 'total_value'. Siigo a veces cambia el nombre según el endpoint.
    const total = Number(siigo.total || siigo.total_value || siigo.total_amount || 0);
    const balance = Number(siigo.balance !== undefined ? siigo.balance : (siigo.total_balance !== undefined ? siigo.total_balance : total));
    
    // Extracción de IVA y Subtotal del objeto 'cost' o el array 'taxes'
    let iva = 0;
    let subtotal = 0;

    if (siigo.cost) {
      iva = Number(siigo.cost.iva || 0);
      subtotal = Number(siigo.cost.subtotal || (total - iva));
    } else if (siigo.taxes && Array.isArray(siigo.taxes)) {
      const ivaTax = siigo.taxes.find((t: any) => (t.name || t.type || '').toLowerCase().includes('iva'));
      iva = Number(ivaTax?.value || ivaTax?.amount || 0);
      subtotal = total - iva;
    }

    // Retenciones (Regex para buscar Fuente, IVA, ICA en el array de impuestos)
    const taxes = siigo.taxes || siigo.retentions || [];
    const extractTax = (patterns: string[]) => taxes
      .filter((t: any) => {
        const name = (t.name || t.type || '').toLowerCase();
        return patterns.some(p => name.includes(p));
      })
      .reduce((acc: number, t: any) => acc + Number(t.value || t.amount || 0), 0);

    const rf = extractTax(['fuente', 'renta']);
    const ri = extractTax(['iva']); // ReteIVA
    const rc = extractTax(['ica']);

    // Identificación Factura (Regex: FV 1234)
    const rawPrefix = String(siigo.type?.code || siigo.document?.code || 'FV').toUpperCase().replace(/[^A-Z]/g, '');
    const rawNumber = String(siigo.number || siigo.consecutive || '0').replace(/[^0-9]/g, '');
    const invoiceNumber = `${rawPrefix} ${rawNumber}`;

    // Descripción: No confundir el ITEM con el CLIENTE
    // Priorizamos la descripción del primer producto/servicio
    const mainItem = siigo.items?.[0]?.description || siigo.items?.[0]?.name || '';
    const observations = siigo.observations || '';
    const finalDescription = (mainItem || observations || 'Servicios Profesionales').trim();

    return {
      id: siigo.id || `${rawPrefix}${rawNumber}`,
      clientName: this.cleanClientName(realClientName),
      invoiceNumber: invoiceNumber,
      description: finalDescription,
      date: siigo.date || new Date().toISOString().split('T')[0],
      dueDate: siigo.due_date || siigo.date || new Date().toISOString().split('T')[0],
      subtotal: subtotal,
      iva: iva,
      total: total,
      discounts: 0,
      reteFuente: rf,
      reteIva: ri,
      reteIca: rc,
      status: balance <= 100 ? 'Pagada' : 'Pendiente por pagar',
      debtValue: balance,
      observations: observations,
      moraDays: 0,
      isSynced: false
    };
  }
}

export const siigoService = new SiigoService();
