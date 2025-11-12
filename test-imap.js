import fs from "fs";
import path from "path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/* ------------------ Utilidades ------------------ */
const normSpace = s => s.replace(/\s+/g, " ").trim();
const normalizeAccents = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const onlyDigits = s => s.replace(/[^\d]/g, "");
const parseNumber = s => {
  if (!s) return null;
  // quitar espacios, 'COP', '$' y normalizar comas/puntos: asumimos coma miles, punto decimales o viceversa
  let t = s.replace(/[^\d,.\-]/g, "");
  // heurística: si hay both '.' and ',' -> asumir '.' miles ',' decimales (ej 1.234,56)
  if (t.includes(".") && t.includes(",")) {
    t = t.replace(/\./g, "").replace(/,/g, ".");
  } else {
    // si solo comas y varias comas -> comas como miles
    const commaCount = (t.match(/,/g) || []).length;
    if (commaCount > 1) t = t.replace(/,/g, "");
    else t = t.replace(/,/g, ".");
  }
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
};

/* ------------------ Patrones base (case-insensitive) ------------------ */
const reNIT = /NIT[:\s\.#\-]*([\d\.,\-]+)/ig;
const rePhone = /(?:Tel(?:efono|éfono)?|PBX|Cel(?:ular)?)[:\s\-]*([+0-9\-\s]{7,20})/ig;
const reDateCandidates = [
  /\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/g,   // 01/02/2024 or 01-02-2024
  /\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/g,       // 2024-02-01
  /\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2})\b/g    // 01/02/24
];
const reSubtotal = /(SUBTOTAL|SUB-TOTAL)[^\d\-]{0,10}([\d\.,]+)/i;
const reIva = /(I\.?V\.?A|IVA|IMPUESTO\s*IVA)[^\d\-]{0,10}([\d\.,]+)/i;
const reNeto = /(NETO\s*A\s*PAGAR|TOTAL\s*A\s*PAGAR|TOTAL\s*PAGAR|TOTAL\s*FACTURA)[^\d\-]{0,10}([\d\.,]+)/i;
const reDescripcionHeader = /(DESCRIPCION|DESCRIPCI[OÓ]N|DETALLE|CONCEPTO)/i;

/* ------------------ Extraer texto con pdfjs ------------------ */
async function extraerTextoPDF(ruta) {
  const data = new Uint8Array(fs.readFileSync(ruta));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  let páginas = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(it => it.str);
    // juntamos las cadenas respetando el orden
    páginas.push(strings.join(" "));
  }
  // devolvemos el texto por páginas y también concatenado
  return {
    text: páginas.join("\n"),
    pages: páginas
  };
}

/* ------------------ Extracciones específicas ------------------ */
function findAll(regex, texto) {
  const out = [];
  let m;
  while ((m = regex.exec(texto)) !== null) {
    out.push({ match: m[1] ?? m[0], index: m.index });
  }
  // resetear lastIndex para permitir reuso
  regex.lastIndex = 0;
  return out;
}

