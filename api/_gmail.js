const crypto=require('crypto');
const CLIENT_ID=()=>process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET=()=>process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT=()=>process.env.GOOGLE_REDIRECT_URI;
const key=()=>crypto.createHash('sha256').update(CLIENT_SECRET()||'').digest();
function seal(obj){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key(),iv);const raw=Buffer.from(JSON.stringify(obj));const enc=Buffer.concat([c.update(raw),c.final()]);return Buffer.concat([iv,c.getAuthTag(),enc]).toString('base64url')}
function open(v){try{const b=Buffer.from(v,'base64url'),iv=b.subarray(0,12),tag=b.subarray(12,28),enc=b.subarray(28);const d=crypto.createDecipheriv('aes-256-gcm',key(),iv);d.setAuthTag(tag);return JSON.parse(Buffer.concat([d.update(enc),d.final()]).toString())}catch{return null}}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2))}
function setCookie(res,name,value,maxAge=2592000){res.setHeader('Set-Cookie',`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`)}
async function refresh(t){if(!t?.refresh_token)return t;if(t.expires_at>Date.now()+60000)return t;const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT_ID(),client_secret:CLIENT_SECRET(),refresh_token:t.refresh_token,grant_type:'refresh_token'})});if(!r.ok)throw new Error('No se pudo renovar Gmail');const j=await r.json();return {...t,...j,expires_at:Date.now()+(j.expires_in||3600)*1000}}
async function token(req,res){const t=open(cookies(req).curo_gmail);if(!t)throw new Error('Gmail no conectado');const n=await refresh(t);if(n.access_token!==t.access_token)setCookie(res,'curo_gmail',seal(n));return n}
async function gmail(req,res,path,opts={}){const t=await token(req,res);return fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`,{...opts,headers:{authorization:`Bearer ${t.access_token}`,'content-type':'application/json',...(opts.headers||{})}})}
function json(res,status,data){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(data))}
function hdr(msg,name){return (msg.payload?.headers||[]).find(h=>h.name.toLowerCase()===name.toLowerCase())?.value||''}
function decodeBody(p){if(p?.body?.data)return Buffer.from(p.body.data,'base64url').toString('utf8');for(const part of p?.parts||[]){if(part.mimeType==='text/plain'&&part.body?.data)return Buffer.from(part.body.data,'base64url').toString('utf8')}return ''}
module.exports={CLIENT_ID,CLIENT_SECRET,REDIRECT,seal,open,cookies,setCookie,token,gmail,json,hdr,decodeBody};
