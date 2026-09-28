// Modal único da página (o mesmo #modal-bg do mock).
import { state } from './state.js';
import { $ } from './util.js';

let onCloseCb = null;

export function openModal(html, { wide = false, onSubmit = null, onClose = null } = {}) {
  const bg = $('#modal-bg'); const form = $('#modal-form');
  form.classList.toggle('wide', wide);
  $('#modal-body').innerHTML = html;
  form.onsubmit = (e) => { e.preventDefault(); if (onSubmit) onSubmit(e); };
  onCloseCb = onClose;
  state.busy = true;
  bg.classList.add('open');
  return $('#modal-body');
}

export function closeModal() {
  $('#modal-bg').classList.remove('open');
  state.busy = false;
  const cb = onCloseCb; onCloseCb = null;
  if (cb) cb();
}

export const modalOpen = () => $('#modal-bg').classList.contains('open');
