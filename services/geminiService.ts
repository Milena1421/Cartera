import { GoogleGenAI, Type, createPartFromBase64, createPartFromText } from "@google/genai";
import { Invoice, AIAuditFinding, BankTransaction } from "../types";

export const auditSiigoMapping = async (mappedInvoices: Invoice[], rawSiigoData: any[]): Promise<Invoice[]> => {
  if (mappedInvoices.length === 0) return [];

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY no esta configurada en el entorno.");
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
      contents: `ACTUA COMO UN AUDITOR FINANCIERO SENIOR.
      Tu mision es asegurar que los datos de la API de Siigo se hayan mapeado correctamente.

      ERRORES CRITICOS A CORREGIR:
      1. CRUCE DE CAMPOS: Si el current_mapping.client es una frase larga y tecnica, es un error.
      2. VALORES EN CERO: Si current_mapping.total o iva es 0 pero ves valores numericos en siigo_raw_source.financials, extraelos y corrigelos.
      3. DESCRIPCION: Asegurate de que la descripcion sea la del servicio prestado, no el nombre del cliente.

      REGLA DE ORO: El nombre del cliente nunca es una descripcion tecnica.

      PROCESAR ESTOS DATOS:
      ${JSON.stringify(context)}`,
      config: {
        systemInstruction: "NO INVENTES DATOS. Si no encuentras el cliente real en el RAW, manten el original pero limpialo de NITs. Responde estrictamente en JSON.",
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
      const corr = corrections.find((c) => c.index === idx);
      if (corr && corr.hasChanges) {
        const total = corr.correctedTotal !== undefined ? corr.correctedTotal : inv.total;
        const iva = corr.correctedIva !== undefined ? corr.correctedIva : inv.iva;
        return {
          ...inv,
          clientName: inv.clientName,
          description: corr.correctedDescription || inv.description,
          total,
          iva,
          subtotal: total - iva,
          debtValue: inv.status === 'Pagada' ? 0 : total
        };
      }
      return inv;
    });
  } catch (error) {
    console.error("Falla en Auditoria de IA (auditSiigoMapping):", error);
    return mappedInvoices;
  }
};

export const parseCSVWithAI = async (rawCsvText: string): Promise<Invoice[]> => {
  if (!rawCsvText || rawCsvText.trim().length < 20) return [];
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY no esta configurada en el entorno.");
      return [];
    }
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analiza este CSV y extrae datos de cartera: ${rawCsvText.substring(0, 30000)}`,
      config: {
        systemInstruction: "Extrae clientName, invoiceNumber, date y total solo cuando existan. No inventes fechas ni descripciones.",
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
    return extracted
      .map((item, idx) => ({
        id: `csv-${Date.now()}-${idx}`,
        clientName: String(item.clientName || '').toUpperCase().trim(),
        invoiceNumber: String(item.invoiceNumber || '').toUpperCase().trim(),
        description: String(item.description || '').trim(),
        date: String(item.date || '').trim(),
        dueDate: String(item.date || '').trim(),
        subtotal: (item.total || 0) / 1.19,
        iva: (item.total || 0) - ((item.total || 0) / 1.19),
        total: item.total || 0,
        discounts: 0,
        reteFuente: 0,
        reteIva: 0,
        reteIca: 0,
        status: 'Pendiente por pagar' as const,
        debtValue: item.total || 0,
        observations: '',
        moraDays: 0,
        isSynced: false
      }))
      .filter((item) => item.clientName && item.invoiceNumber);
  } catch (error) {
    console.error("Falla en Auditoria de IA (parseCSVWithAI):", error);
    return [];
  }
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });

export const parseBankStatementPdfWithAI = async (file: File): Promise<BankTransaction[]> => {
  if (!file || file.size === 0) return [];

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY no esta configurada en el entorno.");
      return [];
    }

    const ai = new GoogleGenAI({ apiKey });
    const base64Pdf = await fileToBase64(file);

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        createPartFromBase64(base64Pdf, file.type || 'application/pdf'),
        createPartFromText(`Extrae del extracto bancario UNICAMENTE movimientos donde ingreso dinero al banco.

Reglas:
- Incluir solo creditos, consignaciones, transferencias recibidas, pagos recibidos, recaudos o abonos a favor.
- Excluir debitos, retiros, comisiones, impuestos, IVA, GMF, saldos, encabezados, totales, subtotales y lineas sin valor real.
- No inventes datos. Si no hay NIT, referencia o factura, deja el campo vacio.
- El valor debe ser positivo, en pesos colombianos, sin separadores.
- La fecha debe salir en formato YYYY-MM-DD cuando sea posible.
- La descripcion debe contener tercero/pagador y concepto visible.
- En reference coloca NIT, documento, comprobante o numero de factura visible que ayude al cruce.`)
      ],
      config: {
        systemInstruction: "Eres un extractor contable. Devuelve JSON estricto. Si el PDF es escaneado, lee visualmente la tabla. Omite cualquier fila dudosa o sin ingreso bancario claro.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              description: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              reference: { type: Type.STRING },
            },
            required: ["date", "description", "amount"],
          },
        },
      },
    });

    const extracted: Array<Partial<BankTransaction>> = JSON.parse(response.text || "[]");
    return extracted
      .map((item, index) => ({
        id: `bank-pdf-${Date.now()}-${index}`,
        date: String(item.date || '').trim(),
        description: String(item.description || 'Movimiento bancario').trim(),
        amount: Math.abs(Number(item.amount || 0)),
        reference: String(item.reference || '').trim(),
        isMatched: false,
      }))
      .filter((transaction) => transaction.amount > 0 && transaction.description !== 'Movimiento bancario');
  } catch (error) {
    console.error("Falla extrayendo extracto bancario PDF:", error);
    return [];
  }
};

export const runAIAudit = async (invoices: Invoice[]): Promise<AIAuditFinding[]> => {
  if (!invoices || invoices.length === 0) return [];
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY no esta configurada en el entorno.");
      return [];
    }
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Cartera: ${JSON.stringify(invoices.map(i => ({ id: i.id, cli: i.clientName, debt: i.debtValue, mora: i.moraDays })))}`,
      config: {
        systemInstruction: "Genera alertas para deudas mayores a 60 dias.",
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
    console.error("Falla en Auditoria de IA (runAIAudit):", error);
    return [];
  }
};
