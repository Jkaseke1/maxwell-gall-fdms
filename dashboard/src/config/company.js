// ============================================================
//  PER-CLIENT CONFIGURATION
//  Edit this single file when deploying for a new client.
//  Values fall back to env vars (VITE_*) if provided at build time.
// ============================================================

const env = import.meta.env || {};

export const COMPANY = {
  // --- Company / taxpayer details ---
  name:       env.VITE_COMPANY_NAME       || 'MAXWELL GLASS',
  shortName:  env.VITE_COMPANY_SHORT_NAME || 'MAX GLASS',
  tagline:    '...giving value to your property',
  address:    env.VITE_COMPANY_ADDRESS    || '136 Datford Road, Willowvale, Harare',
  altAddress: '3442 Old Highfield Road, Willowvale, Harare',
  telephone:  env.VITE_COMPANY_PHONE      || '+263 772 729 913 / +263 773 812 804 / +263 712 048 767',
  email:      env.VITE_COMPANY_EMAIL      || 'sales@maxglass.co.zw',

  // --- ZIMRA device registration ---
  deviceId:   env.VITE_DEVICE_ID          || '38293',
  serialNo:   env.VITE_DEVICE_SERIAL      || 'TEST-2000945150-B670',
  tin:        env.VITE_TIN                || '2000945150',
  vatNo:      env.VITE_VAT                || '220438802',
  model:      env.VITE_DEVICE_MODEL       || 'MAX-FDMS v1.0',

  // --- Tax configuration ---
  vatRate:    env.VITE_VAT_RATE           || '15.5%',
  taxRatePercent: 15.5,
  taxIds:     env.VITE_TAX_IDS            || '517 — Standard 15.5% · 2 — Zero rated · 1 — Exempt',

  // --- Environment ---
  environment: env.VITE_ENVIRONMENT       || 'TEST',
  apiEndpoint: env.VITE_FDMS_ENDPOINT     || 'fdmstest.zimra.co.zw',
};

export default COMPANY;
