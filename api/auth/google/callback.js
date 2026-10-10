// Vuelta de Google tras autorizar Gmail: guarda el permiso cifrado para el usuario del "state".
const { verifyState } = require('../../_lib/crypto');
const google = require('../../_lib/google');
const { query } = require('../../_lib/http');

function back(res, qs) { res.statusCode = 302; res.setHeader('Location', '/?' + qs); res.end(); }

module.exports = async (req, res) => {
  try {
    const q = query(req);
    if (q.error) throw new Error(q.error === 'access_denied' ? 'Cancelaste la autorización en Google.' : 'Google no completó la autorización.');
    if (!q.code) throw new Error('Google no devolvió el código de autorización.');
    const st = verifyState(q.state);
    if (!st?.uid) throw new Error('El enlace de autorización caducó. Vuelve a pulsar Conectar Gmail.');
    const tokens = await google.exchangeCode(q.code);
    const email = await google.saveConnection(st.uid, tokens);
    back(res, 'google=connected&email=' + encodeURIComponent(email));
  } catch (e) {
    back(res, 'google=error&reason=' + encodeURIComponent(e.message));
  }
};
