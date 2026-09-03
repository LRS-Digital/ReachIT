import axios from 'axios';

const MAX_BODY_LAENGE = 2000;

/**
 * Bereitet einen Fehler für die Railway-Logs auf.
 *
 * Bei Axios-Fehlern steckt die eigentliche Information in der Antwort der
 * Plattform - Status und Body. Im rohen Fehlerobjekt geht die zwischen
 * Request-Config, Headern und Stacktrace unter, weshalb sich die Logs bisher
 * nicht auswerten ließen.
 *
 * Die Query-Parameter der URL werden bewusst abgeschnitten: Instagram und
 * Threads übergeben den access_token als Query-Parameter, der hätte sonst im
 * Klartext in den Logs gestanden. Der Request-Body wird aus demselben Grund
 * nicht geloggt (Token-Tausch enthält client_secret).
 */
export function describeError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const methode = err.config?.method?.toUpperCase() ?? '?';
    const url = err.config?.url?.split('?')[0] ?? '?';
    const status = err.response ? String(err.response.status) : 'keine Antwort';

    return `${methode} ${url} -> ${status} ${formatiereBody(err.response?.data)} (${err.message})`;
  }

  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }

  return formatiereBody(err);
}

function formatiereBody(data: unknown): string {
  if (data === undefined || data === null) return '';

  let text: string;
  try {
    text = typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    // Zirkuläre Strukturen dürfen das Logging nicht sprengen
    text = String(data);
  }

  return text.length > MAX_BODY_LAENGE
    ? `${text.slice(0, MAX_BODY_LAENGE)}... [gekürzt]`
    : text;
}
