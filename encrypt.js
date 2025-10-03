import bcrypt from "bcryptjs";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "GestorFacturacion",
    password: "12328",
    port: 5432,
});

async function encryptPassword(userId, plainpassword) {

    try{
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(plainpassword, saltRounds);

        await pool.query(
            "UPDATE usuarios SET password = $1 WHERE id = $2",
            [hashedPassword, userId]
        );

        console.log("contraseña encriptada correctamente", plainpassword, hashedPassword);

    } catch (error){
        console.log("Error al encriptar:" , error);    
    } finally {
        pool.end();
    }
}

encryptPassword(2, "123456");