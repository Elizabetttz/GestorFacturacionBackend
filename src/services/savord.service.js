import pool from '../config/db.js';
import fs from 'fs';
import path from 'path';

const JSON_FILE = './ordenes_compra_analizadas.json';
const PDF_FOLDER = './src/services/ordernes_descargadas';
const PDF_WEB_PATH = '/ordenes/';

async function crearTabla(){
    const db = await pool.connect();

    try {
        await db.query(`
        CREATE TABLE IF NOT EXISTS ordenes_compra (
            id SERIAL PRIMARY KEY,
            comprador_nit VARCHAR(50),
            comprador_nombre VARCHAR(100),
            fecha_elaboracion DATE,
            descripcion VARCHAR(250),
            cantidad VARCHAR(10),
            precio_unitario VARCHAR(20),
            valor_total_item VARCHAR(20),
            subtotal VARCHAR(20),
            iva VARCHAR(20),
            total VARCHAR(20),
            terminos_pago VARCHAR(100),
            ruta VARCHAR(150)
        )
    `);


    console.log('✅ Tabla verificada/creada');


    } catch(error){
        console.error('❌ Error creando tablas:', error);
    } finally {
        db.release();
    }
}

async function insertarJson(datosOrden){
    const db = await pool.connect();

    try{
        const existeQuery = 'SELECT id FROM ordenes_compra WHERE id = $1';
        const existeResult = await db.query(existeQuery, [datosOrden.id]);

        if(existeResult.rows.length > 0){
            console.log(`⚠️ Factura ${datosOrden.datos.id} ya existe en la DB`);
            return existeResult.rows[0].id;
        }

        const rutaPdfCompleta = path.resolve(datosOrden.ruta || path.join(PDF_FOLDER, datosOrden.ruta));

        const ordenesQuery = `
            INSERT INTO ordenes_compra (
            comprador_nit,
            comprador_nombre,
            fecha_elaboracion,
            descripcion,
            cantidad,
            precio_unitario,
            valor_total_item,
            subtotal,
            iva,
            total,
            terminos_pago,
            ruta
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            ) RETURNING id
        `;

        const orden = datosOrden.datos;

        const ordenesValues = [
            orden.comprador_nit,
            orden.comprador_nombre,
            orden.fecha_elaboracion,
            orden.descripcion_item,
            orden.cantidad,
            orden.precio_unitario,
            orden.valor_total_item,
            orden.subtotal,
            orden.iva,
            orden.total,
            orden.terminos_pago,
            datosOrden.ruta  
        ];

        console.log(` Insertando orden: ${orden.id}`);
        console.log(`Valores: Subtotal=${ordenesValues[8]}, Total=${ordenesValues[10]}`);

        const ordenResult = await db.query(ordenesQuery, ordenesValues);
        const ordenId = ordenResult.rows[0].id;

        console.log(`Orden guardada (ID: ${ordenId})`);

        return ordenId;

    } catch (error){
        console.error('❌ Error guardando factura en DB:', error.message);
        throw error;
    } finally{
        db.release();
    }
}

async function importarJSONaDb(){
    console.log('\n IMPORTAR DE JSON A POSTGRESQL\n');

    try{
        if(!fs.existsSync(JSON_FILE)){
            console.error('❌ El archivo JSON no existe');
            return;
        }

        const jsonData = fs.readFileSync(JSON_FILE, 'utf8');
        const ordenes = JSON.parse(jsonData);

        await crearTabla();

        console.log(` Facturas encontradas: ${ordenes.length}`);

        let exitosos = 0;
        let fallidos = 0;

        for (let i = 0; i < ordenes.length; i++){
            const orden = ordenes[i];
            console.log(`\n[${i+1}/${ordenes.length}] ${orden.ruta}`);

            
            if(!orden.exito){
                console.log(`❌ Saltando orden con error`);
                fallidos++;
                continue;
            }

            try {
                await insertarJson(orden);
                exitosos++;
            } catch(error){
                console.error(`❌ Error insertando:`, error.message);
                fallidos++;
            }
        }

        console.log('\n✨ RESUMEN:');
        console.log(`✅ Insertadas: ${exitosos}`);
        console.log(`❌ Fallidas: ${fallidos}`);
        console.log(`📊 Total: ${ordenes.length}`);

        return true;

    } catch (error){
        console.error('❌ Error general:', error.message);
        throw error;
    }
}


export {importarJSONaDb};

