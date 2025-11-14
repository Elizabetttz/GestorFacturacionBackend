import express from "express"; //Framework para crear el servidor y manejar las rutas(endpoints)
import cors  from "cors"; // Middleware que permite que otros dominios como el frontend se conecten con el backend sin problemas de sguridad
import bcrypt from "bcryptjs"; // Es la libreria para encriptar y comparar las contraseñas
import jwt from "jsonwebtoken"; // Sirve para generar y validar tokens de sesión
import pool from "./src/config/db.js";
import path from "path";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
//Configuramos el servidor
const app = express();

//Middleware
app.use(cors({
 origin: 'http://localhost:4200', 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
})); //Lo que nos habilita que el servidor sea consumido de otro origenes 
app.use(express.json()) // permite recibir datos en formato Json en las peticiones.

//Clave secreta para JWTm, es necesaria para confirmar y verificar los tokens JWT.
const SECRET_KEY = "354322012328"

//Ruta de Usuarios
import usuariosRoutes from "./src/routes/usuarios.js"
app.use("/usuarios", usuariosRoutes);

//Ruta de Facturas
import facturasRoutes from "./src/routes/facturas.js";
app.use("/facturas", facturasRoutes);

//Ruta de facturas recibidas
import facturasRecibRoutes from "./src/routes/facturas_recibidas.js"
app.use("/facturas_recibidas", facturasRecibRoutes);

// PARA QUE LOS PDFs SE PUEDAN DESCARGAR
app.use('/ordenes', express.static(path.join(__dirname, 'src/services/ordenes_descargadas')));
app.use('/facturas', express.static(path.join(__dirname, 'src/services/facturas_pdf')));

//Ruta de ordenes de compra
import ordenesRoutes from "./src/routes/ordenes.js"
app.use("/ordenes_compra", ordenesRoutes);


//Ruta de Login 
app.post("/api/login", async (req, res) => {
    const { documento, psw} = req.body;

    try {
        const result = await pool.query(
            "SELECT * FROM usuarios WHERE documento = $1", [documento]
    
        );

        if (result.rows.length === 0){
            return res.status(400).json({ message: "Usuario no encontrado"});
        }

        const usuario = result.rows[0];

         console.log("Contraseña enviada:", psw);
        console.log("Hash :", usuario.password);

        //comparar contraseñas
        const validPassword = await bcrypt.compare(psw, usuario.password);
        if(!validPassword){
            return res.status(400).json({ message: "Contraseña incorrecta"});
        }

        const token = jwt.sign(
            {
                id: usuario.id, name: usuario.nombre, tipo: usuario.tipo_usuario,
            },
            SECRET_KEY,
            {expiresIn: "2h"}
        );

        res.json({token, usuario: {id: usuario.id, name: usuario.nombre, tipo: usuario.tipo_usuario}});

    } catch(err){
         console.error('Error en login:', err);
        res.status(500).json({message: "Erro en el servidor"});

    }

}
);


app.get("/", (req, res) => {
    res.send("Servidor funcionando :) ");
    
});

app.listen(3000, ()=>{
console.log("Servidor corriendo en https://localhost:3000")
});