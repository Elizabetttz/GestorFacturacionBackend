import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ========== CONFIGURACIÓN AZURE DOCUMENT INTELLIGENCE ==========
const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT;
const AZURE_API_KEY = process.env.AZURE_API_KEY;

const PDF_FOLDER = './src/services/facturas_pdf';
const OUTPUT_FILE = './facturas_analizadas.json';

// Crear cliente de Document Intelligence
const client = new DocumentAnalysisClient(
  AZURE_ENDPOINT,
  new AzureKeyCredential(AZURE_API_KEY)
);

// MAPEO CENTRALIZADO DE CAMPOS 
const MAPEO_CAMPOS = {
  numero_factura: ['InvoiceId', 'InvoiceNumber'],
  fecha_emision: ['InvoiceDate'],
  comercializadora: ['VendorName'],
  nit: ['VendorTaxId'],
  subtotal: ['SubTotal'],
  iva: ['TotalTax'],
  total: ['InvoiceTotal'],
};

// ========== FUNCIONES AUXILIARES ==========
function extraerCampo(campos, posiblesNombres) {
  for (const nombre of posiblesNombres) {
    if (campos[nombre]?.content !== undefined && campos[nombre]?.content !== '') {
      return {
        valor: campos[nombre].content,
        confianza: campos[nombre].confidence || 0
      };
    }
  }
  return { valor: '', confianza: 0 };
}