function extractCompanyNit(texto) {
  // Buscar palabras clave de empresa en primeras líneas
  const head = texto.split("\n").slice(0, 6).join(" ");
  const companyKeywords = /(COMERCIALIZADORA|S\.A\.S|LTDA|LIMITADA|S\.A\.|EMPRESA|COMPAÑIA|COLOMBIA)/i;
  const hasCompanyKeyword = companyKeywords.test(head);

  // Si hay keywords, buscar NIT cerca de esas primeras líneas
  if (hasCompanyKeyword) {
    const fragment = head;
    const m = fragment.match(/NIT[:\s\.#\-]*([\d\.,\-]+)/i);
    if (m) return m[1].trim();
  }

  // Si no, tomar el primer NIT del documento (heurística común)
  const all = findAll(reNIT, texto);
  if (all.length > 0) return all[0].match.trim();

  return null;
}

function extractPhones(texto) {
  const matches = findAll(rePhone, texto);
  return matches.map(m => m.match.trim());
}

function extractDates(texto) {
  for (const r of reDateCandidates) {
    const m = texto.match(r);
    if (m) return m[0];
  }
  return null;
}

function extractMonetary(regex, texto) {
  const m = texto.match(regex);
  if (m) return m[2] ? m[2].trim() : null;
  return null;
}

/* ------------------ Extraer líneas de items (intento heurístico) ------------------ */
function extractItemsFromText(texto) {
  // Buscamos patrones de filas: cantidad (numero) ... precio unitario ... total
  // Ejemplos:
  // "1.00 EMPACK REDONDO 2\" X 300 MM 11,163.00 11,163.00"
  // Regex flexible: cantidad (decimales) + some description (min 5 chars) + two numbers (unitario y total)
  const rows = [];
  const rowRegex = /(\d+(?:[.,]\d+)?)\s+([A-Z0-9\-\(\)\/\"\'\s]{5,100}?)\s+([\d\.,]{3,})\s+([\d\.,]{3,})/ig;
  let m;
  while ((m = rowRegex.exec(texto)) !== null) {
    rows.push({
      cantidad: m[1].trim(),
      descripcion: m[2].trim(),
      valor_unitario: m[3].trim(),
      valor_total: m[4].trim()
    });
  }
  // reset
  rowRegex.lastIndex = 0;
  // Si no hay filas por el regex anterior, intentar un split por líneas y buscar números
  if (rows.length === 0) {
    const lines = texto.split(/\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s{2,}|\t/); // usar multiples espacios como separador
      if (parts.length >= 3) {
        // buscar números en partes
        const nums = parts.filter(p => /[\d\.,]{3,}/.test(p));
        if (nums.length >= 2) {
          const qty = parts[0].match(/^\d+(?:[.,]\d+)?$/) ? parts[0] : null;
          rows.push({
            cantidad: qty || "",
            descripcion: parts.slice(0, parts.length - nums.length).join(" "),
            valor_unitario: nums[0],
            valor_total: nums[nums.length - 1]
          });
        }
      }
    }
  }
  return rows;
}

/* ------------------ Función principal de extracción por archivo ------------------ */
async function procesarArchivo(ruta) {
  try {
    const { text, pages } = await extraerTextoPDF(ruta);
    const raw = normSpace(text);
    const normalized = normalizeAccents(raw); // quitar acentos para facilitar matching
    // Datos básicos
    const nitEmpresa = extractCompanyNit(normalized);
    const allNits = findAll(reNIT, normalized).map(x => x.match);
    const phones = extractPhones(normalized);
    const fecha = extractDates(normalized);
    const subtotal = extractMonetary(reSubtotal, normalized) || null;
    const iva = extractMonetary(reIva, normalized) || null;
    const neto = extractMonetary(reNeto, normalized) || null;
    const items = extractItemsFromText(normalized);

    return {
      pdf: path.basename(ruta),
      nit_empresa: nitEmpresa,
      todos_nits: allNits,
      telefonos: phones,
      fecha_emision: fecha,
      subtotal_raw: subtotal,
      iva_raw: iva,
      neto_raw: neto,
      subtotal: parseNumber(subtotal),
      iva: parseNumber(iva),
      neto: parseNumber(neto),
      items
    };
  } catch (err) {
    console.error("Error procesando", ruta, err);
    return { pdf: path.basename(ruta), error: String(err) };
  }
}

/* ------------------ Ejecutar sobre carpeta ------------------ */
async function procesarCarpeta(carpeta) {
  const archivos = fs.readdirSync(carpeta).filter(f => f.toLowerCase().endsWith(".pdf"));
  const resultados = [];
  for (const a of archivos) {
    const ruta = path.join(carpeta, a);
    console.log("Procesando", a);
    const r = await procesarArchivo(ruta);
    console.log(JSON.stringify(r, null, 2));
    resultados.push(r);
  }
  // opcional: guardar CSV o JSON
  fs.writeFileSync(path.join(carpeta, "resultado_extraccion.json"), JSON.stringify(resultados, null, 2));
  console.log("Resultado guardado en resultado_extraccion.json");
}

const carpeta = path.join(process.cwd(), "src/services/facturas_pdf");
procesarCarpeta(carpeta).catch(err => console.error(err));
