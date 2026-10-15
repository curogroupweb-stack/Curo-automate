// POST ?action=connect -> { url } para autorizar Google · POST ?action=disconnect
// GET ?action=drive_files -> archivos de Drive compartidos con el agente
// POST ?action=picker_token -> token para el selector de Google · POST ?action=drive_add / drive_remove
const { handler, json, readBody, query, requireUser, HttpError } = require('./_lib/http');
const { signState } = require('./_lib/crypto');
const google = require('./_lib/google');
const { db, enc } = require('./_lib/db');

module.exports = handler(async (req, res) => {
  const user = await requireUser(req);
  const action = query(req).action;

  if (req.method === 'GET') {
    if (action === 'drive_files') {
      const rows = await db.select('automate_drive_files', `user_id=eq.${enc(user.id)}&select=id,file_id,name,mime_type,created_at&order=created_at.desc`);
      return json(res, 200, { files: rows });
    }
    // Clave pública del selector de Google (Picker), restringida por dominio en Google Cloud — no es secreta, pero vive en Vercel, no en el código.
    if (action === 'picker_config') return json(res, 200, { api_key: process.env.GOOGLE_PICKER_API_KEY || '' });
    throw new HttpError(400, 'Acción no válida.');
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  if (action === 'connect') return json(res, 200, { url: google.authUrl(signState({ uid: user.id })) });
  if (action === 'disconnect') { await google.disconnect(user.id); return json(res, 200, { disconnected: true }); }
  if (action === 'picker_token') {
    const token = await google.driveAccessToken(user.id);
    return json(res, 200, { access_token: token });
  }
  if (action === 'drive_add') {
    const { file_id, name, mime_type } = await readBody(req);
    if (!file_id) throw new HttpError(400, 'Falta el archivo elegido.');
    const row = await db.insert('automate_drive_files', { user_id: user.id, file_id, name: (name || 'Archivo de Drive').slice(0, 200), mime_type: mime_type || '' });
    return json(res, 200, { file: row });
  }
  if (action === 'drive_remove') {
    const { id } = await readBody(req);
    await db.remove('automate_drive_files', `id=eq.${enc(id)}&user_id=eq.${enc(user.id)}`);
    return json(res, 200, { removed: true });
  }
  throw new HttpError(400, 'Acción no válida.');
});
