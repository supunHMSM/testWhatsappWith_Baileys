const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require("@whiskeysockets/baileys");
const makeWASocket = require("@whiskeysockets/baileys").default;
const qrcode = require('qrcode');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  protocol.registerFileProtocol('media', (request, callback) => {
    const url = request.url.substr(8);
    const filePath = path.normalize(`${app.getPath('userData')}/whatsapp_media/${url}`);
    console.log('Media protocol request:', url);
    console.log('Resolved file path:', filePath);
    callback({ path: filePath });
  });

  protocol.registerFileProtocol('app', (request, callback) => {
    const url = request.url.substr(6);
    console.log("App protocol request:", url);
    const filePath = path.normalize(`${__dirname}/${url}`);
    console.log('Resolved file path: ', filePath);
    callback({path: filePath});
  });


  mainWindow.loadURL('app://./index.html');
 // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});


async function startWhatsApp() {
    const userDataPath = app.getPath('userData');
    console.log("User Data Path :",userDataPath);
    const authDir = path.join(userDataPath, 'whatsapp_auth');
    const mediaDir = path.join(userDataPath, 'whatsapp_media');
    
    console.log('Starting WhatsApp connection...');
    console.log('Auth directory:', authDir);
    console.log('Media directory:', mediaDir);
  
    try {
      await fs.mkdir(authDir, { recursive: true });
      await fs.mkdir(mediaDir, { recursive: true });
      console.log('Auth directory created or already exists');
  
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      console.log('Auth state loaded successfully');
  
      const sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        browser: ['Electron WhatsApp', 'Desktop', '1.0.0'],
        connectTimeoutMs: 60000, // Increase connection timeout to 60 seconds
        retryRequestDelayMs: 5000, // Wait 5 seconds before retrying a request
      });
      console.log('WhatsApp socket created');
  
      sock.ev.on("connection.update", async (update) => {
        console.log('Connection update:', update);
        const { connection, lastDisconnect, qr } = update || {};
        if (qr) {
          console.log('QR code received, converting to data URL');
          try {
            const qrDataURL = await qrcode.toDataURL(qr);
            console.log('QR code converted to data URL');
            mainWindow.webContents.send('qr', qrDataURL);
          } catch (error) {
            console.error('Error converting QR code to data URL:', error);
          }
        }
        if (connection === 'open') {
          console.log('Connection opened');
          mainWindow.webContents.send('connected');
        }
        if (connection === 'close') {
          console.log('Connection closed');
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          console.log('Disconnect reason:', DisconnectReason[statusCode]);
          if (shouldReconnect) {
            console.log('Attempting to reconnect in 5 seconds...');
            setTimeout(() => {
              console.log('Reconnecting now...');
              startWhatsApp();
            }, 5000);
          } else {
            console.log('Not reconnecting due to logout');
            mainWindow.webContents.send('error', 'Logged out from WhatsApp');
          }
        }
      });
  

    sock.ev.on('messages.upsert', async (m) => {
        console.log('New message received:', m);
      const msg = m.messages[0];
      if (!msg.key.fromMe && m.type === 'notify') {
        let messageContent = '';
        let mediaUrl = '';
        let mediaType = '';

        if (msg.message?.conversation) {
          messageContent = msg.message.conversation;
        } else if (msg.message?.extendedTextMessage) {
          messageContent = msg.message.extendedTextMessage.text;
        } else if (msg.message?.imageMessage) {
          messageContent = msg.message.imageMessage.caption || 'Image received';
          mediaType = 'image';
          try{
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            const fileName = `image_${Date.now()}.jpg`;
            const filePath = path.join(mediaDir, fileName);
            await fs.writeFile(filePath, buffer);
            mediaUrl = `media://${fileName}`;
            console.log('Image saved to:', filePath);
            console.log('Image URL:', mediaUrl);

          } catch (error){
            console.error('Error downloading image:', error);
          }
        }else if(msg.message?.documentMessage){
            messageContent = msg.message.documentMessage.fileName || 'Document received';
            mediaType = 'document';
            try {
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              const fileName = msg.message.documentMessage.fileName || `document_${Date.now()}.pdf`;
              const filePath = path.join(mediaDir, fileName);
              await fs.writeFile(filePath, buffer);
              mediaUrl = `media://${fileName}`;
              console.log('Document saved to:', filePath);
              console.log('Document URL:', mediaUrl);
            } catch (error) {
              console.error('Error downloading document:', error);
            }
        }
         else if (msg.message?.videoMessage) {
          messageContent = msg.message.videoMessage.caption || 'Video received';
        } else {
          messageContent = 'Message of unknown type received';
        }
        mainWindow.webContents.send('message', {
          from: msg.key.remoteJid,
          content: messageContent,
          mediaUrl: mediaUrl,
          mediaType: mediaType
        });
      }
    });

    sock.ev.on("creds.update", saveCreds);
    console.log('Credentials update listener set');
  } catch (error) {
    console.error('Error in startWhatsApp:', error);
    mainWindow.webContents.send('error', error.message);
  }
}

ipcMain.on('start-whatsapp', (event) => {
  startWhatsApp();
});