// Función para limpiar valores numéricos (eliminar símbolos $, saltos de línea, etc.)
function limpiarValor(valor) {
  if (!valor) return '';
  return String(valor)
    .replace(/\$/g, '')
    .replace(/\n/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Función para limpiar fecha (eliminar saltos de línea)
function limpiarFecha(fecha) {
  if (!fecha) return '';
  return String(fecha)
    .replace(/\n/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calcularRetenciones(subtotal, iva) {
  const subtotalNum = parseFloat(String(subtotal).replace(/,/g, '')) || 0;
  const ivaNum = parseFloat(String(iva).replace(/,/g, '')) || 0;
  
  return {
    rete_fuente: subtotalNum * 0.025,  // 2.5% del subtotal
    rete_iva: ivaNum * 0.15,            // 15% del IVA
    rete_ica: 0                         // Por defecto 0, puedes ajustar según necesites
  };
}

function mostrarResumenFactura(nombreArchivo, datos) {
  console.log(`✅ ${nombreArchivo}`);
  console.log(`   Factura: ${datos.numero_factura || 'Sin número'}`);
  console.log(`   Comercializadora: ${datos.comercializadora || 'N/A'}`);
  console.log(`   NIT: ${datos.nit || 'N/A'}`);
  console.log(`   Fecha: ${datos.fecha_emision || 'N/A'}`);
  console.log(`   Descripción: ${datos.descripcion || 'N/A'}`);
  console.log(`   Subtotal: ${datos.subtotal}`);
  console.log(`   IVA: ${datos.iva}`);
  console.log(`   Total: ${datos.valor_total}`);
  console.log(`   Rete Fuente: ${datos.rete_fuente}`);
  console.log(`   Rete IVA: ${datos.rete_iva}`);
  console.log(`   Rete ICA: ${datos.rete_ica}`);
}

// ========== FUNCIÓN PRINCIPAL ANALIZAR FACTURA ==========
async function analizarFactura(pdfPath) {
  try {
    const nombreArchivo = path.basename(pdfPath);
    console.log(`\nProcesando ${nombreArchivo}...`);

    const pdfBuffer = fs.readFileSync(pdfPath);
    const poller = await client.beginAnalyzeDocument("prebuilt-invoice", pdfBuffer);
    const result = await poller.pollUntilDone();

    if (!result.documents || result.documents.length === 0) {
      console.warn(`⚠️  No se detectó información de factura en ${nombreArchivo}`);
      return {
        archivo: nombreArchivo,
        ruta: pdfPath,
        error: 'No se detectó estructura de factura',
        exito: false,
        fecha_procesamiento: new Date().toISOString()
      };
    }

    const factura = result.documents[0];
    const campos = factura.fields || {};

    // Extraer datos
    const numeroFactura = limpiarValor(extraerCampo(campos, MAPEO_CAMPOS.numero_factura).valor);
    const fechaEmision = limpiarFecha(extraerCampo(campos, MAPEO_CAMPOS.fecha_emision).valor);
    const comercializadora = limpiarValor(extraerCampo(campos, MAPEO_CAMPOS.comercializadora).valor);
    const nit = limpiarValor(extraerCampo(campos, MAPEO_CAMPOS.nit).valor);
    const subtotal = limpiarValor(extraerCampo(campos, MAPEO_CAMPOS.subtotal).valor);
    const iva = limpiarValor(extraerCampo(campos, MAPEO_CAMPOS.iva).valor);
    const total = limpiarValor(extraerCampo(campos, MAPEO_CAMPOS.total).valor);

    // Extraer descripción del primer item
    let descripcion = '';
    if (campos.Items?.values && Array.isArray(campos.Items.values) && campos.Items.values.length > 0) {
      const primerItem = campos.Items.values[0].properties || {};
      descripcion = limpiarValor(primerItem.Description?.content || '');
    }

    // Calcular retenciones
    const retenciones = calcularRetenciones(subtotal, iva);

    // Objeto final con SOLO los campos que necesitas
    const datosFactura = {
      numero_factura: numeroFactura,
      comercializadora: comercializadora,
      nit: nit,
      fecha_emision: fechaEmision,
      descripcion: descripcion,
      iva: iva,
      rete_fuente: retenciones.rete_fuente.toFixed(2),
      rete_iva: retenciones.rete_iva.toFixed(2),
      rete_ica: retenciones.rete_ica.toFixed(2),
      subtotal: subtotal,
      valor_total: total,
      ruta: pdfPath
    };

    // Mostrar resultados
    mostrarResumenFactura(nombreArchivo, datosFactura);

    return {
      archivo: nombreArchivo,
      ruta: pdfPath,
      datos: datosFactura,
      exito: true,
      fecha_procesamiento: new Date().toISOString()
    };

  } catch (error) {
    const nombreArchivo = path.basename(pdfPath);
    console.error(`❌ Error analizando ${nombreArchivo}:`, error.message);
    
    return {
      archivo: nombreArchivo,
      ruta: pdfPath,
      exito: false,
      error: {
        mensaje: error.message,
        codigo: error.code || error.statusCode
      },
      fecha_procesamiento: new Date().toISOString()
    };
  }
}

// ========== FUNCIÓN PARA PROCESAR TODAS LAS FACTURAS ==========
async function procesarTodasLasFacturas() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 ANALIZADOR DE FACTURAS CON AZURE DOCUMENT INTELLIGENCE');
  console.log('='.repeat(60) + '\n');

  try {
    if (!fs.existsSync(PDF_FOLDER)) {
      console.error(`❌ La carpeta ${PDF_FOLDER} no existe`);
      return;
    }

    const archivos = fs.readdirSync(PDF_FOLDER)
      .filter(file => file.toLowerCase().endsWith('.pdf'))
      .map(file => path.join(PDF_FOLDER, file));

    if (archivos.length === 0) {
      console.log('❌ No se encontraron archivos PDF para analizar');
      return;
    }

    console.log(`📄 Encontrados ${archivos.length} archivos PDF\n`);

    const resultados = [];
    let exitosos = 0;
    let fallidos = 0;

    for (let i = 0; i < archivos.length; i++) {
      console.log(`\n[${ i + 1}/${archivos.length}]`);
      
      const resultado = await analizarFactura(archivos[i]);
      resultados.push(resultado);

      if (resultado.exito) {
        exitosos++;
      } else {
        fallidos++;
      }

      // Pequeña pausa entre llamadas para no saturar la API
      if (i < archivos.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Guardar resultados
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(resultados, null, 2), 'utf-8');

    // Resumen final
    console.log('\n' + '='.repeat(60));
    console.log('✨ RESUMEN DEL ANÁLISIS');
    console.log('='.repeat(60));
    console.log(`📊 Total facturas procesadas: ${archivos.length}`);
    console.log(`✅ Analizadas exitosamente: ${exitosos}`);
    console.log(`❌ Con errores: ${fallidos}`);
    console.log(`💾 Resultados guardados en: ${path.resolve(OUTPUT_FILE)}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error general:', error.message);
  }
}

// Ejecutar análisis
procesarTodasLasFacturas();