import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";
import fs from 'fs';
import path from 'path';
import 'dotenv/config';


// ========== CONFIGURACIÓN AZURE DOCUMENT INTELLIGENCE ==========
const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT
const AZURE_API_KEY = process.env.AZURE_API_KEY;

const PDF_FOLDER = './src/services/ordenes_descargadas';
const OUTPUT_FILE = './ordenes_compra_analizadas.json';

// Crear cliente de Document Intelligence
const client = new DocumentAnalysisClient(
  AZURE_ENDPOINT,
  new AzureKeyCredential(AZURE_API_KEY)
);

// ========== MAPEO CENTRALIZADO DE CAMPOS PARA ÓRDENES DE COMPRA ==========
const MAPEO_CAMPOS = {
  numero_orden: ['InvoiceId', 'InvoiceNumber', 'PurchaseOrderNumber', 'OrderNumber'],
  fecha_elaboracion: ['InvoiceDate', 'PurchaseOrderDate', 'IssueDate'],
  fecha_limite_entrega: ['DueDate', 'DeliveryDate'],
  comprador_nombre: ['VendorName', 'BuyerName'],
  comprador_nit: ['CustomerTaxId', 'CustomerVatId', 'BuyerTaxId'],
  comprador_direccion: ['CustomerAddress', 'BuyerAddress'],
  forma_pago: ['PaymentMethod', 'PaymentTerms'],
  terminos_pago: ['PaymentTerm', 'Terms'],
  subtotal: ['SubTotal'],
  iva: ['TotalTax', 'TaxAmount'],
  total: ['InvoiceTotal', 'TotalAmount', 'OrderTotal'],
  proveedor_nombre: ['VendorName', 'SupplierName'],
  proveedor_nit: ['VendorTaxId', 'VendorVatId', 'SupplierTaxId']
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

function debugCampos(campos, nombreArchivo) {
  console.log(`\n🔍 DEBUG CAMPOS DETECTADOS EN ${nombreArchivo}:`);
  console.log('='.repeat(80));
  
  if (!campos || Object.keys(campos).length === 0) {
    console.log('❌ No se detectaron campos');
    return;
  }
  
  Object.keys(campos).forEach(key => {
    const campo = campos[key];
    console.log(`📋 ${key}:`);
    console.log(`   Content: "${campo.content}"`);
    console.log(`   Confidence: ${(campo.confidence * 100).toFixed(1)}%`);
    console.log(`   Type: ${campo.kind}`);
    
    if (campo.values && Array.isArray(campo.values)) {
      console.log(`   Values: ${campos[key].values.length} elementos`);
      campos[key].values.forEach((valor, index) => {
        console.log(`   [Item ${index + 1}]:`);
        if (valor.properties) {
          Object.keys(valor.properties).forEach(propKey => {
            const prop = valor.properties[propKey];
            console.log(`      ${propKey}: "${prop?.content}" (${(prop?.confidence * 100).toFixed(1)}%)`);
          });
        } else {
          console.log(`      Content: "${valor.content}"`);
        }
      });
    }
    
    console.log('---');
  });
  console.log('='.repeat(80) + '\n');
}

function debugEstructuraCompleta(result, nombreArchivo) {
  console.log(`\n🔍 DEBUG ESTRUCTURA COMPLETA - ${nombreArchivo}:`);
  console.log('='.repeat(80));
  
  console.log(`📄 Document Type: ${result.documents?.[0]?.docType || 'N/A'}`);
  console.log(`📊 Confidence: ${(result.documents?.[0]?.confidence * 100).toFixed(1)}%`);
  console.log(`📝 Pages: ${result.pages?.length || 0}`);
  
  if (result.pages && result.pages.length > 0) {
    result.pages.forEach((page, pageIndex) => {
      console.log(`\n📄 Page ${pageIndex + 1}:`);
      console.log(`   Lines: ${page.lines?.length || 0}`);
      console.log(`   Words: ${page.words?.length || 0}`);
      
      // Mostrar primeras 10 líneas de texto
      if (page.lines && page.lines.length > 0) {
        console.log(`   Primeras líneas detectadas:`);
        page.lines.slice(0, 10).forEach((line, lineIndex) => {
          console.log(`   [${lineIndex + 1}] "${line.content}"`);
        });
        if (page.lines.length > 10) {
          console.log(`   ... y ${page.lines.length - 10} líneas más`);
        }
      }
    });
  }
  
  console.log('='.repeat(80) + '\n');
}

function mostrarResumenOrden(nombreArchivo, datos) {
  console.log(`✅ ${nombreArchivo}`);
  console.log(`   Orden: ${datos.numero_orden || 'Sin número'}`);
  console.log(`   Comprador: ${datos.comprador_nombre || 'N/A'}`);
  console.log(`   NIT: ${datos.comprador_nit || 'N/A'}`);
  console.log(`   Fecha: ${datos.fecha_elaboracion || 'N/A'}`);
  console.log(`   Total: $${datos.total}`);
  console.log(`   Forma de Pago: ${datos.forma_pago || 'N/A'}`);
  console.log(`   Confianza: ${(datos.confianza_general * 100).toFixed(1)}%`);
}

// ========== FUNCIÓN PRINCIPAL ANALIZAR ORDEN DE COMPRA ==========
async function analizarOrdenCompra(pdfPath) {
  try {
    const nombreArchivo = path.basename(pdfPath);
    console.log(`Procesando ${nombreArchivo}...`);

    const pdfBuffer = fs.readFileSync(pdfPath);
    
    // CAMBIO IMPORTANTE: Usar prebuilt-invoice en lugar de prebuilt-layout
    const poller = await client.beginAnalyzeDocument("prebuilt-invoice", pdfBuffer);
    const result = await poller.pollUntilDone();

    // DEBUG: Mostrar estructura completa
    //debugEstructuraCompleta(result, nombreArchivo);

    if (!result.documents || result.documents.length === 0) {
      console.warn(`⚠️  No se detectó estructura de documento en ${nombreArchivo}`);
      return {
        archivo: nombreArchivo,
        ruta: pdfPath,
        error: 'No se detectó estructura de documento',
        fecha_procesamiento: new Date().toISOString()
      };
    }

    const factura = result.documents[0];
    const campos = factura.fields || {};

    // DEBUG: Mostrar campos detectados
    //debugCampos(campos, nombreArchivo);

    let datosOrden = {
      archivo: nombreArchivo,
      numero_orden: extraerCampo(campos, MAPEO_CAMPOS.numero_orden).valor,
      fecha_elaboracion: extraerCampo(campos, MAPEO_CAMPOS.fecha_elaboracion).valor,
      fecha_limite_entrega: extraerCampo(campos, MAPEO_CAMPOS.fecha_limite_entrega).valor,
      
      // Solo información del comprador
      comprador_nombre: extraerCampo(campos, MAPEO_CAMPOS.comprador_nombre).valor,
      comprador_nit: extraerCampo(campos, MAPEO_CAMPOS.comprador_nit).valor,
      comprador_direccion: extraerCampo(campos, MAPEO_CAMPOS.comprador_direccion).valor,
      
      // Datos financieros
      subtotal: extraerCampo(campos, MAPEO_CAMPOS.subtotal).valor || 0,
      iva: extraerCampo(campos, MAPEO_CAMPOS.iva).valor || 0,
      total: extraerCampo(campos, MAPEO_CAMPOS.total).valor || 0,
      
      // Información de pago
      forma_pago: extraerCampo(campos, MAPEO_CAMPOS.forma_pago).valor,
      terminos_pago: extraerCampo(campos, MAPEO_CAMPOS.terminos_pago).valor,
      
      confianza_general: factura.confidence || 0
    };

    // Procesar items como campos individuales (no array)
    if (campos.Items?.values && Array.isArray(campos.Items.values) && campos.Items.values.length > 0) {
      const primerItem = campos.Items.values[0].properties || {};
      
      datosOrden.numero_solicitud = primerItem.RequestNumber?.content || '';
      datosOrden.solicitante = primerItem.Requester?.content || '';
      datosOrden.articulo_proveedor = primerItem.ProductCode?.content || primerItem.SupplierItem?.content || '';
      datosOrden.descripcion_item = primerItem.Description?.content || '';
      datosOrden.unidad = primerItem.Unit?.content || '';
      datosOrden.cantidad = primerItem.Quantity?.content || 0;
      datosOrden.precio_unitario = primerItem.UnitPrice?.content || 0;
      datosOrden.iva_item = primerItem.Tax?.content || 0;
      datosOrden.valor_total_item = primerItem.Amount?.content || 0;
    }

    // Mostrar resultados
    mostrarResumenOrden(nombreArchivo, datosOrden);

    return {
      archivo: nombreArchivo,
      ruta: pdfPath,
      datos: datosOrden,
      exito: true,
      fecha_procesamiento: new Date().toISOString()
    };

  } catch (error) {
    const nombreArchivo = path.basename(pdfPath);
    console.error(`❌ Error analizando ${nombreArchivo}:`, error);
    
    return {
      archivo: nombreArchivo,
      ruta: pdfPath,
      exito: false,
      error: {
        mensaje: error.message,
        codigo: error.code || error.statusCode,
        detalles: error.details || null
      },
      fecha_procesamiento: new Date().toISOString()
    };
  }
}

function ordenYaProcesada(nombreArchivo, listaOrdenes) {
  return listaOrdenes.some(f => f.archivo === nombreArchivo && f.exito === true);
}


// ========== FUNCIÓN PARA PROCESAR TODAS LAS ÓRDENES ==========
async function procesarTodasLasOrdenes() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 ANALIZADOR DE ÓRDENES DE COMPRA CON AZURE DOCUMENT INTELLIGENCE');
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

    const resultadosPrevios = (() => {
      try {
        if (!fs.existsSync(OUTPUT_FILE)) return [];
        const contenido = fs.readFileSync(OUTPUT_FILE, "utf8").trim();
        return contenido ? JSON.parse(contenido) : [];
      } catch (error) {
        console.error(`⚠️  Error leyendo ${OUTPUT_FILE}:`, error.message);
        return [];
      }
    })();


    console.log(`📄 Encontrados ${archivos.length} archivos PDF\n`);

    const resultados = [...resultadosPrevios];

    let exitosos = resultadosPrevios.filter(f => f.exito).length;
    let fallidos = resultadosPrevios.filter(f => !f.exito).length;

    for (let i = 0; i < archivos.length; i++) {
      const nombreArchivo = path.basename(archivos[i]);
      console.log(`\n[${i + 1}/${archivos.length}] ${nombreArchivo}`);

      // VALIDACIÓN — evitar reprocesar
      if (ordenYaProcesada(nombreArchivo, resultadosPrevios)) {
        console.log(`⏭️ Saltando ${nombreArchivo} (ya procesada anteriormente)`);
        continue;
      }

      // Procesar normalmente
      const resultado = await analizarOrdenCompra(archivos[i]);
      resultados.push(resultado);

      if (resultado.exito) exitosos++;
      else fallidos++;

      // Pequeña pausa
      if (i < archivos.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(resultados, null, 2), 'utf-8');

    console.log('\n' + '='.repeat(60));
    console.log('✨ RESUMEN DEL ANÁLISIS');
    console.log('='.repeat(60));
    console.log(`📊 Total órdenes procesadas: ${archivos.length}`);
    console.log(`✅ Analizadas exitosamente: ${exitosos}`);
    console.log(`❌ Con errores: ${fallidos}`);
    
    if (exitosos > 0) {
      const totalGeneral = resultados
        .filter(r => r.exito)
        .reduce((sum, r) => sum + (r.datos?.total || 0), 0);
      
      console.log(`💰 Total general: $${totalGeneral}`);
    }
    
    console.log(`💾 Resultados guardados en: ${path.resolve(OUTPUT_FILE)}`);
    console.log('='.repeat(60) + '\n');

    return true;
  } catch (error) {
    console.error('\n❌ Error general:', error.message);
    throw error;
  }
}

// Ejecutar análisis
export {procesarTodasLasOrdenes};
