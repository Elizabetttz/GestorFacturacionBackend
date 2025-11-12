import express from 'express';
import multer from 'multer';
import pool from '../config/db.js';

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads-recib/");
    },
    filename: (req, file, cb) =>{
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({storage});

router.get("/", async (req, res)=>{
    try{
        const result = await pool.query('SELECT * FROM facturas_recibidas');
        res.json(result.rows);
    } catch (err){
        console.log('Error al obtener facturas:', err);
        res.status(500).json({message: 'Error al obtener facturas'});
    }
});

export default router;

