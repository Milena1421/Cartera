
import { createClient } from '@supabase/supabase-js';
import { Invoice } from '../types';

const SUPABASE_URL = 'https://xfsbogjozqvaphoapqnz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PL1m0jMzLteH19aQWAY2oA_pb6-FMIe';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Nombre de la tabla principal
const TABLE_NAME = 'invoices';
const BUCKET_NAME = 'invoice-documents';

/**
 * NOTA PARA EL DESARROLLADOR:
 * Si recibes un error de "column not found", ejecuta este SQL en el editor de Supabase:
 * ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "creditAmount" NUMERIC DEFAULT 0;
 */

export const supabaseService = {
  /**
   * Guarda o actualiza una lista de facturas en la base de datos.
   */
  async syncInvoices(invoices: Invoice[]) {
    try {
      if (!invoices || invoices.length === 0) return null;

      // Mapeo limpio de datos
      const dataToSync = invoices.map(inv => {
        const payload: any = {
          id: inv.id,
          clientName: inv.clientName || '',
          invoiceNumber: inv.invoiceNumber || '',
          description: inv.description || '',
          date: inv.date || '',
          dueDate: inv.dueDate || '',
          subtotal: Number(inv.subtotal) || 0,
          iva: Number(inv.iva) || 0,
          total: Number(inv.total) || 0,
          discounts: Number(inv.discounts) || 0,
          reteFuente: Number(inv.reteFuente) || 0,
          reteIva: Number(inv.reteIva) || 0,
          reteIca: Number(inv.reteIca) || 0,
          status: inv.status || 'Pendiente por pagar',
          debtValue: Number(inv.debtValue) || 0,
          observations: inv.observations || '',
          moraDays: Number(inv.moraDays) || 0,
          documentUrl: inv.documentUrl || null,
          isSynced: true,
          paymentDate: inv.paymentDate || null,
          creditDate: inv.creditDate || null,
          paidAmount: Number(inv.paidAmount) || 0,
          creditAmount: Number(inv.creditAmount) || 0 // Asegúrate que esta columna exista en Supabase
        };

        return payload;
      });

      const { data, error } = await supabase
        .from(TABLE_NAME)
        .upsert(dataToSync, { onConflict: 'id' });
      
      if (error) {
        console.error('Error de Sincronización Supabase:', error.message);
        // Si el error es de columna faltante, lanzamos una alerta más clara
        if (error.message.includes('creditAmount')) {
          throw new Error('Falta la columna "creditAmount" en la tabla de Supabase. Por favor ejecute el SQL de actualización.');
        }
        return null;
      }
      return data;
    } catch (err) {
      console.error('Error Crítico en Supabase Sync:', err);
      throw err;
    }
  },

  /**
   * Obtiene todas las facturas guardadas en la nube.
   */
  async fetchInvoices(): Promise<Invoice[]> {
    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .order('date', { ascending: false });
      
      if (error) {
        console.warn('Supabase Fetch Warning:', error.message);
        return [];
      }
      return (data as Invoice[]) || [];
    } catch (err) {
      console.error('Error Crítico en Supabase Fetch:', err);
      return [];
    }
  },

  /**
   * Sube un archivo al bucket y retorna la URL pública.
   */
  async uploadDocument(file: File, path: string): Promise<string | null> {
    try {
      const cleanPath = path.replace(/[^\w.-]/g, '_');
      const fileName = `${Date.now()}_${cleanPath}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, file);

      if (uploadError) {
        console.error('Error al subir documento:', uploadError.message);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(uploadData.path);

      return urlData.publicUrl;
    } catch (err) {
      console.error('Error Crítico en Storage:', err);
      return null;
    }
  }
};
