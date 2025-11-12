import { PublicClientApplication, TokenCacheContext } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import fs from 'fs';
import path from 'path';
import AdmZip from "adm-zip";
import 'isomorphic-fetch';
import 'dotenv/config';


const CLIENT_ID = process.env.CLIENT_ID;
const EMAIL = 'dnkideas@hotmail.com';
const TOKEN_FILE = './tokens.json';
const PDF_FOLDER = './src/services/ordenes_descargadas';

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

function extractZip(zipPath, extractPath, emailSubject){
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
          const pdfDestPath = path.join(PDF_FOLDER, pdfFileName);

          let finalPath = pdfDestPath;
          let counter = 1;
          while(fs.existsSync(finalPath)){
            const nameWithoutExt = path.parse(pdfFileName).name;
            const ext = path.parse(pdfFileName).ext;
            finalPath = path.join(PDF_FOLDER, `${nameWithoutExt}_${counter}${ext}`);
            counter++;
          }

          const pdfSourcePath = path.join(extractPath, entryName);
          fs.copyFileSync(pdfSourcePath, finalPath);
          console.log(`✅ PDF copiado: ${path.basename(finalPath)}`);
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
    const filepath = path.join(PDF_FOLDER, filename);

    const buffer = Buffer.from(attachmentData.contentBytes, 'base64');
    fs.writeFileSync(filepath, buffer);

    console.log(`📥 Descargado: ${filename} (${(buffer.length / 1024).toFixed(2)} KB)`);

    let pdfCount = 0;

    if (filename.toLowerCase().endsWith('.zip')) {
      const extractPath = path.join(PDF_FOLDER, `${path.parse(filename).name}_extracted`);
      if (!fs.existsSync(extractPath)){
        fs.mkdirSync(extractPath, {recursive: true});
      }

      pdfCount = extractZip(filepath, extractPath, emailSubject);
    } else if (filename.toLowerCase().endsWith('.pdf')){
      console.log(`✅ PDF directo descargado: ${filename}`);
      pdfCount = 1;
    }

    return pdfCount;
  } catch (error){
    console.error(`❌ Error descargando ${attachment.name}: ${error.message}`);
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

    console.log('🔍 Buscando todos los correos recientes para filtrar por "Ordenes de Compra"...\n');

    // OBTENER TODOS LOS CORREOS RECIENTES Y FILTRAR LOCALMENTE
    const messages = await client
    .api('/me/messages')
    .select('id,subject,from,receivedDateTime,hasAttachments')
    .top(200)
    .orderby('receivedDateTime DESC')
    .get();

    console.log(`📧 Encontrados ${messages.value.length} correos recientes\n`);

    if (messages.value.length === 0){
      console.log('❌ No se encontraron correos');
      return;
    }

    // FILTRAR LOCALMENTE LOS QUE TIENEN "ORDENES DE COMPRA" EN EL ASUNTO
    const ordenesCompraMessages = messages.value.filter(message => {
      if (!message.subject) return false;
      
      const subjectLower = message.subject.toLowerCase();
      return subjectLower.includes('ordenes de compra') || 
             subjectLower.includes('orden de compra') ||
             subjectLower.includes('oc-') ||
             subjectLower.includes('oc ') ||
             subjectLower.includes('purchase order');
    });

    console.log(`📋 Correos filtrados con "Ordenes de Compra": ${ordenesCompraMessages.length}\n`);

    if (ordenesCompraMessages.length === 0) {
      console.log('❌ No se encontraron correos con "Ordenes de Compra" en el asunto');
      console.log('📝 Asuntos encontrados:');
      messages.value.slice(0, 10).forEach((msg, index) => {
        console.log(`   ${index + 1}. ${msg.subject}`);
      });
      return;
    }

    let totalDownloaded = 0;
    let totalPDFs = 0;
    let emailsWithAttachments = 0;

    for (const message of ordenesCompraMessages){
      if(!message.hasAttachments){
        console.log(`\n📧 ${message.subject} - ❌ Sin adjuntos, saltando...`);
        continue;
      }

      emailsWithAttachments++;
      console.log(`\n📧 Procesando: ${message.subject}`);
      console.log(`   De: ${message.from.emailAddress.address}`);
      console.log(`   Fecha: ${new Date(message.receivedDateTime).toLocaleString()}`);
    
      const attachments = await client
      .api(`/me/messages/${message.id}/attachments`)
      .get();

      if(attachments.value.length > 0){
        console.log(`   📎 ${attachments.value.length} archivos adjuntos:`);

        for (const attachment of attachments.value){
          const pdfCount = await downloadAttachment(client, message.id, attachment, message.subject);
          totalDownloaded++;
          totalPDFs += pdfCount;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✨ RESUMEN FINAL - ORDENES DE COMPRA:`);
    console.log(`   📧 Correos con "Ordenes de Compra": ${ordenesCompraMessages.length}`);
    console.log(`   📎 Correos con adjuntos: ${emailsWithAttachments}`);
    console.log(`   📥 Archivos descargados: ${totalDownloaded}`);
    console.log(`   📄 PDFs de Ordenes de Compra: ${totalPDFs}`);
    console.log(`   📁 Guardados en: ${path.resolve(PDF_FOLDER)}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.statusCode){
      console.error('Código de estado:', error.statusCode);
    }
  }
}

// Ejecutar
searchAndDownloadInvoices();