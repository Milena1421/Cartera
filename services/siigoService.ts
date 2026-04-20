import { Invoice } from '../types';

export class SiigoService {
  private async requestSiigo<T>(endpoint: string, method: string = 'GET', data?: unknown): Promise<T> {
    try {
      const response = await fetch('/api/siigo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          endpoint,
          method,
          data,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload?.error?.Errors?.[0]?.Message ||
          payload?.error?.message ||
          payload?.error ||
          `Error HTTP ${response.status}`;
        throw new Error(String(message));
      }

      return payload as T;
    } catch (error) {
      console.error('Siigo proxy request failure:', error);
      const detail = error instanceof Error ? error.message : 'sin detalle';
      throw new Error(`Error de conexion con Siigo: ${detail}`);
    }
  }

  /**
   * Limpia el nombre del cliente usando Regex para asegurar que no sea una descripcion tecnica.
   */
  private cleanClientName(name: string): string {
    if (!name) return 'CLIENTE NO IDENTIFICADO';
    
    // 1. Eliminar NITs (ej: 900.000.000-0 o 123456789-0)
    let cleaned = name.replace(/\d{3,}(\.\d{3,})?(\.\d{3,})?-\d/g, '');
    
    // 2. Eliminar prefijos comunes de identificacion
    cleaned = cleaned.replace(/^(NIT|CC|ID|CEDULA|IDENTIFICACION|SR|SRA|CLIENTE)[:.\s-]*/i, '');
    
    // 3. Si el nombre contiene palabras clave de descripcion (ej: "CONFERENCIA", "MANTENIMIENTO"),
    // es probable que el mapeo haya fallado. El audit de IA corregira esto despues.
    
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

  private isUsableCustomerName(value?: string): boolean {
    const cleaned = this.cleanClientName(String(value || ''));
    return Boolean(cleaned && cleaned !== 'CLIENTE NO IDENTIFICADO' && !this.isIdentifierOnly(cleaned));
  }

  private extractCustomerName(cust: any): string {
    if (!cust) return '';

    const candidates: string[] = [
      cust.full_name,
      cust.business_name,
      cust.commercial_name,
      cust.company_name,
      cust.trade_name,
      cust.display_name,
      cust.legal_name,
      cust.social_reason,
      cust.razon_social,
      cust.nombre,
      cust.customer_name,
    ].filter(Boolean).map(String);

    if (cust.name) {
      if (typeof cust.name === 'object') {
        candidates.push(
          [
            cust.name.first_name,
            cust.name.middle_name,
            cust.name.last_name,
            cust.name.second_last_name,
          ].filter(Boolean).join(' ')
        );
      } else if (Array.isArray(cust.name)) {
        candidates.push(cust.name.join(' '));
      } else {
        candidates.push(String(cust.name));
      }
    }

    if (Array.isArray(cust.contacts)) {
      cust.contacts.forEach((contact: any) => {
        candidates.push(
          [
            contact?.first_name,
            contact?.middle_name,
            contact?.last_name,
            contact?.second_last_name,
          ].filter(Boolean).join(' ')
        );
        if (contact?.name) candidates.push(String(contact.name));
      });
    }

    return candidates.find((name) => this.isUsableCustomerName(name))?.trim() || '';
  }

  private getCustomerId(customer: any): string {
    return String(customer?.id || customer?.customer_id || customer?.uuid || '').trim();
  }

  private hasResolvedCustomer(invoice: any): boolean {
    return this.isUsableCustomerName(this.extractCustomerName(invoice?.customer));
  }

  private async hydrateCustomerData(invoice: any): Promise<any> {
    let hydratedInvoice = invoice;

    try {
      if (!this.hasResolvedCustomer(hydratedInvoice) && hydratedInvoice?.id) {
        const detail = await this.requestSiigo<any>(`/invoices/${encodeURIComponent(String(hydratedInvoice.id))}`);
        hydratedInvoice = {
          ...hydratedInvoice,
          ...detail,
          customer: {
            ...(hydratedInvoice.customer || {}),
            ...(detail?.customer || {}),
          },
        };
      }

      const customerId = this.getCustomerId(hydratedInvoice?.customer);
      if (!this.hasResolvedCustomer(hydratedInvoice) && customerId) {
        const customerDetail = await this.requestSiigo<any>(`/customers/${encodeURIComponent(customerId)}`);
        hydratedInvoice = {
          ...hydratedInvoice,
          customer: {
            ...(hydratedInvoice.customer || {}),
            ...(customerDetail || {}),
          },
        };
      }
    } catch (error) {
      console.warn('No se pudo hidratar cliente desde Siigo:', {
        invoice: hydratedInvoice?.id || hydratedInvoice?.number || hydratedInvoice?.consecutive,
        error,
      });
    }

    return hydratedInvoice;
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
      let allResults: any[] = [];
      let page = 1;
      let totalPages = 1;

      // Buscamos los ultimos 45 dias por defecto
      const defaultStart = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
      const start = startDate || defaultStart;

      do {
        const params = new URLSearchParams({
          page: String(page),
          page_size: '30',
          created_start: start,
          t: String(Date.now()),
        });
        if (endDate) params.set('created_end', endDate);

        const data = await this.requestSiigo<any>(`/invoices?${params.toString()}`);
        const results = data?.results || [];
        allResults = [...allResults, ...results];
        totalPages = data?.pagination?.total_pages || 1;
        page++;
      } while (page <= totalPages && page <= 3);

      const hydratedResults: any[] = [];
      for (const inv of allResults) {
        hydratedResults.push(await this.hydrateCustomerData(inv));
      }

      const mapped = hydratedResults.map((inv) => {
        const rawName = this.extractCustomerName(inv.customer);
        return this.mapToInternalInvoice(inv, rawName, inv.customer);
      });

      return { invoices: mapped, raw: hydratedResults };
    } catch (error) {
      console.error('Siigo getInvoices Error:', error);
      throw error;
    }
  }

  private mapToInternalInvoice(siigo: any, realClientName: string, customer: any): Invoice {
    // EXTRACCION FINANCIERA SEGUN FACTURA REAL (Total Bruto, Total a Pagar)
    // Buscamos 'total' o 'total_value'. Siigo a veces cambia el nombre segun el endpoint.
    const total = Number(siigo.total || siigo.total_value || siigo.total_amount || 0);
    const balance = Number(siigo.balance !== undefined ? siigo.balance : (siigo.total_balance !== undefined ? siigo.total_balance : total));
    
    // Extraccion robusta de IVA y Subtotal.
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

    // Identificacion Factura (Regex: FV 1234)
    const rawPrefix = String(siigo.type?.code || siigo.document?.code || 'FV')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .replace(/^FV$/, 'FING');
    const rawNumber = String(siigo.number || siigo.consecutive || '0').replace(/[^0-9]/g, '');
    const invoiceNumber = `${rawPrefix}${rawNumber}`;

    // Descripcion: No confundir el ITEM con el CLIENTE
    // Priorizamos la descripcion del primer producto/servicio
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
