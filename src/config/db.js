import pkg from "pg";

//De pg extraemos Pool, un pool es un conjunto de conexiones a la base de datos 
const { Pool } = pkg;

//Configuracion de la base de datos
const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "GestorFacturacion",
    password: "12328",
    port: 5432,
});

export default pool;