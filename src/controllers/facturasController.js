import { guardarFacturasDesdeExcel } from "../services/facturas.service.js";

export const subirExcel = async (req, res) =>{
    try{

        //verificamos que se subio un archivo
        if(!req.file){
            return res.status(400).json({
                error:'No se subio ningun archivo'
            });
        }

        console.log('Archivo recibido:', req.file);

        const filePath = req.file.path;
        const result = await guardarFacturasDesdeExcel(filePath);
        res.status(200).json(result);
    } catch (error){
        console.error('Error en controlador:', error);
        res.status(500).json({error: error.message, detalles: 'Verifica que alrchivo excel tengas las columnas correctas'});
    
    };
};
