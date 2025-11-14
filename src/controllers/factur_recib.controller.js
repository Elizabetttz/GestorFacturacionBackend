import { searchAndDownloadInvoices } from "../services/correos.processor.service";
import  { importarJSONaDB } from "../services/savfact.service";
import  { procesarTodasLasFacturas } from "../azure_analyzer";

console.log('Iniciando proceso de actualizacion...\n')

(async () =>{
    try {
        await searchAndDownloadInvoices();
        console.log('\nProceso de descargar facturas completado con exito.')
    
        await procesarTodasLasFacturas();
        console.log('\nFacturas analizadas correctamente..');

        await importarJSONaDB();
        console.log('\nFacturas añadidas correctamente a la base de datos.')
    }catch (error){
        console.error('\n Error ejecutando:', error.message);
    }
})();