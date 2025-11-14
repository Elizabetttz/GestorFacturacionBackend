import express from 'express';
import multer from 'multer';
import pool from '../config/db.js';
import path from 'path';
import fs from 'fs';
import { searchAndDownloadInvoices } from "../services/ordenes.service.js";
import  { importarJSONaDb } from "../services/savord.service.js";
import  { procesarTodasLasOrdenes } from "../Analyzer-ordenes.js";


const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads-ordenes/");
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

// ========== OBTENER TODAS LAS ÓRDENES ==========
router.get("/actualizar", async(req,res) =>{
    try{
        await searchAndDownloadInvoices();
        console.log('\nOrdenes descargadas del correo correctamente');

        await procesarTodasLasOrdenes();
        console.log('\nOrdenes analizadas correctamente.')

        await importarJSONaDb();
        console.log('\nOrdenes cargadas correctamente a la Base de datos');

        return res.send("Proceso completado")
    } catch (error ){
        console.error('\nError en el proceso' , error);
    
         return res.status(500).json({
            ok: false,
            message: "Error en el proceso",
            error: error.message
        });
    }
});

router.get("/", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ordenes_compra ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        console.log('Error al obtener órdenes:', err);
        res.status(500).json({ message: 'Error al obtener órdenes de compra' });
    }
});

// ========== ELIMINAR ORDEN POR ID ==========
router.delete("/delete/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        // Primero obtener la ruta del PDF para eliminarlo también
        const ordenResult = await pool.query('SELECT ruta FROM ordenes_compra WHERE id = $1', [id]);
        
        if (ordenResult.rows.length === 0) {
            return res.status(404).json({ message: 'Orden no encontrada' });
        }

        // Eliminar de la base de datos
        await pool.query('DELETE FROM ordenes_compra WHERE id = $1', [id]);
        
        // Opcional: Eliminar el archivo PDF físico
        const rutaPdf = ordenResult.rows[0].ruta;
        if (rutaPdf && fs.existsSync(rutaPdf)) {
            fs.unlinkSync(rutaPdf);
            console.log('✅ PDF eliminado:', rutaPdf);
        }

        console.log('✅ Orden eliminada con ID:', id);
        res.json({ 
            success: true, 
            message: 'Orden de compra eliminada exitosamente',
            id: id 
        });
        
    } catch (err) {
        console.error('❌ Error al eliminar orden:', err);
        res.status(500).json({ 
            success: false,
            message: 'Error al eliminar la orden de compra',
            error: err.message 
        });
    }
});

// ========== OBTENER UNA ORDEN POR ID ==========
router.get("/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query('SELECT * FROM ordenes_compra WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Orden no encontrada' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error al obtener orden:', err);
        res.status(500).json({ message: 'Error al obtener la orden de compra' });
    }
});

// ========== SUBIR ORDEN (OPCIONAL) ==========
router.post("/upload", upload.single('pdf'), async (req, res) => {
    try {
        const { 
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
            terminos_pago
        } = req.body;

        const ruta = req.file ? req.file.path : null;

        const query = `
            INSERT INTO ordenes_compra (
                comprador_nit, comprador_nombre, fecha_elaboracion,
                descripcion, cantidad, precio_unitario, valor_total_item,
                subtotal, iva, total, terminos_pago, ruta
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `;

        const values = [
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
        ];

        const result = await pool.query(query, values);
        
        res.status(201).json({
            success: true,
            message: 'Orden creada exitosamente',
            data: result.rows[0]
        });

    } catch (err) {
        console.error('Error al crear orden:', err);
        res.status(500).json({ 
            success: false,
            message: 'Error al crear la orden de compra',
            error: err.message 
        });
    }
});

export default router;