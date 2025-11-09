import { PublicClientApplication, TokenCacheContext } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import fs from 'fs';
import path from 'path';
import AdmZip from "adm-zip";
import 'isomorphic-fetch';

const CLIENT_ID = '621f00ee-1415-475d-bc86-c3bc0c39ebd6';
const EMAIL = 'dnkideas@hotmail.com';
const TOKEN_FILE = './tokens.json';
const DOWNLOAD_FOLDER = './facturas_descargadas';
const PDF_FOLDER = './facturas_pdf';

const KEYWORDS = ['factura', 'Factura', 'Facturación', 'facturación', 'FACTURA', 'FACTURACIÓN'];

const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: 'https://login.microsoftonline.com/common'
  },

  cache: {
    cachePlugin: {
      beforeCacheAccess: async (cacheContext) => {
        if(fs.existsSync(TOKEN_FILE)) {
          cacheContext.tokenCache.deserialize(fs.readFileSync(TOKEN_FILE, 'utf-8'));
        }
      },
      afterCacheAccess: async (cacheContext) => {
        if(cacheContext.cacheHasChanged){
          fs.writeFileSync(TOKEN_FILE, cacheContext.tokenCache.serialize());
        }
      }
    }
  }
};

const pca = new PublicClientApplication(msalConfig);

if(!fs.existsSync(DOWNLOAD_FOLDER)){
  fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });
}

if(!fs.existsSync(PDF_FOLDER)){
  fs.mkdirSync(PDF_FOLDER, { recursive: true });
}

async function getAccessToken(){
  const accounts = await pca.getTokenCache().getAllAccounts();

  if (accounts.length > 0){
    try{
      console.log('Obteniendo token automaticamente...');
      const silentRequest = {
        account: accounts[0],
        scopes: [
           'https://graph.microsoft.com/Mail.Read',
           'https://graph.microsoft.com/Mail.ReadWrite',
           'offline_access'
        ]
      };

      const response = await pca.acquireTokenSilent(silentRequest);
      console.log('Token obtenido correctamente\n');
      return response.accessToken;
    } catch (error){
      console.log('Token expirado, necesitas autenticarte de nuevo')
    }
  }

  console.log('Primera vez necesitas autenticarte manualmente\n');
  const deviceCodeRequest = {
    deviceCodeCallback: (response) =>{
       console.log('ACCION REQUERIDA (solo esta vez):');
      console.log('1. Abre esta URL en tu navegador:', response.verificationUri);
      console.log('2. Ingresa este código:', response.userCode);
      console.log('3. Inicia sesión con tu cuenta de Hotmail\n');
    },
    scopes: [
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'offline_access'
    ]
  };

  const response = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
  console.log('Token guardado, proximas ejecuciones seran automaticas');
  return response.accessToken;
}

function sanitizeFilename(filename){
  return filename.replace(/[<>:"/\\|?*]/g,'-');
}

function extractZip(zipPath, extractPath){
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);
    console.log(`ZIP extraido en: ${extractPath}`);

    let pdfCount = 0;
    const zipEntries = zip.getEntries();

    zipEntries.forEach(entry =>{
      if(!entry.isDirectory){
        const entryName = entry.entryName;
        console.log(`archivo: ${entryName}`);

        if(entryName.toLowerCase().endsWith('.pdf')){
          const pdfFileName = sanitizeFilename(path.basename(entryName));
          const pdfDestPath = path.join(PDF_FOLDER,pdfFileName);

          let finalPath = pdfDestPath;
          let counter = 1;
          while(fs.existsSync(finalPath)){
            const nameWithoutExt = path.parse(pdfFileName).name;
            const ext = path.parse(pdfFileName).ext;
            finalPath = path.join(PDF_FOLDER, `${nameWithoutExt}_${counter}${ext}`);
            counter++;
          }

          const pdfSourcePath = path.join(extractPath, entryName);
          fs.copyFileSync(pdfSourcePath,finalPath);
          console.log(`Pdf copiado a facturas_pdf/${path.basename(finalPath)}`);
          pdfCount++;
        }
      }
    });

    return pdfCount;
  } catch (error){
    console.error(`Error extrayendo ZIP: ${error.message}`);
    return 0;
  }
}

async function downloadAttachment(client, messageId, attachment, emailSubject){
  try{
    const attachmentData = await client
    .api(`/me/messages/${messageId}/attachments/${attachment.id}`)
    .get();

    const filename = sanitizeFilename(attachment.name);
    const filepath = path.join(DOWNLOAD_FOLDER, filename);

    const buffer = Buffer.from(attachmentData.contentBytes, 'base64');
    fs.writeFileSync(filepath, buffer);

    console.log(`Descargado: ${filename} (${(buffer.length / 1024).toFixed(2)} KB)`);

    if (filename.toLowerCase().endsWith('.zip')) {
      const extractPath = path.join(DOWNLOAD_FOLDER, `${path.parse(filename).name}_extracted`);
      if (!fs.existsSync(extractPath)){
        fs.mkdirSync(extractPath, {recursive: true});
      }

      pdfCount = extractZip(filepath, extractPath);
    } else if (filename.toLowerCase().endsWith('.pdf')){
      console.log(`pdf directo (no de zip)- ignorado`)
    }

    return true;
  } catch (error){
    console.error(`Error descargando ${attachment.name}: ${error.message}`);
    return 0;
  }
}

async function searchAndDownloadInvoices(){
  try {
    const accessToken = await getAccessToken();

    const client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      }
    });

    console.log('Buscando correo con palabras claves de facturas...\n');

    const searchQuery = KEYWORDS.map(kw => `"${kw}"`).join(' OR ');

    const messages = await client
    .api('/me/messages')
    .search(searchQuery)
    .select('id,subject,from,receivedDateTime,hasAttachments')
    .top(150)
    .get();

    console.log(`Encontrados ${messages.value.length} correos con palabras clave\n`);

    if (messages.value.length === 0){
      console.log('No se encontraron correos con las palabras clave');
      return;
    }

    let totalDownloaded = 0;
    let totalPDFs = 0;
    let emailsWithAttachments = 0;
    let emailsProcessed = 0;

    for (const message of messages.value){
      emailsProcessed++;

      if(!message.hasAttachments){
        continue;
      }

      emailsWithAttachments++;
      console.log(`\n📧 Correo: ${message.subject}`);
      console.log(`   De: ${message.from.emailAddress.address}`);
      console.log(`   Fecha: ${new Date(message.receivedDateTime).toLocaleString()}`);
    
      const attachments = await client
      .api(`/me/messages/${message.id}/attachments`)
      .get();

      if(attachments.value.length > 0){
        console.log(`${attachments.value.length} archivos adjuntos: `);

        for (const attachment of attachments.value){
          const pdfCount = await downloadAttachment(client, message.id, attachment, message.subject);
          totalDownloaded++;
          totalPDFs += pdfCount;
        }
      }
    }

      console.log('\n' + '='.repeat(60));
    console.log(`✨ Resumen:`);
    console.log(`   📧 Correos encontrados: ${messages.value.length}`);
    console.log(`   📎 Correos con adjuntos: ${emailsWithAttachments}`);
    console.log(`   📥 Archivos descargados: ${totalDownloaded}`);
    console.log(`   📄 PDFs extraídos: ${totalPDFs}`);
    console.log(`   📁 PDFs guardados en: ${path.resolve(PDF_FOLDER)}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('error:', error.message);

    if (error.statusCode){
      console.error('Codigo de estado:', error.statusCode);
    }
  }
}

searchAndDownloadInvoices();
