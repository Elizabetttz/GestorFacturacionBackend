import express from 'express';
import multer from 'multer';
import pool from '../config/db.js';
import fs from 'fs';
import { searchAndDownloadInvoices } from "../services/correos.processor.service.js";
import  { importarJSONaDb } from "../services/savfact.service.js";
import  { procesarTodasLasFacturas } from "../azure_analyzer.js";

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads-recib/");
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });


// ========== OBTENER TODAS LAS FACTURAS RECIBIDAS ==========
router.get("/actualizar", async (req,res ) =>{
    try {
        await searchAndDownloadInvoices();
        console.log('\nFacturas descargadas del correo correctamente');

        await procesarTodasLasFacturas();
        console.log('\nFacturas analizadas correctamente.')

        await importarJSONaDb();
        console.log('\nFacturas cargadas correctamente a la Base de datos');

        return res.send("Proceso completado")
    } catch (error ){
        console.error('\nError en el proceso' , error);
    
         return res.status(500).json({
            ok: false,
            message: "Error en el proceso",
            error: error.message
        });
    }
})


router.get("/", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM facturas_recibidas ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        console.log('❌ Error al obtener facturas:', err);
        res.status(500).json({ message: 'Error al obtener facturas recibidas' });
    }
});

// ========== OBTENER UNA FACTURA POR ID ==========
router.get("/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query('SELECT * FROM facturas_recibidas WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Factura no encontrada' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Error al obtener factura:', err);
        res.status(500).json({ message: 'Error al obtener la factura' });
    }
});

// ========== ELIMINAR FACTURA POR ID ==========
router.delete("/delete/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        // Primero obtener la ruta del PDF para eliminarlo también
        const facturaResult = await pool.query('SELECT ruta FROM facturas_recibidas WHERE id = $1', [id]);
        
        if (facturaResult.rows.length === 0) {
            return res.status(404).json({ message: 'Factura no encontrada' });
        }

        // Eliminar de la base de datos
        await pool.query('DELETE FROM facturas_recibidas WHERE id = $1', [id]);
        
        // Opcional: Eliminar el archivo PDF físico
        const rutaPdf = facturaResult.rows[0].ruta;
        if (rutaPdf && fs.existsSync(rutaPdf)) {
            fs.unlinkSync(rutaPdf);
            console.log('✅ PDF eliminado:', rutaPdf);
        }

        console.log('✅ Factura eliminada con ID:', id);
        res.json({ 
            success: true, 
            message: 'Factura recibida eliminada exitosamente',
            id: id 
        });
        
    } catch (err) {
        console.error('❌ Error al eliminar factura:', err);
        res.status(500).json({ 
            success: false,
            message: 'Error al eliminar la factura recibida',
            error: err.message 
        });
    }
});

// ========== BUSCAR FACTURAS POR NIT O NOMBRE ==========
router.get("/search/:term", async (req, res) => {
    const { term } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT * FROM facturas_recibidas 
             WHERE comercializadora_nit ILIKE $1 
             OR comercializadora_nombre ILIKE $1 
             OR numero_factura ILIKE $1
             ORDER BY id DESC`,
            [`%${term}%`]
        );
        
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error en búsqueda:', err);
        res.status(500).json({ message: 'Error al buscar facturas' });
    }
});

// ========== SUBIR FACTURA MANUALMENTE (OPCIONAL) ==========
router.post("/upload", upload.single('pdf'), async (req, res) => {
    try {
        const { 
            numero_factura,
            comercializadora_nombre,
            comercializadora_nit,
            fecha_emision,
            descripcion,
            iva,
            rete_fuente,
            rete_iva,
            rete_ica,
            subtotal,
            total
        } = req.body;

        const ruta = req.file ? req.file.path : null;

        const query = `
            INSERT INTO facturas_recibidas (
                ruta, numero_factura, descripcion, comercializadora_nombre,
                comercializadora_nit, fecha_emision, subtotal, iva, descuento,
                rete_fuente, rete_iva, rete_ica, total
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `;

        const values = [
            ruta,
            numero_factura,
            descripcion,
            comercializadora_nombre,
            comercializadora_nit,
            fecha_emision,
            subtotal,
            iva,
            '0', // descuento
            rete_fuente,
            rete_iva,
            rete_ica,
            total
        ];

        const result = await pool.query(query, values);
        
        res.status(201).json({
            success: true,
            message: 'Factura creada exitosamente',
            data: result.rows[0]
        });

    } catch (err) {
        console.error('❌ Error al crear factura:', err);
        res.status(500).json({ 
            success: false,
            message: 'Error al crear la factura',
            error: err.message 
        });
    }
});

export default router;
