import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

const PAGE_STYLE = `
  body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1A1A1A; }
  h1 { border-bottom: 2px solid #1A1A1A; padding-bottom: 10px; }
  h2 { margin-top: 30px; }
`;

@Controller('legal')
export class LegalController {
  @Get('privacy')
  privacyPolicy(@Res() res: Response) {
    res.type('html').send(`
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Datenschutzerklärung - ReachIT</title><style>${PAGE_STYLE}</style></head>
<body>
  <h1>Datenschutzerklärung - ReachIT</h1>
  <p>Stand: ${new Date().toLocaleDateString('de-DE')}</p>

  <h2>1. Verantwortlicher</h2>
  <p>Lucas Schnarewski, LRS-Digital, Weddigenstr. 3, 48527 Nordhorn, Info@LRS-Digital.de</p>

  <h2>2. Welche Daten wir verarbeiten</h2>
  <p>ReachIT verbindet sich über den offiziellen OAuth-Login der jeweiligen Plattform (z.B. Instagram, TikTok) mit deinem Social-Media-Konto. Wir speichern dabei:</p>
  <ul>
    <li>Deine Plattform-Nutzer-ID</li>
    <li>Einen verschlüsselten Zugriffstoken (AES-256), mit dem wir in deinem Auftrag Inhalte veröffentlichen können</li>
    <li>Von dir hochgeladene Bilder/Videos, temporär zur Veröffentlichung</li>
  </ul>

  <h2>3. Wofür wir diese Daten nutzen</h2>
  <p>Ausschließlich, um auf deine Anweisung hin Inhalte auf den von dir verbundenen Plattformen zu veröffentlichen. Wir verkaufen oder teilen deine Daten nicht mit Dritten.</p>

  <h2>4. Speicherdauer</h2>
  <p>Zugriffstoken werden gespeichert, bis du die Verbindung trennst oder dein Konto löschst. Hochgeladene Medien werden nach der Veröffentlichung automatisch gelöscht.</p>

  <h2>5. Deine Rechte</h2>
  <p>Du kannst jederzeit Auskunft, Berichtigung oder Löschung deiner Daten verlangen. Kontaktiere uns dazu unter Info@LRS-Digital.de.</p>

  <h2>6. Kontakt</h2>
  <p>Bei Fragen zum Datenschutz: Info@LRS-Digital.de</p>
</body>
</html>
    `);
  }

  @Get('terms')
  termsOfService(@Res() res: Response) {
    res.type('html').send(`
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Nutzungsbedingungen - ReachIT</title><style>${PAGE_STYLE}</style></head>
<body>
  <h1>Nutzungsbedingungen - ReachIT</h1>
  <p>Stand: ${new Date().toLocaleDateString('de-DE')}</p>

  <h2>1. Anbieter</h2>
  <p>Lucas Schnarewski, LRS-Digital, Weddigenstr. 3, 48527 Nordhorn, Info@LRS-Digital.de</p>

  <h2>2. Leistungsbeschreibung</h2>
  <p>ReachIT ermöglicht es Nutzern, eigene Social-Media-Konten per OAuth zu verbinden und Beiträge gleichzeitig auf mehreren Plattformen zu veröffentlichen.</p>

  <h2>3. Nutzungsvoraussetzungen</h2>
  <p>Du musst mindestens 18 Jahre alt sein und über gültige Zugangsdaten für die von dir verbundenen Plattformen verfügen. Du bist selbst dafür verantwortlich, dass veröffentlichte Inhalte den Richtlinien der jeweiligen Plattform (z.B. TikTok, Instagram) entsprechen.</p>

  <h2>4. Haftung</h2>
  <p>ReachIT übernimmt keine Haftung für Inhalte, die Nutzer über den Dienst veröffentlichen, oder für Sperrungen/Sanktionen durch Drittplattformen infolge von Richtlinienverstößen.</p>

  <h2>5. Kündigung</h2>
  <p>Du kannst die Verbindung zu jeder Plattform sowie dein Konto jederzeit selbst trennen bzw. löschen lassen.</p>

  <h2>6. Kontakt</h2>
  <p>Bei Fragen: Info@LRS-Digital.de</p>
</body>
</html>
    `);
  }
}
