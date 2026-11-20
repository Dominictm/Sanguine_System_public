'use strict';

const { EDITABLE_FIELD_MAP } = require('./db');

const BIO_FIELDS_BY_LINEAGE = Object.freeze({
  vampires: Object.freeze(['clan','sect','generation','birthYear','embraceYear','sire','childe','hierarchy','disciplines']),
  mortals: Object.freeze(['birthYear','profession','relatives','attitude','belonging','role','organization','position','features']),
  fairies: Object.freeze(['birthYear','race','kith','court','seeming','house','location','features']),
  werewolves: Object.freeze(['birthYear','tribe','auspice','breed','features','role']),
  mages: Object.freeze(['birthYear','tradition','features','role','belonging','profession']),
  hunters: Object.freeze(['birthYear','organization','sectRole','position','belonging','role','features']),
});

function biographyFactLines(char = {}) {
  const allowed = new Set(BIO_FIELDS_BY_LINEAGE[char.lineageFolder] || ['birthYear','profession','belonging','role','location','features']);
  const lines = [];
  const put = (key, label = EDITABLE_FIELD_MAP[key] || key) => {
    const value = char[key];
    if (value != null && String(value).trim() && !String(value).includes('⚠️') && String(value).trim() !== '—')
      lines.push(`${label}: ${String(value).trim()}`);
  };
  put('gender'); put('profession'); put('belonging'); put('role'); put('location');
  for (const key of allowed) if (!['profession','belonging','role','location'].includes(key)) put(key);
  for (const key of ['want','fear','leverage']) put(key);
  return lines.join('\n');
}

module.exports = { BIO_FIELDS_BY_LINEAGE, biographyFactLines };
