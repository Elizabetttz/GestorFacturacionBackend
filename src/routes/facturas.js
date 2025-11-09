import express from 'express';
import multer from 'multer';
import pool from '../config/db.js';

import { subirExcel } from '../controllers/facturasController.js';

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({storage});

router.post('/upload', upload.single('file'), subirExcel);

router.get("/", async (req, res) =>{
    try{
        const result = await pool.query('SELECT * FROM facturas');
        res.json(result.rows);
    } catch (err){
        console.log('Error al obtener facturas:', err);
        res.status(500).json({message: 'Error al obtner usuarios'});
    }
});

router.delete("/delete/:id",async (req, res) =>{
    const { id } = req.params;
    console.log('ID recibido:', id)

    if (!id) {
        return res.status(400).json({ message: 'ID no proporcionado' });
    }

    try{
        const result = await pool.query(`DELETE FROM facturas WHERE id = $1 RETURNING *; `, [id]);
        
        if(result.rowCount === 0){
            res.status(404).json({ message: 'Factura no encontrada'});
        }
        
        res.json({message: 'Facura eliminada correctamente', deleted: result.rows[0]} );
    } catch (err){
        console.log('Error al eliminar la factura:' , err);
        res.status(500).json({message: 'Error al eliminar la factura'});
    }
});

export default router;