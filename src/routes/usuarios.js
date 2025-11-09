import express from "express";
import bcrypt, { hash } from 'bcryptjs';
import pool from "../config/db.js";

const router  = express.Router();

//Logica crear usuario desde el frontend

router.post("/usuarios", async (req, res) => {
    try {
        const { tipo_usuario, documento, nombre, password} = req.body;

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            "INSERT INTO usuarios (tipo_usuario, documento, nombre, password) VALUES ($1, $2, $3, $4) RETURNING *",[tipo_usuario, documento, nombre, hashedPassword]
        );

        res.status(201).json({message: "usuario creado", user: result.rows[0]})
    } catch (error){
        console.log(error);
        res.status(500).json({error: "error creando usuario"})
    }
});

export default router;
router.get("/usuarios", async (req, res) =>{
    try{
        const result = await pool.query('SELECT * FROM usuarios');
        res.json(result.rows);
    } catch (err){
        console.log('Error al obtener usuarios:', err);
        res.status(500).json({message: 'Error al obtener usuarios'});
    }
});