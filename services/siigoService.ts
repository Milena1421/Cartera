
import { Invoice, PaymentStatus } from '../types';

const SIIGO_BASE_URL = String(import.meta.env.VITE_SIIGO_API_URL || 'https://api.siigo.com/v1').trim();
const AUTH_URL = 'https://api.siigo.com/auth';

const SIIGO_USERNAME = String(import.meta.env.VITE_SIIGO_USERNAME || '').trim();
const SIIGO_ACCESS_KEY = String(import.meta.env.VITE_SIIGO_ACCESS_KEY || '').trim();
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
      if (!SIIGO_USERNAME || !SIIGO_ACCESS_KEY) {
        throw new Error('Credenciales de Siigo no configuradas.');
      }
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

  private isIdentifierOnly(value: string): boolean {
    const normalized = String(value || '')
      .toUpperCase()
      .replace(/^(NIT|CC|ID|CEDULA|IDENTIFICACION)[:.\s-]*/i, '')
      .replace(/[.\s-]/g, '')
      .trim();

    return /^\d{6,}$/.test(normalized);
  }

  private normalizeDocumentNumber(value?: string): string {
    return String(value || '').replace(/[^\d]/g, '').trim();
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

  private resolveClientName(realClientName: string, customer: any): string {
    const primary = this.cleanClientName(realClientName);
    if (primary && !this.isIdentifierOnly(primary) && primary !== 'CLIENTE NO IDENTIFICADO') {
      return primary;
    }

    const fallback = this.extractCustomerName(customer);
    const cleanedFallback = this.cleanClientName(fallback);
    if (cleanedFallback && !this.isIdentifierOnly(cleanedFallback) && cleanedFallback !== 'CLIENTE NO IDENTIFICADO') {
      return cleanedFallback;
    }

    return 'CLIENTE NO IDENTIFICADO';
  }

  private resolveDocumentInfo(customer: any, fallbackClientName: string): { documentType: string; documentNumber: string } {
    const customerTypeRaw = String(
      customer?.identification_object?.type ||
      customer?.identification_type ||
      customer?.document_type ||
      ''
    ).toUpperCase().trim();

    const rawNumber = String(customer?.identification || '').trim();
    const normalizedFallback = String(fallbackClientName || '').replace(/[.\s-]/g, '');
    const fallbackNumber = /^\d{6,}$/.test(normalizedFallback) ? normalizedFallback : '';
    const documentNumber = rawNumber || fallbackNumber;

    let documentType = '';
    if (customerTypeRaw.includes('NIT') || customerTypeRaw === '31') documentType = 'NIT';
    else if (customerTypeRaw.includes('CC') || customerTypeRaw === '13') documentType = 'CC';
    else if (customerTypeRaw.includes('CE') || customerTypeRaw === '22') documentType = 'CE';
    else if (customerTypeRaw.includes('TI') || customerTypeRaw === '12') documentType = 'TI';
    else if (customerTypeRaw.includes('PAS')) documentType = 'PASAPORTE';
    else if (documentNumber) documentType = 'NIT';
    else documentType = 'NO DEFINIDO';

    return { documentType, documentNumber };
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
        return this.mapToInternalInvoice(inv, rawName, inv.customer);
      });

      return { invoices: mapped, raw: allResults };
    } catch (error) {
      console.error('Siigo getInvoices Error:', error);
      throw error;
    }
  }

  private mapToInternalInvoice(siigo: any, realClientName: string, customer: any): Invoice {
    // EXTRACCIÓN FINANCIERA SEGÚN FACTURA REAL (Total Bruto, Total a Pagar)
    // Buscamos 'total' o 'total_value'. Siigo a veces cambia el nombre según el endpoint.
    const total = Number(siigo.total || siigo.total_value || siigo.total_amount || 0);
    const balance = Number(siigo.balance !== undefined ? siigo.balance : (siigo.total_balance !== undefined ? siigo.total_balance : total));
    
    // Extracci�n robusta de IVA y Subtotal.
    let iva = Number(
      siigo?.cost?.iva ||
      siigo?.tax_total ||
      siigo?.tax_amount ||
      siigo?.total_taxes ||
      0
    );
    let subtotal = Number(
      siigo?.cost?.subtotal ||
      siigo?.subtotal ||
      siigo?.sub_total ||
      0
    );

    if (siigo.cost) {
      iva = Number(siigo.cost.iva || iva || 0);
      subtotal = Number(siigo.cost.subtotal || subtotal || (total - iva));
    }

    if (siigo.taxes && Array.isArray(siigo.taxes)) {
      const ivaFromTaxes = siigo.taxes
        .filter((t: any) => String(t?.name || t?.type || '').toLowerCase().includes('iva'))
        .reduce((acc: number, t: any) => acc + Number(t?.value || t?.amount || t?.total || 0), 0);
      if (ivaFromTaxes > 0) iva = ivaFromTaxes;
    }

    if (Array.isArray(siigo.items) && siigo.items.length > 0) {
      const subtotalFromItems = siigo.items.reduce((acc: number, item: any) => {
        return acc + Number(item?.subtotal || item?.sub_total || item?.price_total || item?.amount || 0);
      }, 0);

      const ivaFromItems = siigo.items.reduce((acc: number, item: any) => {
        const directIva = Number(item?.iva || item?.vat || item?.tax_amount || item?.tax_total || 0);
        if (directIva > 0) return acc + directIva;
        if (Array.isArray(item?.taxes)) {
          return acc + item.taxes
            .filter((t: any) => String(t?.name || t?.type || '').toLowerCase().includes('iva'))
            .reduce((sum: number, t: any) => sum + Number(t?.value || t?.amount || t?.total || 0), 0);
        }
        return acc;
      }, 0);

      if (subtotalFromItems > 0) subtotal = subtotalFromItems;
      if (ivaFromItems > 0) iva = ivaFromItems;
    }

    if (subtotal > 0 && iva <= 0 && total > subtotal) {
      iva = Math.max(0, total - subtotal);
    }

    if (total > 0 && subtotal <= 0) {
      subtotal = Math.max(0, total - iva);
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
    const rawPrefix = String(siigo.type?.code || siigo.document?.code || 'FV')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .replace(/^FV$/, 'FING');
    const rawNumber = String(siigo.number || siigo.consecutive || '0').replace(/[^0-9]/g, '');
    const invoiceNumber = `${rawPrefix}${rawNumber}`;

    // Descripción: No confundir el ITEM con el CLIENTE
    // Priorizamos la descripción del primer producto/servicio
    const mainItem = siigo.items?.[0]?.description || siigo.items?.[0]?.name || '';
    const finalDescription = (mainItem || 'Servicios Profesionales').trim();
    const { documentType, documentNumber } = this.resolveDocumentInfo(customer, realClientName);

    return {
      id: siigo.id || `${rawPrefix}${rawNumber}`,
      clientName: this.resolveClientName(realClientName, customer),
      documentType,
      documentNumber,
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
      observations: '',
      moraDays: 0,
      isSynced: false
    };
  }
}

export const siigoService = new SiigoService();

