const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function viewonceCommand(sock, chatId, message) {
  const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedImage = quoted?.imageMessage;
  const quotedVideo = quoted?.videoMessage;

  if (quotedImage && quotedImage.viewOnce) {
    const stream = await downloadContentFromMessage(quotedImage, 'image');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    await sock.sendMessage(
      chatId,
      { image: buffer, fileName: 'view-once.jpg', caption: quotedImage.caption || '' },
      { quoted: message }
    );
  } else if (quotedVideo && quotedVideo.viewOnce) {
    const stream = await downloadContentFromMessage(quotedVideo, 'video');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    await sock.sendMessage(
      chatId,
      { video: buffer, fileName: 'view-once.mp4', caption: quotedVideo.caption || '' },
      { quoted: message }
    );
  } else {
    await sock.sendMessage(chatId, { text: 'No view-once media in the quoted message.' }, { quoted: message });
  }
}

module.exports = viewonceCommand;
