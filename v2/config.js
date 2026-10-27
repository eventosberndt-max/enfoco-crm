// Configuración de la plataforma.
window.ENFOCO_CONFIG = {
  firebase: {
    "apiKey": "AIzaSyAY0l06t8Le67rRHCOhu2KNkb9R2FN3ebE",
    "authDomain": "enfoco-crm.firebaseapp.com",
    "databaseURL": "https://enfoco-crm-default-rtdb.firebaseio.com",
    "projectId": "enfoco-crm",
    "storageBucket": "enfoco-crm.firebasestorage.app",
    "messagingSenderId": "314775467221",
    "appId": "1:314775467221:web:a18595293c52ceeb8e9e5c"
  },
  // Única cuenta que puede entrar.
  allowedEmails: ['enfoco@enfocofilms.com'],
  // Planillas que se leen en vivo desde Drive con la sesión de Google.
  // Carpeta de Drive con los .docx de presupuestos del año.
  carpetas: { presupuestos2026: '1ZH8Lth_IYxyWyomvVXCjwDfk6FshpPB5' },
  // Retiro mensual objetivo por socio, en dólares. Define el punto de equilibrio.
  objetivoSocioUsd: 2000,
  sheets: {
    crm: '1aC--AG6TExqAI1HrhRj7fU9qU8F7etGw4xtiltwOaSA', // CRM_Enfoco_Films (Google Sheet, la que se usa desde el 26/10)
    crmNativo: true,
    finanzas: '1mxdAF9SWaKfSF29B2pFIQ2ObUg90qqGN'   // Ganancias y perdidas 2026 CEOS.xlsx
  }
};
