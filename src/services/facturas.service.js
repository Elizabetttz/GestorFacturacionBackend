import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import pool from '../config/db.js';


//Funcion para convertir fechas en Excel:
const convertirFechaExcel = (valorFecha) => {
  if(!valorFecha) return null;

  //Si ya es una fecha valida
  if(valorFecha instanceof Date){
    return valorFecha.toISOString().split('T')[0];
  }

  //Si tiene el formato de excel
  if (typeof valorFecha === 'number'){
    const fecha = xlsx.SSF.parse_date_code(valorFecha);
    return `${fecha.y}-${String(fecha.m).padStart(2, '0')}-${String(fecha.d).padStart(2, '0')}`;
  }
  return valorFecha;
};

export const guardarFacturasDesdeExcel = async (filePath) => {
  
  const rutaNormalizada = path.resolve(filePath);    
  
  try {

    console.log('Ruta recibida:', filePath);


    // Verificar existencia del archivo
    if (!fs.existsSync(rutaNormalizada)) {
      throw new Error(`El archivo no existe: ${rutaNormalizada}`);
    }

    const buffer = fs.readFileSync(rutaNormalizada);
    console.log('Buffer leido, tamaño:', buffer.length);

    // Leer el Excel
    const workbook = xlsx.read(buffer, {type: 'buffer'} );
    const sheetNames = workbook.SheetNames;

    const HEADERS_A_USAR = [
        '__EMPTY_A', 'N° FACTURA', 'NIT', 'TERCERO', 'FECHA', 'CONCEPTO', 'SUB TOTAL', 
        'IVA', 'TOTAL', 'RETE FTE', 'ICA 6.9', 'RETE IVA', 'FACTURACIÓN importes', 
        'T. DESCUENTOS', 'T. A PAGAR', 'FECHA PAGO', 'FORMA DE PAGO', 'VALOR', 
        'SALDO', 'REVISIÓN'
    ];

    let insertadas = 0;
    let errores = 0;
    let data = [];

    for (const sheetName of sheetNames){
      console.log(`n--- procesando hoja: ${sheetName}---`);
   
      const sheet = workbook.Sheets[sheetName];
      
      const data = xlsx.utils.sheet_to_json(sheet, {
      header:HEADERS_A_USAR,
      range:3
   
    });

    console.log(`Filas encontradas: ${data.length}`);
    console.log('Primera fila:', data[0]);

    

    for (const row of data) {

      const numeroFactura = row['N° FACTURA'];

      if (!numeroFactura || String(numeroFactura).trim() === ''){
        console.log(`Fila saltada: No se encontró numero de factura.`);
        continue;
      }

      try{
        const query = `
        INSERT INTO facturas (numero_factura, nit, tercero, fecha, concepto, subtotal, iva, total, rete_fte, ica_6_9, rete_iva, factu_importes, total_descuentos, total_pagar, fecha_pago, forma_pago, valor, saldo, revision)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (numero_factura) DO NOTHING;
      `;
      const values = [
        row['N° FACTURA'] || null,
        row['NIT'] || null,
        row['TERCERO'] || null,
        convertirFechaExcel(row['FECHA']) || null,
        row['CONCEPTO'] || null,
        row['SUB TOTAL'] || 0,
        row['IVA'] || 0,
        row['TOTAL'] || 0,
        row['RETE FTE'] ||0,
        row['ICA 6.9'] ||0,
        row['RETE IVA'] || 0,
        row['FACTURACIÓN importes'] || 0,
        row['T. DESCUENTOS'] || 0,
        row['T. A PAGAR'] || 0,
        convertirFechaExcel(row['FECHA PAGO']), 
        row['FORMA DE PAGO'] || null,
        row['VALOR'] || 0,
        row['SALDO'] || 0, 
        row['REVISIÓN'] || null
      ];

      await pool.query(query, values);
      insertadas++;
      } catch(error){
        console.error(`Error en la fila:`, row, error.message);
        errores++;
      }
    }
  }

    fs.unlinkSync(rutaNormalizada);

    console.log(`Proceso completado: ${insertadas} insertadas,${errores} errores`);

    return {
      success: true,
      mensaje: `Se procesaron ${data.length} filas`,
      insertadas,
      errores
    };

  } catch (error) {
    console.error('Error al procesar el Excel:', error.message);

    //Eliminar el archivo en caso de error
    if(fs.existsSync(rutaNormalizada)){
      fs.unlinkSync(rutaNormalizada);
    }
    
    throw new Error(`Error al procesar el Excel: ${error.message}`);
  }
};