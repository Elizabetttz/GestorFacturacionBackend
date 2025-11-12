import pool from '../config/db.js';
import fs from 'fs';
import path from 'path';

const JSON_FILE = './facturas_analizadas.json';
const PDF_FOLDER = './src/services/facturas_pdf';
const PDF_WEB_PATH = '/facturas/';


// ========== FUNCIÓN PARA FORMATEAR FECHAS ==========
function formatearFecha(fechaStr) {
  if (!fechaStr || fechaStr.trim() === '') return null;
  
  try {
    if (fechaStr.includes('/')) {
      const partes = fechaStr.split('/').map(part => part.replace(/\n/g, '').trim());
      if (partes.length === 3) {
        const dia = partes[0].padStart(2, '0');
        const mes = partes[1].padStart(2, '0');
        const anio = partes[2];
        return `${anio}-${mes}-${dia}`;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function crearTabla(){
    const db = await pool.connect();

    try {
        await db.query(`
        CREATE TABLE IF NOT EXISTS facturas_recibidas (
            id SERIAL PRIMARY KEY,
            ruta VARCHAR(255) NOT NULL,
            numero_factura VARCHAR(100),
            descripcion VARCHAR(255),
            comercializadora_nombre VARCHAR(255),
            comercializadora_nit VARCHAR(100),
            fecha_emision DATE,
            subtotal VARCHAR(20),
            iva VARCHAR(20),
            descuento VARCHAR(20),
            rete_fuente VARCHAR(20),
            rete_iva VARCHAR(20),
            rete_ica VARCHAR(20),
            total VARCHAR(20)
        )
    `);

    console.log('✅ Tabla verificada/creada');

    } catch(error){
        console.error('❌ Error creando tablas:', error);
    } finally {
        db.release();
    }
}

async function insertarJson(datosFactura){
    const db = await pool.connect();

    try{
        const existeQuery = 'SELECT id FROM facturas_recibidas WHERE numero_factura = $1';
        const existeResult = await db.query(existeQuery, [datosFactura.datos.numero_factura]);

        if(existeResult.rows.length > 0){
            console.log(`⚠️ Factura ${datosFactura.datos.numero_factura} ya existe en la DB`);
            return existeResult.rows[0].id;
        }

        const rutaPdfCompleta = path.resolve(datosFactura.ruta || path.join(PDF_FOLDER, datosFactura.archivo));

        const facturaQuery = `
            INSERT INTO facturas_recibidas (
                ruta, numero_factura, descripcion, comercializadora_nombre, 
                comercializadora_nit, fecha_emision, subtotal, iva, descuento, 
                rete_fuente, rete_iva, rete_ica, total
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
            ) RETURNING id
        `;

        const factura = datosFactura.datos;

        // Formatear fecha
        const fechaFormateada = formatearFecha(factura.fecha_emision);

        // VALORES CON LA ESTRUCTURA CORRECTA
        const facturaValues = [
            rutaPdfCompleta,                              // $1 - ruta
            factura.numero_factura || '',                 // $2 - numero_factura
            factura.descripcion || '',                    // $3 - descripcion
            factura.comercializadora || '',               // $4 - comercializadora_nombre
            factura.nit || '',                            // $5 - comercializadora_nit
            fechaFormateada,                              // $6 - fecha_emision
            factura.subtotal || '0',                      // $7 - subtotal
            factura.iva || '0',                           // $8 - iva
            '0',                                          // $9 - descuento (no existe en tu JSON)
            factura.rete_fuente || '0',                   // $10 - rete_fuente
            factura.rete_iva || '0',                      // $11 - rete_iva
            factura.rete_ica || '0',                      // $12 - rete_ica
            factura.valor_total || '0'                    // $13 - total
        ];

        console.log(`💾 Insertando factura: ${factura.numero_factura}`);
        console.log(`📊 Valores: Subtotal=${facturaValues[6]}, IVA=${facturaValues[7]}, Total=${facturaValues[12]}`);

        const facturaResult = await db.query(facturaQuery, facturaValues);
        const facturaId = facturaResult.rows[0].id;

        console.log(`✅ Factura guardada (ID: ${facturaId})`);

        return facturaId;

    } catch (error){
        console.error('❌ Error guardando factura en DB:', error.message);
        throw error;
    } finally{
        db.release();
    }
}

async function importarJSONaDb(){
    console.log('\n📦 IMPORTAR DE JSON A POSTGRESQL\n');

    try{
        if(!fs.existsSync(JSON_FILE)){
            console.error('❌ El archivo JSON no existe');
            return;
        }

        const jsonData = fs.readFileSync(JSON_FILE, 'utf8');
        const facturas = JSON.parse(jsonData);

        await crearTabla();

        console.log(`📄 Facturas encontradas: ${facturas.length}`);

        let exitosos = 0;
        let fallidos = 0;

        for (let i = 0; i < facturas.length; i++){
            const factura = facturas[i];
            console.log(`\n[${i+1}/${facturas.length}] ${factura.archivo}`);

            if(!factura.exito){
                console.log(`❌ Saltando factura con error`);
                fallidos++;
                continue;
            }

            try {
                await insertarJson(factura);
                exitosos++;
            } catch(error){
                console.error(`❌ Error insertando:`, error.message);
                fallidos++;
            }
        }

        console.log('\n✨ RESUMEN:');
        console.log(`✅ Insertadas: ${exitosos}`);
        console.log(`❌ Fallidas: ${fallidos}`);
        console.log(`📊 Total: ${facturas.length}`);

    } catch (error){
        console.error('❌ Error general:', error.message);
    }
}

// Ejecutar importación
importarJSONaDb();