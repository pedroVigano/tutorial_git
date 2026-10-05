// Gravação da reunião no navegador → transcrição pelo Gemini (Vertex), trecho a trecho.
// - MediaRecorder (opus ~32 kbps) reiniciado a cada SEG_MS: cada trecho é um arquivo de áudio completo,
//   enviado para /api/ia/transcrever numa fila (em ordem, com novas tentativas). O áudio não é guardado.
// - A transcrição cresce ao vivo e fica no navegador (gt-reuniao), para sobreviver a um recarregar.
// - Continua gravando com o painel fechado; o botão 🎙 do cabeçalho mostra o tempo.
import * as api from './api.js';
import { state } from './state.js';
import { store } from './util.js';

const KEY = 'gt-reuniao';
const SEG_MS = Number(store.get('gt-seg-ms', 0)) || 5 * 60_000;
const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];

// estado persistente da reunião em curso (transcrição, início, duração gravada)
export const reuniao = { texto: '', inicio: null, ms: 0, ...store.get(KEY, {}) };
export const salvarReuniao = () => store.set(KEY, { texto: reuniao.texto, inicio: reuniao.inicio, ms: reuniao.ms });
export function limparReuniao() { reuniao.texto = ''; reuniao.inicio = null; reuniao.ms = 0; salvarReuniao(); }

let rec = null; // { stream, mr, mime, tick, segTimer, desde, pausado }
const fila = []; let enviando = false; let falhas = 0; let enviados = 0;
const ouvintes = new Set();
export const aoMudar = (f) => { ouvintes.add(f); return () => ouvintes.delete(f); };
const avisar = () => ouvintes.forEach((f) => f());

export const gravando = () => !!rec;
export const pausado = () => !!rec?.pausado;
export const situacao = () => ({ gravando: !!rec, pausado: !!rec?.pausado, fila: fila.length + (enviando ? 1 : 0), enviados, falhas, ms: duracaoMs() });
export function duracaoMs() { return reuniao.ms + (rec && !rec.pausado ? Date.now() - rec.desde : 0); }

function novoTrecho() {
  const partes = [];
  const mr = new MediaRecorder(rec.stream, { mimeType: rec.mime, audioBitsPerSecond: 32000 });
  mr.ondataavailable = (e) => { if (e.data?.size) partes.push(e.data); };
  mr.onstop = () => { if (partes.length) { fila.push(new Blob(partes, { type: rec?.mime || partes[0].type })); processar(); } };
  mr.start();
  rec.mr = mr;
}

export async function iniciar() {
  if (rec) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador não grava áudio.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = MIMES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  rec = { stream, mime, desde: Date.now(), pausado: false };
  if (!reuniao.inicio) reuniao.inicio = new Date().toISOString();
  novoTrecho();
  rec.segTimer = setInterval(() => { if (rec && !rec.pausado) { rec.mr.stop(); novoTrecho(); } }, SEG_MS);
  rec.tick = setInterval(avisar, 1000);
  salvarReuniao(); avisar();
}

export function pausar() {
  if (!rec || rec.pausado) return;
  reuniao.ms += Date.now() - rec.desde; rec.pausado = true;
  rec.mr.stop(); // o que foi gravado até aqui já vai para a transcrição
  salvarReuniao(); avisar();
}
export function retomar() {
  if (!rec?.pausado) return;
  rec.pausado = false; rec.desde = Date.now();
  novoTrecho(); avisar();
}
export function parar() {
  if (!rec) return;
  if (!rec.pausado) { reuniao.ms += Date.now() - rec.desde; rec.mr.stop(); }
  clearInterval(rec.segTimer); clearInterval(rec.tick);
  rec.stream.getTracks().forEach((t) => t.stop());
  rec = null;
  salvarReuniao(); avisar();
}

const base64 = (blob) => new Promise((ok, erro) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => erro(r.error);
  r.readAsDataURL(blob);
});

// Fila em ordem: cada trecho é transcrito com o final do texto anterior como contexto.
async function processar() {
  if (enviando || !fila.length) return;
  enviando = true; avisar();
  const blob = fila[0];
  try {
    const { texto } = await api.ia('transcrever', { audio: await base64(blob), mime: blob.type || 'audio/webm', anterior: reuniao.texto.slice(-1500), sprint: state.sprint, tri: state.tri });
    fila.shift(); enviados += 1; falhas = 0;
    if (texto) { reuniao.texto = `${reuniao.texto}${reuniao.texto ? '\n' : ''}${texto.trim()}`; salvarReuniao(); }
  } catch (e) {
    falhas += 1;
    if (falhas >= 4) { fila.shift(); falhas = 0; reuniao.texto += `\n[trecho não transcrito: ${e.message}]`; salvarReuniao(); }
    else await new Promise((r) => setTimeout(r, 2000 * 2 ** falhas));
  } finally {
    enviando = false; avisar();
    if (fila.length) processar();
  }
}

export const relogio = (ms) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
