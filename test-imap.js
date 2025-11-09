import { PublicClientApplication } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import { response } from "express";
import fs from 'fs';
import 'isomorphic-fetch';

const CLIENT_ID = '621f00ee-1415-475d-bc86-c3bc0c39ebd6';
const EMAIL = 'dnkideas@hotmail.com';
const TOKEN_FILE = './tokens.json';

const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: 'https://login.microsoftonline.com/common'
  },
  cache: {
    cachePlugin: {
      beforeCacheAccess: async (cacheContext) =>{
        if (fs.existsSync(TOKEN_FILE)){
          cacheContext.tokenCache.deserialize(fs.readFileSync(TOKEN_FILE, 'utf-8'));
        }
      },
      afterCacheAccess: async (cacheContext) =>{
        if (cacheContext.cacheHasChanged){
          fs.writeFileSync(TOKEN_FILE, cacheContext.tokenCache.serialize());
        }
      }
    }
  }
};

const pca = new PublicClientApplication(msalConfig);

async function getAccessToken(){
  const accounts = await pca.getTokenCache().getAllAccounts();

  // Intenta obtener token silenciosamente (sin interacción)
  if (accounts.length > 0) {
    try {
      console.log('🔄 Obteniendo token automáticamente...');
      const silentRequest = {
        account: accounts[0],
        scopes: [
          'https://graph.microsoft.com/Mail.Read',
          'https://graph.microsoft.com/Mail.ReadWrite',
          'offline_access'
        ]
      };
      const response = await pca.acquireTokenSilent(silentRequest);
      console.log('✅ Token obtenido automáticamente!');
      return response.accessToken;
    } catch (error) {
      console.log('⚠️  Token expirado, necesitas autenticarte de nuevo');
    }
  }

  // Si no hay token guardado, solicita autenticación manual (solo primera vez)
  console.log('🔐 Primera vez: necesitas autenticarte manualmente\n');
  const deviceCodeRequest = {
    deviceCodeCallback: (response) => {
      console.log('📱 ACCION REQUERIDA (solo esta vez):');
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
  console.log('✅ Tokens guardados! Próximas ejecuciones serán automáticas');
  return response.accessToken;
}

async function readEmails(){
  try {
    const accessToken = await getAccessToken();

    const client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      }
    });

    const messages = await client
      .api('/me/messages')
      .top(5)
      .select('subject,from,receivedDateTime')
      .orderby('receivedDateTime DESC')
      .get();

    console.log(`\n📬 Tienes ${messages.value.length} mensajes recientes:\n`);

    messages.value.forEach((message, index) => {
      console.log(`${index + 1}. ${message.subject}`);
      console.log(`   De: ${message.from.emailAddress.address}`);
      console.log('---');
    });

  } catch(error){
    console.error('❌ Error:', error);
  }
}

readEmails();