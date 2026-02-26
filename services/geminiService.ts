
import { GoogleGenAI, Type } from "@google/genai";
import { Invoice, AIAuditFinding } from "../types";

/**
 * AUDITORÍA INTERNA CRÍTICA:
 * Detecta si el campo 'clientName' contiene en realidad una descripción técnica.
 * Compara los datos mapeados con el JSON original (RAW) de la API de Siigo.
 */
export const auditSiigoMapping = async (mappedInvoices: Invoice[], rawSiigoData: any[]): Promise<Invoice[]> => {
  if (mappedInvoices.length === 0) return [];

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY no está configurada en el entorno.");
      return mappedInvoices;
    }
    const ai = new GoogleGenAI({ apiKey });
    const context = mappedInvoices.map((inv, idx) => ({
      index: idx,
      current_mapping: {
        client: inv.clientName,
        invoice: inv.invoiceNumber,
        desc: inv.description,
        total: inv.total,
        iva: inv.iva
      },
      siigo_raw_source: {
        customer: rawSiigoData[idx]?.customer,
        items: rawSiigoData[idx]?.items?.map((it: any) => ({ d: it.description, n: it.name })),
        financials: {
          t: rawSiigoData[idx]?.total,
          tv: rawSiigoData[idx]?.total_value,
          c: rawSiigoData[idx]?.cost,
          tx: rawSiigoData[idx]?.taxes
        }
      }
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `ACTÚA COMO UN AUDITOR FINANCIERO SENIOR.
      Tu misión es asegurar que los datos de la API de Siigo se hayan mapeado correctamente.
      
      ERRORES CRÍTICOS A CORREGIR:
      1. CRUCE DE CAMPOS: Si el 'current_mapping.client' es una frase larga, describe un servicio (ej: "SOPORTE Y MANTENIMIENTO...", "CONFERENCIA EN INTELIGENCIA ARTIFICIAL..."), ES UN ERROR. 
      2. VALORES EN CERO: Si 'current_mapping.total' o 'iva' es 0 pero ves valores numéricos en 'siigo_raw_source.financials', extráelos y corrígelos.
      3. DESCRIPCIÓN: Asegúrate de que la descripción sea la del servicio prestado, no el nombre del cliente.

      REGLA DE ORO: El nombre del cliente NUNCA es una descripción técnica. Si el cliente dice algo de Inteligencia Artificial o Soporte, es que está mal mapeado; búscalo en el objeto customer del RAW.
      
      FACTURA DE EJEMPLO REAL (Referencia):
      FING 1076 -> Cliente: ORGANIZACION SANTA LUCIA S.A | Item: Cloud Computing.

      PROCESAR ESTOS DATOS:
      ${JSON.stringify(context)}`,
      config: {
        systemInstruction: "NO INVENTES DATOS. Si no encuentras el cliente real en el RAW, mantén el original pero límpialo de NITs. Responde estrictamente en JSON.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              correctedClient: { type: Type.STRING },
              correctedDescription: { type: Type.STRING },
              correctedTotal: { type: Type.NUMBER },
              correctedIva: { type: Type.NUMBER },
              hasChanges: { type: Type.BOOLEAN }
            },
            required: ["index", "hasChanges"],
          },
        },
      },
    });

    const corrections: any[] = JSON.parse(response.text || "[]");
    
    return mappedInvoices.map((inv, idx) => {
      const corr = corrections.find(c => c.index === idx);
      if (corr && corr.hasChanges) {
        const total = corr.correctedTotal !== undefined ? corr.correctedTotal : inv.total;
        const iva = corr.correctedIva !== undefined ? corr.correctedIva : inv.iva;
        return {
          ...inv,
          clientName: (corr.correctedClient || inv.clientName).toUpperCase().trim(),
          description: corr.correctedDescription || inv.description,
          total: total,
          iva: iva,
          subtotal: total - iva,
          debtValue: inv.status === 'Pagada' ? 0 : total
        };
      }
      return inv;
    });
  } catch (error) {
    console.error("Falla en Auditoría de IA (auditSiigoMapping):", error);
    return mappedInvoices;
  }
};

export const parseCSVWithAI = async (rawCsvText: string): Promise<Invoice[]> => {
  if (!rawCsvText || rawCsvText.trim().length < 20) return [];
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY no está configurada en el entorno.");
      return [];
    }
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analiza este CSV y extrae datos de cartera: ${rawCsvText.substring(0, 30000)}`,
      config: {
        systemInstruction: "Extrae clientName (Empresa), invoiceNumber (FV 000), date (YYYY-MM-DD), total (numero).",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              clientName: { type: Type.STRING },
              invoiceNumber: { type: Type.STRING },
              date: { type: Type.STRING },
              total: { type: Type.NUMBER },
              description: { type: Type.STRING }
            },
            required: ["clientName", "invoiceNumber", "total"],
          },
        },
      },
    });

    const extracted: any[] = JSON.parse(response.text || "[]");
    return extracted.map((item, idx) => ({
      id: `csv-${Date.now()}-${idx}`,
      clientName: item.clientName.toUpperCase().trim(),
      invoiceNumber: item.invoiceNumber.toUpperCase().trim(),
      description: item.description || "Importación por CSV",
      date: item.date || new Date().toISOString().split('T')[0],
      dueDate: item.date || new Date().toISOString().split('T')[0],
      subtotal: (item.total || 0) / 1.19,
      iva: (item.total || 0) - ((item.total || 0) / 1.19),
      total: item.total || 0,
      discounts: 0,
      reteFuente: 0,
      reteIva: 0,
      reteIca: 0,
      status: 'Pendiente por pagar',
      debtValue: item.total || 0,
      observations: "Procesado por IA",
      moraDays: 0,
      isSynced: false
    }));
  } catch (error) {
    console.error("Falla en Auditoría de IA (parseCSVWithAI):", error);
    return [];
  }
};

export const runAIAudit = async (invoices: Invoice[]): Promise<AIAuditFinding[]> => {
  if (!invoices || invoices.length === 0) return [];
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY no está configurada en el entorno.");
      return [];
    }
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Cartera: ${JSON.stringify(invoices.map(i => ({ id: i.id, cli: i.clientName, debt: i.debtValue, mora: i.moraDays })))}`,
      config: {
        systemInstruction: "Genera alertas para deudas > 60 días.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              invoiceId: { type: Type.STRING }
            },
            required: ["type", "title", "description", "invoiceId"],
          },
        },
      },
    });
    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Falla en Auditoría de IA (runAIAudit):", error);
    return [];
  }
};
